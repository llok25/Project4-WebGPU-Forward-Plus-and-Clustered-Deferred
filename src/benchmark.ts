import { Lights } from './stage/lights';

type FrameMetrics = {
    frameIntervalMs: number;
    cpuSubmitMs: number;
};

type BenchmarkRow = {
    version: string;
    run_id: string;
    mode: string;
    sample_index: number;
    frame_interval_ms: number;
    cpu_submit_ms: number;
    num_lights: number;
    width_px: number;
    height_px: number;
    timestamp_utc: string;
    user_agent: string;
};

export class RendererBenchmark {
    private readonly startButton = document.querySelector<HTMLButtonElement>('#benchmark-start')!;
    private readonly stopButton = document.querySelector<HTMLButtonElement>('#benchmark-stop')!;
    private readonly downloadButton = document.querySelector<HTMLButtonElement>('#benchmark-download')!;
    private readonly status = document.querySelector<HTMLOutputElement>('#benchmark-status')!;
    private readonly versionInput = document.querySelector<HTMLInputElement>('#benchmark-version')!;
    private readonly warmupInput = document.querySelector<HTMLInputElement>('#benchmark-warmup')!;
    private readonly samplesInput = document.querySelector<HTMLInputElement>('#benchmark-samples')!;

    private readonly rows: BenchmarkRow[] = [];
    private readonly runId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    private activeMode: string | undefined;
    private activeRows: BenchmarkRow[] = [];
    private running = false;
    private warmupStart = 0;
    private warmupMs = 0;
    private targetSamples = 0;
    private currentVersion = '';
    private completeCurrent: (() => void) | undefined;
    private modeTimeout: number | undefined;
    private modeError: Error | undefined;
    private stopped = false;

    constructor(
        private readonly setMode: (mode: string) => void,
        private readonly getMode: () => string,
        private readonly setMetricsListener: (
            listener: ((mode: string, metrics: FrameMetrics) => void) | undefined
        ) => void,
        private readonly lights: Lights,
        private readonly modes: string[]
    ) {
        this.startButton.addEventListener('click', () => { void this.run(); });
        this.stopButton.addEventListener('click', () => this.stop());
        this.downloadButton.addEventListener('click', () => this.downloadCsv());
    }

    private onFrame(mode: string, metrics: FrameMetrics) {
        if (!this.running || mode !== this.activeMode) {
            return;
        }

        if (performance.now() - this.warmupStart < this.warmupMs) {
            return;
        }

        const sampleIndex = this.activeRows.length + 1;
        const canvas = document.querySelector<HTMLCanvasElement>('#mainCanvas')!;
        const row: BenchmarkRow = {
            version: this.currentVersion,
            run_id: this.currentRunId,
            mode,
            sample_index: sampleIndex,
            frame_interval_ms: metrics.frameIntervalMs,
            cpu_submit_ms: metrics.cpuSubmitMs,
            num_lights: this.lights.numLights,
            width_px: canvas.width,
            height_px: canvas.height,
            timestamp_utc: new Date().toISOString(),
            user_agent: navigator.userAgent
        };
        this.activeRows.push(row);
        this.rows.push(row);

        if (sampleIndex === 1) {
            this.status.value = `${mode}: collecting ${this.targetSamples} samples...`;
        }
        if (sampleIndex % 50 === 0) {
            this.status.value = `${mode}: ${sampleIndex}/${this.targetSamples} samples`;
        }
        if (sampleIndex >= this.targetSamples) {
            this.finishCurrentMode();
        }
    }

    private currentRunId = '';

    private async run() {
        if (this.running) {
            return;
        }

        const version = this.versionInput.value.trim();
        const warmupSeconds = Number(this.warmupInput.value);
        const sampleCount = Number(this.samplesInput.value);
        if (!version || !Number.isFinite(warmupSeconds) || warmupSeconds < 0 ||
            warmupSeconds > 60 || !Number.isInteger(sampleCount) ||
            sampleCount < 10 || sampleCount > 10000) {
            this.status.value = 'Enter a build label, warm-up from 0-60 seconds, and 10-10000 samples.';
            return;
        }

        const previousMode = this.getMode();
        this.currentVersion = version;
        this.warmupMs = warmupSeconds * 1000;
        this.targetSamples = sampleCount;
        this.currentRunId = this.runId();
        this.stopped = false;
        this.running = true;
        this.startButton.disabled = true;
        this.stopButton.disabled = false;
        this.setMetricsListener((mode, metrics) => this.onFrame(mode, metrics));

        try {
            for (const mode of this.modes) {
                if (!this.running) {
                    break;
                }

                this.activeMode = mode;
                this.activeRows = [];
                this.status.value = `${mode}: switching renderer...`;
                this.setMode(mode);
                this.warmupStart = performance.now();

                await new Promise<void>(resolve => {
                    this.completeCurrent = resolve;
                    this.modeTimeout = window.setTimeout(() => {
                        this.modeError = new Error(`${mode}: timed out waiting for benchmark samples.`);
                        this.finishCurrentMode();
                    }, Math.max(120000, this.warmupMs + this.targetSamples * 100 + 60000));
                });

                if (this.modeError) {
                    throw this.modeError;
                }
            }
        } catch (error) {
            this.status.value = error instanceof Error ? error.message : String(error);
        } finally {
            this.running = false;
            this.activeMode = undefined;
            this.setMetricsListener(undefined);
            this.startButton.disabled = false;
            this.stopButton.disabled = true;
            if (this.rows.length > 0) {
                this.downloadButton.disabled = false;
            }
            this.setMode(previousMode);
            if (this.stopped) {
                this.status.value = `Stopped. Recorded ${this.rows.length} samples; download the CSV.`;
            } else if (!this.modeError) {
                this.status.value = `Done. Recorded ${this.rows.length} samples; download the CSV.`;
            }
            this.modeError = undefined;
        }
    }

    private finishCurrentMode() {
        if (this.modeTimeout !== undefined) {
            window.clearTimeout(this.modeTimeout);
            this.modeTimeout = undefined;
        }
        const complete = this.completeCurrent;
        this.completeCurrent = undefined;
        complete?.();
    }

    private stop() {
        if (!this.running) {
            return;
        }
        this.running = false;
        this.stopped = true;
        this.status.value = 'Stopping after the current renderer...';
        this.finishCurrentMode();
    }

    private downloadCsv() {
        if (this.rows.length === 0) {
            return;
        }

        const headers: (keyof BenchmarkRow)[] = [
            'version', 'run_id', 'mode', 'sample_index', 'frame_interval_ms',
            'cpu_submit_ms', 'num_lights', 'width_px', 'height_px',
            'timestamp_utc', 'user_agent'
        ];
        const escapeCell = (value: string | number) =>
            `"${String(value).replaceAll('"', '""')}"`;
        const csv = [
            headers.join(','),
            ...this.rows.map(row => headers.map(header => escapeCell(row[header])).join(','))
        ].join('\r\n');
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'renderer-benchmark.csv';
        link.click();
        URL.revokeObjectURL(url);
    }
}
