WebGL Forward+ and Clustered Deferred Shading
======================

**University of Pennsylvania, CIS 565: GPU Programming and Architecture, Project 4**

* (TODO) YOUR NAME HERE
* Tested on: (TODO) **Google Chrome 222.2** on
  Windows 22, i7-2222 @ 2.22GHz 22GB, GTX 222 222MB (Moore 2222 Lab)

### Live Demo

[![](img/thumb.png)](http://TODO.github.io/Project4-WebGPU-Forward-Plus-and-Clustered-Deferred)

### Demo Video/GIF

[![](img/video.mp4)](TODO)

### (TODO: Your README)

*DO NOT* leave the README to the last minute! It is a crucial part of the
project, and we will not be able to grade you without a good README.

This assignment has a considerable amount of performance analysis compared
to implementation work. Complete the implementation early to leave time!

### Credits

- [Vite](https://vitejs.dev/)
- [loaders.gl](https://loaders.gl/)
- [dat.GUI](https://github.com/dataarts/dat.gui)
- [stats.js](https://github.com/mrdoob/stats.js)
- [wgpu-matrix](https://github.com/greggman/wgpu-matrix)

### Part 2: Clustered Deferred G-buffer Optimization

The clustered deferred renderer packs an octahedrally encoded world normal and
8-bit RGB albedo into two `u32` channels in a single `rg32uint` G-buffer image.
The lighting compute shader reads that image and the depth attachment, rebuilds
world position with the inverse view-projection matrix, and writes the lit
result directly to the canvas. This replaces the three color G-buffer images
and fullscreen vertex/fragment lighting pass.

The G-buffer color storage is 8 bytes per pixel instead of 20 bytes per pixel
(two `rgba16float` images plus one `rgba8unorm` image), a 60% reduction. This
does not include the unchanged depth attachment.

#### Compute bloom post-processing

The clustered deferred path keeps its lighting result in an HDR `rgba16float`
texture, then runs two compute passes for bloom. The first downsamples to half
resolution and extracts pixels above a luminance threshold. The second applies
a 3x3 Gaussian-weighted blur to that bright image and adds the result to the
full-resolution scene before writing to the canvas. Bloom uses a fixed
0.65 luminance threshold and 1.5 composite strength.

The reduced-resolution bright texture keeps the blur taps and bandwidth lower
than a full-resolution blur. Bloom adds two compute dispatches and intermediate
texture traffic, so it may cost performance in scenes with few bright pixels;
the benefit is a soft glow around bright lighting. The in-app benchmark's
clustered-deferred results include the bloom passes. Compare with a build where
bloom is disabled to measure its cost on the target GPU.

#### Render bundles

Forward+ geometry and the clustered-deferred G-buffer pass each record their
static scene draw commands once into a `GPURenderBundle`. Each frame replays
that bundle in its render pass instead of having JavaScript reissue the
per-node, per-material, and per-primitive commands. The camera, light, and
cluster buffers are updated in place, so their bind groups remain valid while
the bundle is reused. A GUI checkbox switches bundle execution off to provide a
same-build comparison; naive rendering does not use bundles.

Bundles primarily reduce CPU command-encoding and API-call overhead. They do
not reduce geometry, pixel, or lighting work on the GPU. The best case is a
scene with many draw calls and stable geometry/material bindings, where host
submission is a bottleneck. The worst case is a small or GPU-bound scene, where
the saved CPU work is negligible; bundle recording also costs setup time and
the scene must be re-recorded if its draw structure or bound resources change.

To measure the effect, leave the scene, light count, resolution, browser, and
build label unchanged. Run **Benchmark all** with render bundles enabled, then
disabled, and download the CSV. Rows contain a `render_bundles` column, and the
plot script groups the enabled and disabled results separately, including
Forward+ and clustered deferred. Compare median CPU draw/submit duration and
frame interval; do not interpret either as GPU-only execution time. No
render-bundle timing results are filled in until measured on the target system.

#### Forward+ depth prepass and cluster culling

Forward+ first renders alpha-tested geometry to a depth-only attachment. Its
lighting pass then loads that depth and uses an `equal` depth test with depth
writes disabled, so occluded fragments are rejected before the expensive
Forward+ fragment shader. Alpha testing is retained in the depth pass so cutout
materials do not incorrectly occlude geometry behind them.

Between the prepass and light clustering, a fullscreen-triangle pass reads
depth. Each covered pixel reconstructs view depth, derives its tile and
logarithmic depth slice, and atomically marks that cluster active. The cluster
compute shader checks the mask before calculating bounds or testing lights.
This is direct mask-based skipping: dispatch count remains unchanged, and there
is no stream compaction. Other renderers use a separate all-active mask.

Depth culling is most useful when many tile/depth clusters are empty and the
scene has substantial overdraw. The compute shader then avoids scanning lights
for those clusters, and the final shading pass shades only the visible depth
surface. It can be less useful when most clusters contain geometry or light
counts are small, since the extra depth draw, fullscreen mask atomics, and
buffer clear have a cost. The active set is conservative only to the pixel
coverage recorded by the depth prepass, with one cluster marked for each
visible pixel.

Use the **Forward+ depth optimizations** GUI checkbox to compare the original
single-pass Forward+ path with prepass plus depth-based culling in the same
build. Run the benchmark under both settings, then plot the CSV exports
together. The `forward_plus_depth` column distinguishes settings. Evaluate
more than one light count and scene/camera view: the optimization adds
fixed per-pixel and per-geometry work while saving light tests in inactive
clusters. Initial measurements from this workspace session follow.

Initial same-session measurements (200 samples per renderer after a 2-second
warm-up, 500 lights, 1058x567 canvas, render bundles enabled, Chrome 150 inside
VS Code/Electron) are below. Frame interval is wall-clock time between frames,
and CPU submit is command encoding plus submission; neither is GPU-only time.
The medians are unchanged at 6.10 ms, so this run does not show a measurable
frame-interval improvement. CPU submit was lower in this run, but sub-millisecond
measurements in a shared browser session are susceptible to noise and should
be rechecked on the target system.

| Forward+ depth path | Frame interval mean (ms) | Frame interval median (ms) | CPU submit mean (ms) | CPU submit median (ms) |
| --- | ---: | ---: | ---: | ---: |
| Disabled (single pass) | 6.394 | 6.100 | 0.157 | 0.200 |
| Enabled (prepass + culling) | 6.060 | 6.100 | 0.122 | 0.100 |

#### Automated benchmark

The in-app **Renderer benchmark** runs the naive, Forward+, and clustered
deferred renderers in sequence. It discards the configured warm-up period,
collects the requested number of frame samples per renderer, and exports a CSV.
Each row includes the build label, renderer, light count, canvas resolution,
browser user agent, render-bundle and Forward+ depth optimization states, frame
interval, and CPU draw/submit duration. The default is a 3-second warm-up and
300 samples per renderer.

Frame interval is measured between animation frames and includes browser
scheduling/vsync. CPU draw/submit measures JavaScript command encoding and
submission; it does **not** measure asynchronous GPU execution. Use browser GPU
profiling or GPU timestamp queries separately when actual GPU-only timings are
required. The tool reports milliseconds, not FPS.

For comparable runs, keep the browser/GPU, canvas size, camera position, light
count, and power mode constant; avoid interacting with the page and keep it
foregrounded. Enter a distinct build label for each revision (for example,
`baseline` and `compact-compute`) and download each CSV.

Install the plotting dependency and plot one or more exported CSVs:

```powershell
python -m pip install matplotlib
python scripts/plot_benchmark.py baseline.csv compact-compute.csv --output benchmark-results.png
```

The script prints sample count, mean, median, and 95th percentile in
milliseconds, and plots median plus interquartile range for both frame interval
and CPU draw/submit duration. It groups data by build label, renderer, bundle
state, and Forward+ depth optimization state, so enabled and disabled runs can
be compared in one plot.

#### Performance measurements

No target-machine benchmark data has been collected yet. The CSV exports and
plot provide the measurements; do not treat the G-buffer memory reduction
below as a render-time result.

| Version | G-buffer color storage | Average GPU frame time (ms) | Median GPU frame time (ms) |
| --- | ---: | ---: | ---: |
| Original clustered deferred | 20 B/pixel | Not measured | Not measured |
| Compact G-buffer + compute | 8 B/pixel | Not measured | Not measured |
