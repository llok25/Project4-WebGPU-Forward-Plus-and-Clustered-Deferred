import * as renderer from '../renderer';
import * as shaders from '../shaders/shaders';
import { Stage } from '../stage/stage';
import { createSceneRenderBundle, encodeSceneDraws } from './scene_draw';

export class ForwardPlusRenderer extends renderer.Renderer {
    private sceneBindGroupLayout: GPUBindGroupLayout;
    private sceneBindGroup: GPUBindGroup;
    private depthTexture: GPUTexture;
    private depthTextureView: GPUTextureView;
    private pipeline: GPURenderPipeline;
    private sceneRenderBundle: GPURenderBundle;

    constructor(stage: Stage) {
        super(stage);

        this.sceneBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "Forward+ scene bind group layout",
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: { type: "uniform" }
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: "read-only-storage" }
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: "read-only-storage" }
                },
                {
                    binding: 3,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: "uniform" }
                }
            ]
        });

        this.sceneBindGroup = renderer.device.createBindGroup({
            label: "Forward+ scene bind group",
            layout: this.sceneBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.camera.uniformsBuffer } },
                { binding: 1, resource: { buffer: this.lights.lightSetStorageBuffer } },
                { binding: 2, resource: { buffer: this.lights.clusterDataBuffer } },
                { binding: 3, resource: { buffer: this.camera.uniformsBuffer } }
            ]
        });

        this.depthTexture = renderer.device.createTexture({
            label: "Forward+ depth texture",
            size: [renderer.canvas.width, renderer.canvas.height],
            format: "depth24plus",
            usage: GPUTextureUsage.RENDER_ATTACHMENT
        });
        this.depthTextureView = this.depthTexture.createView();

        this.pipeline = renderer.device.createRenderPipeline({
            label: "Forward+ render pipeline",
            layout: renderer.device.createPipelineLayout({
                label: "Forward+ pipeline layout",
                bindGroupLayouts: [
                    this.sceneBindGroupLayout,
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
                    label: "Forward+ vertex shader",
                    code: shaders.naiveVertSrc
                }),
                buffers: [renderer.vertexBufferLayout]
            },
            fragment: {
                module: renderer.device.createShaderModule({
                    label: "Forward+ fragment shader",
                    code: shaders.forwardPlusFragSrc
                }),
                targets: [{ format: renderer.canvasFormat }]
            }
        });

        this.sceneRenderBundle = createSceneRenderBundle(
            this.scene,
            this.pipeline,
            this.sceneBindGroup,
            renderer.canvasFormat
        );
    }

    override draw() {
        const encoder = renderer.device.createCommandEncoder();
        this.lights.doLightClustering(encoder);

        const canvasTextureView = renderer.context.getCurrentTexture().createView();
        const renderPass = encoder.beginRenderPass({
            label: "Forward+ render pass",
            colorAttachments: [
                {
                    view: canvasTextureView,
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

        if (renderer.renderBundlesEnabled) {
            renderPass.executeBundles([this.sceneRenderBundle]);
        } else {
            encodeSceneDraws(renderPass, this.scene, this.pipeline, this.sceneBindGroup);
        }
        renderPass.end();

        renderer.device.queue.submit([encoder.finish()]);
    }
}
