import * as renderer from '../renderer';
import * as shaders from '../shaders/shaders';
import { Stage } from '../stage/stage';

export class ClusteredDeferredRenderer extends renderer.Renderer {
    private gbufferSceneBindGroupLayout: GPUBindGroupLayout;
    private gbufferSceneBindGroup: GPUBindGroup;
    private lightingBindGroupLayout: GPUBindGroupLayout;

    private gbufferTexture: GPUTexture;
    private gbufferTextureView: GPUTextureView;
    private depthTexture: GPUTexture;
    private depthTextureView: GPUTextureView;

    private gbufferPipeline: GPURenderPipeline;
    private lightingPipeline: GPUComputePipeline;

    constructor(stage: Stage) {
        super(stage);

        const textureSize: GPUExtent3D = [renderer.canvas.width, renderer.canvas.height];
        this.gbufferTexture = renderer.device.createTexture({
            label: "compact G-buffer",
            size: textureSize,
            format: "rg32uint",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });
        this.gbufferTextureView = this.gbufferTexture.createView();

        this.depthTexture = renderer.device.createTexture({
            label: "G-buffer depth",
            size: textureSize,
            format: "depth24plus",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });
        this.depthTextureView = this.depthTexture.createView();

        this.gbufferSceneBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "G-buffer scene bind group layout",
            entries: [{
                binding: 0,
                visibility: GPUShaderStage.VERTEX,
                buffer: { type: "uniform" }
            }]
        });
        this.gbufferSceneBindGroup = renderer.device.createBindGroup({
            label: "G-buffer scene bind group",
            layout: this.gbufferSceneBindGroupLayout,
            entries: [{
                binding: 0,
                resource: { buffer: this.camera.uniformsBuffer }
            }]
        });

        this.lightingBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "deferred compute lighting bind group layout",
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    texture: { sampleType: "uint" }
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    texture: { sampleType: "depth" }
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "read-only-storage" }
                },
                {
                    binding: 3,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "read-only-storage" }
                },
                {
                    binding: 4,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "uniform" }
                },
                {
                    binding: 5,
                    visibility: GPUShaderStage.COMPUTE,
                    storageTexture: { access: "write-only", format: renderer.canvasFormat }
                }
            ]
        });

        this.gbufferPipeline = renderer.device.createRenderPipeline({
            label: "compact G-buffer pipeline",
            layout: renderer.device.createPipelineLayout({
                label: "G-buffer pipeline layout",
                bindGroupLayouts: [
                    this.gbufferSceneBindGroupLayout,
                    renderer.modelBindGroupLayout,
                    renderer.materialBindGroupLayout
                ]
            }),
            depthStencil: {
                depthWriteEnabled: true,
                depthCompare: "less",
                format: "depth24plus"
            },
            vertex: {
                module: renderer.device.createShaderModule({
                    label: "G-buffer vertex shader",
                    code: shaders.naiveVertSrc
                }),
                buffers: [renderer.vertexBufferLayout]
            },
            fragment: {
                module: renderer.device.createShaderModule({
                    label: "compact G-buffer fragment shader",
                    code: shaders.clusteredDeferredFragSrc
                }),
                targets: [{ format: "rg32uint" }]
            }
        });

        this.lightingPipeline = renderer.device.createComputePipeline({
            label: "deferred compute lighting pipeline",
            layout: renderer.device.createPipelineLayout({
                label: "deferred compute lighting pipeline layout",
                bindGroupLayouts: [this.lightingBindGroupLayout]
            }),
            compute: {
                module: renderer.device.createShaderModule({
                    label: "deferred compute lighting shader",
                    code: shaders.clusteredDeferredLightingComputeSrc.replace(
                        "rgba8unorm",
                        renderer.canvasFormat
                    )
                }),
                entryPoint: "main"
            }
        });
    }

    override draw() {
        const encoder = renderer.device.createCommandEncoder();
        this.lights.doLightClustering(encoder);

        const gbufferPass = encoder.beginRenderPass({
            label: "compact G-buffer pass",
            colorAttachments: [{
                view: this.gbufferTextureView,
                clearValue: [0, 0, 0, 0],
                loadOp: "clear",
                storeOp: "store"
            }],
            depthStencilAttachment: {
                view: this.depthTextureView,
                depthClearValue: 1,
                depthLoadOp: "clear",
                depthStoreOp: "store"
            }
        });

        gbufferPass.setPipeline(this.gbufferPipeline);
        gbufferPass.setBindGroup(shaders.constants.bindGroup_scene, this.gbufferSceneBindGroup);
        this.scene.iterate(node => {
            gbufferPass.setBindGroup(shaders.constants.bindGroup_model, node.modelBindGroup);
        }, material => {
            gbufferPass.setBindGroup(shaders.constants.bindGroup_material, material.materialBindGroup);
        }, primitive => {
            gbufferPass.setVertexBuffer(0, primitive.vertexBuffer);
            gbufferPass.setIndexBuffer(primitive.indexBuffer, 'uint32');
            gbufferPass.drawIndexed(primitive.numIndices);
        });
        gbufferPass.end();

        const outputTextureView = renderer.context.getCurrentTexture().createView();
        const lightingBindGroup = renderer.device.createBindGroup({
            label: "deferred compute lighting bind group",
            layout: this.lightingBindGroupLayout,
            entries: [
                { binding: 0, resource: this.gbufferTextureView },
                { binding: 1, resource: this.depthTextureView },
                { binding: 2, resource: { buffer: this.lights.lightSetStorageBuffer } },
                { binding: 3, resource: { buffer: this.lights.clusterDataBuffer } },
                { binding: 4, resource: { buffer: this.camera.uniformsBuffer } },
                { binding: 5, resource: outputTextureView }
            ]
        });

        const lightingPass = encoder.beginComputePass({ label: "deferred compute lighting pass" });
        lightingPass.setPipeline(this.lightingPipeline);
        lightingPass.setBindGroup(0, lightingBindGroup);
        lightingPass.dispatchWorkgroups(
            Math.ceil(renderer.canvas.width / shaders.constants.deferredWorkgroupSize),
            Math.ceil(renderer.canvas.height / shaders.constants.deferredWorkgroupSize)
        );
        lightingPass.end();

        renderer.device.queue.submit([encoder.finish()]);
    }
}
