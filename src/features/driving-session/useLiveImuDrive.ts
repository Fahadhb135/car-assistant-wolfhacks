import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import type { DriveEvent } from '../../core/events/types';
import { ImuPipeline } from '../../core/imu';
import { ReactNativeBleClient, StevalMkboxProSensorSource } from '../../integrations/bluetooth';
import type { VoiceCoordinator } from '../voice/VoiceCoordinator';
import { CLEAR_ROAD, coachMessage, type CoachMessage } from './coachMessage';
import { ImuEventRouter } from './ImuEventRouter';

export type LiveImuStatus = 'idle' | 'connecting' | 'starting' | 'running' | 'error' | 'stopped';

type Runtime = {
  cancelled: boolean;
  disposed: boolean;
  client: ReactNativeBleClient;
  source: StevalMkboxProSensorSource | null;
  startup: Promise<void>;
};

const CALM_AFTER_MS = 8_000;

async function dispose(runtime: Runtime): Promise<void> {
  if (runtime.disposed) return;
  runtime.disposed = true;
  try {
    await runtime.source?.stop();
  } catch {
    // Continue destroying the native BLE manager after best-effort stop_log cleanup.
  }
  try {
    await runtime.client.destroy();
  } catch {
    // The connection may already have disappeared.
  }
}

/** Owns the BLE connection and routes normalized live IMU events for one drive screen. */
export function useLiveImuDrive(
  enabled: boolean,
  deviceId: string | undefined,
  voice: Pick<VoiceCoordinator, 'handleEvent'>,
): Readonly<{
  status: LiveImuStatus;
  error: string | null;
  coach: CoachMessage;
  eventsRef: React.MutableRefObject<DriveEvent[]>;
  /** Adds an event from another live source (e.g. location coaching) to the trip and coach card. */
  recordEvent: (event: DriveEvent) => void;
  stop: () => Promise<void>;
}> {
  const [status, setStatus] = useState<LiveImuStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [coach, setCoach] = useState<CoachMessage>(CLEAR_ROAD);
  const eventsRef = useRef<DriveEvent[]>([]);
  const runtimeRef = useRef<Runtime | null>(null);
  const calmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recordEvent = useCallback((event: DriveEvent) => {
    eventsRef.current.push(event);
    setCoach(coachMessage(event));
    if (calmTimerRef.current) clearTimeout(calmTimerRef.current);
    calmTimerRef.current = setTimeout(() => setCoach(CLEAR_ROAD), CALM_AFTER_MS);
  }, []);

  const stop = useCallback(async () => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.cancelled = true;
    // Destroying the client first also interrupts a connection/discovery that is still in flight;
    // ending a drive must not wait through every BLE discovery retry.
    await dispose(runtime);
    await runtime.startup.catch(() => undefined);
    if (runtimeRef.current === runtime) runtimeRef.current = null;
    setStatus('stopped');
  }, []);

  useEffect(() => {
    if (!enabled) return;
    eventsRef.current = [];
    setCoach(CLEAR_ROAD);
    setError(null);

    if (!deviceId) {
      setStatus('error');
      setError('Choose a SensorTile before starting a live drive.');
      return;
    }
    if (Platform.OS === 'web') {
      setStatus('error');
      setError('Live Bluetooth driving requires the iOS or Android development build.');
      return;
    }

    const client = new ReactNativeBleClient();
    const runtime: Runtime = {
      cancelled: false,
      disposed: false,
      client,
      source: null,
      startup: Promise.resolve(),
    };
    runtimeRef.current = runtime;

    runtime.startup = (async () => {
      try {
        setStatus('connecting');
        await client.connectAndInspect(deviceId);
        if (runtime.cancelled) return;

        const source = new StevalMkboxProSensorSource(client);
        runtime.source = source;
        const pipeline = new ImuPipeline();
        const eventRouter = new ImuEventRouter({ voice, onEvent: recordEvent });

        setStatus('starting');
        await source.start(
          (sample) => {
            const result = pipeline.process(sample);
            for (const candidate of result.events) eventRouter.route(candidate);
          },
          (sourceError) => {
            setError(sourceError.message);
            console.warn('[live IMU]', sourceError.message);
          },
        );
        if (!runtime.cancelled) setStatus('running');
      } catch (cause) {
        if (!runtime.cancelled) {
          setStatus('error');
          setError(cause instanceof Error ? cause.message : String(cause));
        }
        await dispose(runtime);
        if (runtimeRef.current === runtime) runtimeRef.current = null;
      }
    })();

    return () => {
      runtime.cancelled = true;
      if (calmTimerRef.current) clearTimeout(calmTimerRef.current);
      void dispose(runtime).then(() => runtime.startup.catch(() => undefined));
      if (runtimeRef.current === runtime) runtimeRef.current = null;
    };
  }, [deviceId, enabled, recordEvent, voice]);

  return { status, error, coach, eventsRef, recordEvent, stop };
}
