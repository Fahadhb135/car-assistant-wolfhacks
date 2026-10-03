import type { ImuSample } from './types';

export type SensorSampleListener = (sample: ImuSample) => void;
export type SensorErrorListener = (error: Error) => void;

/** Shared boundary implemented by live Bluetooth and recorded replay sources. */
export interface SensorSource {
  start(onSample: SensorSampleListener, onError: SensorErrorListener): Promise<void>;
  stop(): Promise<void>;
}
