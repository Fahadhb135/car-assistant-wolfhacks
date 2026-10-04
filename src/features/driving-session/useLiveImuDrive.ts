import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import type { DriveEvent } from '../../core/events/types';
import { ImuPipeline, MountCalibrationCollector } from '../../core/imu';
import { ReactNativeBleClient, StevalMkboxProSensorSource } from '../../integrations/bluetooth';
import type { VoiceCoordinator } from '../voice/VoiceCoordinator';
import { deleteSensorCalibration, loadSensorCalibration, saveSensorCalibration } from './calibrationStore';
import { CLEAR_ROAD, coachMessage, type CoachMessage } from './coachMessage';
import {
  DriveEventGate,
  DriveEventRouter,
  type DriveEventGateSnapshot,
  type DriveEventSink,
} from './DriveEventGate';
import { ImuEventRouter } from './ImuEventRouter';

export type LiveImuStatus = 'idle' | 'connecting' | 'starting' | 'running' | 'error' | 'stopped';
export type CalibrationStatus = 'loading' | 'collecting' | 'ready' | 'error';

type Runtime = {
  cancelled: boolean;
  disposed: boolean;
  client: ReactNativeBleClient;
  source: StevalMkboxProSensorSource | null;
  pipeline: ImuPipeline | null;
  calibrationCollector: MountCalibrationCollector | null;
  startup: Promise<void>;
};

const CALM_AFTER_MS = 8_000;
/** How often a dev build logs the smoothed motion peaks to Metro, for tuning the thresholds. */
const MOTION_LOG_INTERVAL_MS = 2_000;

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

/** Owns BLE, stationary mount calibration, and normalized live IMU events for one drive screen. */
export function useLiveImuDrive(
  enabled: boolean,
  deviceId: string | undefined,
  voice: Pick<VoiceCoordinator, 'handleEvent'>,
): Readonly<{
  status: LiveImuStatus;
  error: string | null;
  calibrationStatus: CalibrationStatus;
  calibrationMessage: string;
  coach: CoachMessage;
  eventsRef: React.MutableRefObject<DriveEvent[]>;
  /** Single gated sink shared by live IMU and location coaching. */
  eventSink: DriveEventSink;
  suppression: DriveEventGateSnapshot;
  recalibrate: () => Promise<void>;
  stop: () => Promise<void>;
}> {
  const [status, setStatus] = useState<LiveImuStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [calibrationStatus, setCalibrationStatus] = useState<CalibrationStatus>('loading');
  const [calibrationMessage, setCalibrationMessage] = useState('Checking sensor calibration…');
  const [coach, setCoach] = useState<CoachMessage>(CLEAR_ROAD);
  const eventsRef = useRef<DriveEvent[]>([]);
  const runtimeRef = useRef<Runtime | null>(null);
  const calmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventRouterRef = useRef<DriveEventRouter | null>(null);
  const [suppression, setSuppression] = useState<DriveEventGateSnapshot>({
    quiet: false,
    quietUntilMonotonicMs: null,
    quietRemainingMs: 0,
    admittedCount: 0,
    suppressedCount: 0,
    suppressedByKind: {},
  });

  const retainEvent = useCallback((event: DriveEvent) => {
    eventsRef.current.push(event);
    setCoach(coachMessage(event));
    if (calmTimerRef.current) clearTimeout(calmTimerRef.current);
    calmTimerRef.current = setTimeout(() => setCoach(CLEAR_ROAD), CALM_AFTER_MS);
  }, []);
  const routeEvent = useCallback((event: DriveEvent) => eventRouterRef.current?.route(event) ?? false, []);
  const eventSink = useMemo<DriveEventSink>(() => ({ route: routeEvent }), [routeEvent]);

  const recalibrate = useCallback(async () => {
    const runtime = runtimeRef.current;
    if (!runtime || !deviceId) return;
    runtime.pipeline?.setVehicleCalibration(undefined);
    runtime.calibrationCollector = null;
    setCalibrationStatus('collecting');
    setCalibrationMessage('Park safely. Keep the board still with its X arrow facing forward.');
    await deleteSensorCalibration(deviceId).catch(() => undefined);
    if (runtimeRef.current === runtime && !runtime.cancelled) {
      runtime.calibrationCollector = new MountCalibrationCollector();
    }
  }, [deviceId]);

  const stop = useCallback(async () => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.cancelled = true;
    await dispose(runtime);
    await runtime.startup.catch(() => undefined);
    if (runtimeRef.current === runtime) runtimeRef.current = null;
    eventRouterRef.current = null;
    setStatus('stopped');
  }, []);

  useEffect(() => {
    if (!enabled) return;
    eventsRef.current = [];
    setCoach(CLEAR_ROAD);
    setError(null);
    const gate = new DriveEventGate();
    eventRouterRef.current = new DriveEventRouter({
      gate,
      voice,
      onEvent: retainEvent,
      onDecision: (decision) => setSuppression(decision.state),
    });
    setSuppression(gate.snapshot());
    setCalibrationStatus('loading');
    setCalibrationMessage('Checking sensor calibration…');

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
      pipeline: null,
      calibrationCollector: null,
      startup: Promise.resolve(),
    };
    runtimeRef.current = runtime;

    runtime.startup = (async () => {
      try {
        setStatus('connecting');
        await client.connectAndInspect(deviceId);
        if (runtime.cancelled) return;

        const source = new StevalMkboxProSensorSource(client);
        const pipeline = new ImuPipeline();
        runtime.source = source;
        runtime.pipeline = pipeline;
        const savedCalibration = await loadSensorCalibration(deviceId);
        if (runtime.cancelled) return;
        if (savedCalibration) {
          pipeline.setVehicleCalibration(savedCalibration);
          setCalibrationStatus('ready');
          setCalibrationMessage('Vehicle-frame calibration loaded.');
        } else {
          runtime.calibrationCollector = new MountCalibrationCollector();
          setCalibrationStatus('collecting');
          setCalibrationMessage('Park safely. Keep the board still with its X arrow facing forward.');
        }

        const eventRouter = new ImuEventRouter({ eventSink });

        setStatus('starting');
        let nextMotionLogAtMs = 0;
        await source.start(
          (sample) => {
            const result = pipeline.process(sample);
            if (__DEV__ && sample.receivedMonotonicMs >= nextMotionLogAtMs) {
              nextMotionLogAtMs = sample.receivedMonotonicMs + MOTION_LOG_INTERVAL_MS;
              const peaks = pipeline.takeMotionPeaks();
              if (peaks) {
                console.log(
                  `[imu] fwd ${peaks.minimumForwardG.toFixed(2)}..${peaks.maximumForwardG.toFixed(2)} g, `
                  + `lat ${peaks.maximumLateralG.toFixed(2)} g, yaw ${peaks.maximumYawDps.toFixed(0)}°/s, `
                  + `jerk ${peaks.maximumJerkGps.toFixed(2)} g/s`,
                );
              }
            }
            if (result.accepted) {
              const collector = runtime.calibrationCollector;
              if (collector) {
                const calibration = collector.add(sample);
                if (calibration.status === 'ready') {
                  runtime.calibrationCollector = null;
                  pipeline.setVehicleCalibration(calibration.calibration);
                  setCalibrationStatus('ready');
                  setCalibrationMessage('Sensor calibrated for braking, acceleration, and cornering.');
                  void saveSensorCalibration(deviceId, calibration.calibration).catch(() => {
                    setCalibrationMessage('Calibrated for this drive; saving the calibration failed.');
                  });
                } else if (calibration.status === 'rejected') {
                  setCalibrationStatus('error');
                  setCalibrationMessage(calibration.reason);
                }
              }
            }
            for (const candidate of result.events) {
              if (__DEV__) console.log(`[imu] ${candidate.kind}`, JSON.stringify(candidate.evidence));
              eventRouter.route(candidate);
            }
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
      eventRouterRef.current = null;
    };
  }, [deviceId, enabled, eventSink, retainEvent, voice]);

  return {
    status,
    error,
    calibrationStatus,
    calibrationMessage,
    coach,
    eventsRef,
    eventSink,
    suppression,
    recalibrate,
    stop,
  };
}
