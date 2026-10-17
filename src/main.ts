import Stats from 'stats.js';
import { GUI } from 'dat.gui';

import {
    initWebGPU,
    Renderer,
    renderBundlesEnabled,
    forwardPlusDepthOptimizationEnabled,
    setRenderBundlesEnabled,
    setForwardPlusDepthOptimizationEnabled
} from './renderer';
import { NaiveRenderer } from './renderers/naive';
import { ForwardPlusRenderer } from './renderers/forward_plus';
import { ClusteredDeferredRenderer } from './renderers/clustered_deferred';

import { setupLoaders, Scene } from './stage/scene';
import { Lights } from './stage/lights';
import { Camera } from './stage/camera';
import { Stage } from './stage/stage';
import { RendererBenchmark } from './benchmark';

await initWebGPU();
setupLoaders();

let scene = new Scene();
await scene.loadGltf('./scenes/sponza/Sponza.gltf');

const camera = new Camera();
const lights = new Lights(camera);

const stats = new Stats();
stats.showPanel(0);
document.body.appendChild(stats.dom);

const gui = new GUI();
gui.add(lights, 'numLights').min(1).max(Lights.maxNumLights).step(1).onChange(() => {
    lights.updateLightSetUniformNumLights();
});
const renderBundleSettings = { enabled: renderBundlesEnabled };
gui.add(renderBundleSettings, 'enabled').name('render bundles').onChange(setRenderBundlesEnabled);
const depthOptimizationSettings = { enabled: forwardPlusDepthOptimizationEnabled };
gui.add(depthOptimizationSettings, 'enabled').name('Forward+ depth optimizations')
    .onChange(setForwardPlusDepthOptimizationEnabled);

const stage = new Stage(scene, lights, camera, stats);

var renderer: Renderer | undefined;
let benchmarkMetricsListener:
    | ((mode: string, metrics: { frameIntervalMs: number; cpuSubmitMs: number }) => void)
    | undefined;

function setRenderer(mode: string) {
    renderer?.stop();

    switch (mode) {
        case renderModes.naive:
            renderer = new NaiveRenderer(stage);
            break;
        case renderModes.forwardPlus:
            renderer = new ForwardPlusRenderer(stage);
            break;
        case renderModes.clusteredDeferred:
            renderer = new ClusteredDeferredRenderer(stage);
            break;
        default:
            throw new Error(`Unknown renderer mode: ${mode}`);
    }

    renderer.onFrameMetrics = metrics => benchmarkMetricsListener?.(mode, metrics);
}

const renderModes = { naive: 'naive', forwardPlus: 'forward+', clusteredDeferred: 'clustered deferred' };
const rendererModes = Object.values(renderModes);
let renderModeController = gui.add({ mode: renderModes.naive }, 'mode', renderModes);
renderModeController.onChange(setRenderer);

setRenderer(renderModeController.getValue());

new RendererBenchmark(
    mode => renderModeController.setValue(mode),
    () => renderModeController.getValue(),
    listener => { benchmarkMetricsListener = listener; },
    lights,
    () => renderBundlesEnabled,
    () => forwardPlusDepthOptimizationEnabled,
    rendererModes,
    mode => mode !== renderModes.naive
);
