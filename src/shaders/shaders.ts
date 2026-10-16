// CHECKITOUT: this file loads all the shaders and preprocesses them with some common code

import commonRaw from './common.wgsl?raw';

import naiveVertRaw from './naive.vs.wgsl?raw';
import naiveFragRaw from './naive.fs.wgsl?raw';

import forwardPlusFragRaw from './forward_plus.fs.wgsl?raw';

import clusteredDeferredFragRaw from './clustered_deferred.fs.wgsl?raw';
import clusteredDeferredLightingComputeRaw from './clustered_deferred_lighting.cs.wgsl?raw';

import moveLightsComputeRaw from './move_lights.cs.wgsl?raw';
import clusteringComputeRaw from './clustering.cs.wgsl?raw';

// CONSTANTS (for use in shaders)
// =================================

// CHECKITOUT: feel free to add more constants here and to refer to them in your shader code

// Note that these are declared in a somewhat roundabout way because otherwise minification will drop variables
// that are unused in host side code.
export const constants = {
    bindGroup_scene: 0,
    bindGroup_model: 1,
    bindGroup_material: 2,

    moveLightsWorkgroupSize: 128,
    clusteringWorkgroupSize: 64,
    clusterTileSize: 64,
    clusterDepthSlices: 16,
    maxLightsPerCluster: 128,
    deferredWorkgroupSize: 8,

    lightRadius: 2
};

// =================================

function evalShaderRaw(raw: string): string {
    return raw.replace(
        /\$\{(\w+)\}/g,
        (_, name: string) => {
            const value = constants[name as keyof typeof constants];

            if (value === undefined) {
                throw new Error(`Missing shader constant: ${name}`);
            }

            return String(value);
        }
    );
}

const commonSrc: string = evalShaderRaw(commonRaw);

function processShaderRaw(raw: string) {
    return commonSrc + evalShaderRaw(raw);
}

export const naiveVertSrc: string = processShaderRaw(naiveVertRaw);
export const naiveFragSrc: string = processShaderRaw(naiveFragRaw);

export const forwardPlusFragSrc: string = processShaderRaw(forwardPlusFragRaw);

export const clusteredDeferredFragSrc: string = processShaderRaw(clusteredDeferredFragRaw);
export const clusteredDeferredLightingComputeSrc: string = processShaderRaw(clusteredDeferredLightingComputeRaw);

export const moveLightsComputeSrc: string = processShaderRaw(moveLightsComputeRaw);
export const clusteringComputeSrc: string = processShaderRaw(clusteringComputeRaw);
