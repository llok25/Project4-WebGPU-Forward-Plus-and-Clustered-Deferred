@group(0) @binding(0) var positionTexture: texture_2d<f32>;
@group(0) @binding(1) var normalTexture: texture_2d<f32>;
@group(0) @binding(2) var albedoTexture: texture_2d<f32>;
@group(0) @binding(3) var<storage, read> lightSet: LightSet;
@group(0) @binding(4) var<storage, read> clusterSet: ClusterSet;
@group(0) @binding(5) var<uniform> cameraUniforms: CameraUniforms;

const TILE_SIZE = ${clusterTileSize}u;
const DEPTH_SLICES = ${clusterDepthSlices}u;
const MAX_LIGHTS_PER_CLUSTER = ${maxLightsPerCluster}u;

@fragment
fn main(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
    let pixel = vec2i(fragCoord.xy);
    let positionSample = textureLoad(positionTexture, pixel, 0);
    let albedo = textureLoad(albedoTexture, pixel, 0);
    if (albedo.a < 0.5f) {
        discard;
    }

    let normal = normalize(textureLoad(normalTexture, pixel, 0).xyz);
    let screenSize = cameraUniforms.viewportAndProjection.xy;
    let gridSize = vec2u(ceil(screenSize / f32(TILE_SIZE)));
    let tileX = min(u32(pixel.x) / TILE_SIZE, gridSize.x - 1u);
    let tileY = min(u32(pixel.y) / TILE_SIZE, gridSize.y - 1u);
    let viewDepth = -(cameraUniforms.viewMat * vec4f(positionSample.xyz, 1.f)).z;
    let nearPlane = cameraUniforms.depthRange.x;
    let farPlane = cameraUniforms.depthRange.y;
    let depthSlice = u32(clamp(
        floor(log(max(viewDepth, nearPlane) / nearPlane) / log(farPlane / nearPlane)
            * f32(DEPTH_SLICES)),
        0.f,
        f32(DEPTH_SLICES - 1u)
    ));
    let clusterIdx = (depthSlice * gridSize.y + tileY) * gridSize.x + tileX;
    let clusterStride = MAX_LIGHTS_PER_CLUSTER + 1u;
    let clusterBase = clusterIdx * clusterStride;
    let clusterLightCount = clusterSet.data[clusterBase];

    var totalLightContrib = vec3f(0.f);
    if (clusterLightCount > MAX_LIGHTS_PER_CLUSTER) {
        for (var lightIdx = 0u; lightIdx < lightSet.numLights; lightIdx++) {
            totalLightContrib += calculateLightContrib(
                lightSet.lights[lightIdx],
                positionSample.xyz,
                normal
            );
        }
    } else {
        for (var listIdx = 0u; listIdx < clusterLightCount; listIdx++) {
            let lightIdx = clusterSet.data[clusterBase + 1u + listIdx];
            totalLightContrib += calculateLightContrib(
                lightSet.lights[lightIdx],
                positionSample.xyz,
                normal
            );
        }
    }

    return vec4f(albedo.rgb * totalLightContrib, 1.f);
}
