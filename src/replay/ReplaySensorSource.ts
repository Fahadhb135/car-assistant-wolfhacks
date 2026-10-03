import type { SensorErrorListener, SensorSampleListener, SensorSource } from '../core/sensors/SensorSource';
import type { ImuSample } from '../core/sensors/types';

export class ReplaySensorSource implements SensorSource {
  private running = false;

  constructor(private readonly samples: readonly ImuSample[]) {}

  async start(onSample: SensorSampleListener, onError: SensorErrorListener): Promise<void> {
    if (this.running) throw new Error('ReplaySensorSource is already running');
    this.running = true;
    try {
      for (const sample of this.samples) {
        if (!this.running) break;
        onSample(sample);
      }
    } catch (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.running = false;
    }
  }

  async stop(): Promise<void> {
    this.running = false;
  }
}
