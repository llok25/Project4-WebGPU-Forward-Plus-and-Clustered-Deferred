import * as renderer from '../renderer';
import * as shaders from '../shaders/shaders';
import { Stage } from '../stage/stage';

export class ClusteredDeferredRenderer extends renderer.Renderer {
    private gbufferSceneBindGroupLayout: GPUBindGroupLayout;
    private gbufferSceneBindGroup: GPUBindGroup;
    private lightingBindGroupLayout: GPUBindGroupLayout;
    private lightingBindGroup: GPUBindGroup;

    private positionTexture: GPUTexture;
    private normalTexture: GPUTexture;
    private albedoTexture: GPUTexture;
    private positionTextureView: GPUTextureView;
    private normalTextureView: GPUTextureView;
    private albedoTextureView: GPUTextureView;
    private depthTexture: GPUTexture;
    private depthTextureView: GPUTextureView;

    private gbufferPipeline: GPURenderPipeline;
    private fullscreenPipeline: GPURenderPipeline;

    constructor(stage: Stage) {
        super(stage);

        const textureSize: GPUExtent3D = [renderer.canvas.width, renderer.canvas.height];
        this.positionTexture = renderer.device.createTexture({
            label: "G-buffer position",
            size: textureSize,
            format: "rgba16float",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });
        this.normalTexture = renderer.device.createTexture({
            label: "G-buffer normal",
            size: textureSize,
            format: "rgba16float",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });
        this.albedoTexture = renderer.device.createTexture({
            label: "G-buffer albedo",
            size: textureSize,
            format: "rgba8unorm",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });
        this.positionTextureView = this.positionTexture.createView();
        this.normalTextureView = this.normalTexture.createView();
        this.albedoTextureView = this.albedoTexture.createView();

        this.depthTexture = renderer.device.createTexture({
            label: "G-buffer depth",
            size: textureSize,
            format: "depth24plus",
            usage: GPUTextureUsage.RENDER_ATTACHMENT
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
            label: "deferred lighting bind group layout",
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: "unfilterable-float" }
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: "unfilterable-float" }
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: "float" }
                },
                {
                    binding: 3,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: "read-only-storage" }
                },
                {
                    binding: 4,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: "read-only-storage" }
                },
                {
                    binding: 5,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: "uniform" }
                }
            ]
        });
        this.lightingBindGroup = renderer.device.createBindGroup({
            label: "deferred lighting bind group",
            layout: this.lightingBindGroupLayout,
            entries: [
                { binding: 0, resource: this.positionTextureView },
                { binding: 1, resource: this.normalTextureView },
                { binding: 2, resource: this.albedoTextureView },
                { binding: 3, resource: { buffer: this.lights.lightSetStorageBuffer } },
                { binding: 4, resource: { buffer: this.lights.clusterDataBuffer } },
                { binding: 5, resource: { buffer: this.camera.uniformsBuffer } }
            ]
        });

        this.gbufferPipeline = renderer.device.createRenderPipeline({
            label: "G-buffer pipeline",
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
                    label: "G-buffer fragment shader",
                    code: shaders.clusteredDeferredFragSrc
                }),
                targets: [
                    { format: "rgba16float" },
                    { format: "rgba16float" },
                    { format: "rgba8unorm" }
                ]
            }
        });

        this.fullscreenPipeline = renderer.device.createRenderPipeline({
            label: "deferred fullscreen pipeline",
            layout: renderer.device.createPipelineLayout({
                label: "deferred fullscreen pipeline layout",
                bindGroupLayouts: [this.lightingBindGroupLayout]
            }),
            vertex: {
                module: renderer.device.createShaderModule({
                    label: "deferred fullscreen vertex shader",
                    code: shaders.clusteredDeferredFullscreenVertSrc
                })
            },
            fragment: {
                module: renderer.device.createShaderModule({
                    label: "deferred fullscreen fragment shader",
                    code: shaders.clusteredDeferredFullscreenFragSrc
                }),
                targets: [{ format: renderer.canvasFormat }]
            }
        });
    }

    override draw() {
        const encoder = renderer.device.createCommandEncoder();
        this.lights.doLightClustering(encoder);

        const gbufferPass = encoder.beginRenderPass({
            label: "G-buffer pass",
            colorAttachments: [
                {
                    view: this.positionTextureView,
                    clearValue: [0, 0, 0, 0],
                    loadOp: "clear",
                    storeOp: "store"
                },
                {
                    view: this.normalTextureView,
                    clearValue: [0, 0, 0, 0],
                    loadOp: "clear",
                    storeOp: "store"
                },
                {
                    view: this.albedoTextureView,
                    clearValue: [0, 0, 0, 0],
                    loadOp: "clear",
                    storeOp: "store"
                }
            ],
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

        const lightingPass = encoder.beginRenderPass({
            label: "deferred lighting pass",
            colorAttachments: [{
                view: renderer.context.getCurrentTexture().createView(),
                clearValue: [0, 0, 0, 0],
                loadOp: "clear",
                storeOp: "store"
            }]
        });
        lightingPass.setPipeline(this.fullscreenPipeline);
        lightingPass.setBindGroup(shaders.constants.bindGroup_scene, this.lightingBindGroup);
        lightingPass.draw(3);
        lightingPass.end();

        renderer.device.queue.submit([encoder.finish()]);
    }
}
