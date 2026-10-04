import { useSyncExternalStore } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Divider, IconButton, Modal, Portal, Switch, Text } from 'react-native-paper';

import {
  clampSensitivity,
  clampTurnHeading,
  DEFAULT_IMU_TUNING,
  describeThreshold,
  DETECTOR_KEYS,
  SENSITIVITY,
  TURN_HEADING,
  type DetectorKey,
  type ImuTuning,
  type MotionPeaks,
} from '@/core/imu';
import { colors } from '@/theme';

import { getImuTuning, setImuTuning, subscribeImuTuning } from './tuningStore';

const LABELS: Record<DetectorKey, string> = {
  crash: 'Crash',
  hardBraking: 'Firm braking',
  rapidAcceleration: 'Quick acceleration',
  harshCornering: 'Sharp turn',
  swerve: 'Swerve (unsteady)',
};

function Stepper({ value, label, onChange, step, min, max, disabled }: Readonly<{
  value: number;
  label: string;
  onChange: (value: number) => void;
  step: number;
  min: number;
  max: number;
  disabled?: boolean;
}>) {
  return (
    <View style={styles.stepper}>
      <IconButton icon="minus" mode="contained-tonal" size={22} disabled={disabled || value <= min} onPress={() => onChange(value - step)} />
      <Text variant="titleMedium" style={styles.stepperValue}>{label}</Text>
      <IconButton icon="plus" mode="contained-tonal" size={22} disabled={disabled || value >= max} onPress={() => onChange(value + step)} />
    </View>
  );
}

/** Live heuristic tuning: changes apply to the running drive immediately and are saved on the phone. */
export function TuningPanel({ visible, onDismiss, motion }: Readonly<{
  visible: boolean;
  onDismiss: () => void;
  motion: MotionPeaks | null;
}>) {
  const tuning = useSyncExternalStore(subscribeImuTuning, getImuTuning);
  const update = (change: (current: ImuTuning) => ImuTuning) => setImuTuning(change(getImuTuning()));
  const setDetector = (key: DetectorKey, patch: Partial<ImuTuning['detectors'][DetectorKey]>) =>
    update((current) => ({
      ...current,
      detectors: { ...current.detectors, [key]: { ...current.detectors[key], ...patch } },
    }));

  return (
    <Portal>
      <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={styles.sheet}>
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Text variant="titleLarge" style={styles.title}>Tune detection</Text>
            <Button onPress={onDismiss}>Done</Button>
          </View>
          <Text variant="bodySmall" style={styles.live}>
            {motion
              ? `Last 2 s: brake ${Math.max(0, -motion.minimumForwardG).toFixed(2)} g · accel ${Math.max(0, motion.maximumForwardG).toFixed(2)} g · side ${motion.maximumLateralG.toFixed(2)} g · turn ${motion.maximumYawDps.toFixed(0)}°/s · tilt ${motion.maximumTiltRateDps.toFixed(0)}°/s`
              : 'Waiting for sensor data (needs calibration)…'}
          </Text>
          <Text variant="bodySmall" style={styles.hint}>Higher sensitivity lowers the thresholds. Changes apply instantly.</Text>

          <Divider style={styles.divider} />
          <View style={styles.row}>
            <View style={styles.label}>
              <Text variant="titleMedium" style={styles.overallTitle}>All detectors</Text>
              <Text variant="bodySmall" style={styles.detail}>Multiplies every sensitivity below</Text>
            </View>
            <Stepper
              value={tuning.overallSensitivity}
              label={`${tuning.overallSensitivity.toFixed(1)}×`}
              step={SENSITIVITY.step}
              min={SENSITIVITY.min}
              max={SENSITIVITY.max}
              onChange={(value) => update((current) => ({ ...current, overallSensitivity: clampSensitivity(value) }))}
            />
          </View>

          {DETECTOR_KEYS.map((key) => {
            const detector = tuning.detectors[key];
            return (
              <View key={key}>
                <Divider style={styles.divider} />
                <View style={styles.row}>
                  <Text variant="titleMedium" style={styles.label}>{LABELS[key]}</Text>
                  <Switch value={detector.enabled} onValueChange={(enabled) => setDetector(key, { enabled })} />
                </View>
                <View style={styles.row}>
                  <Text variant="bodySmall" style={[styles.detail, !detector.enabled && styles.off]}>
                    {describeThreshold(key, tuning)}
                  </Text>
                  <Stepper
                    value={detector.sensitivity}
                    label={`${detector.sensitivity.toFixed(1)}×`}
                    step={SENSITIVITY.step}
                    min={SENSITIVITY.min}
                    max={SENSITIVITY.max}
                    disabled={!detector.enabled}
                    onChange={(value) => setDetector(key, { sensitivity: clampSensitivity(value) })}
                  />
                </View>
              </View>
            );
          })}

          <Divider style={styles.divider} />
          <View style={styles.row}>
            <View style={styles.label}>
              <Text variant="titleMedium">Ignore tilting</Text>
              <Text variant="bodySmall" style={styles.detail}>Skip braking/turn/accel while the sensor tips over 45°/s</Text>
            </View>
            <Switch value={tuning.tiltGuard} onValueChange={(tiltGuard) => update((current) => ({ ...current, tiltGuard }))} />
          </View>
          <Divider style={styles.divider} />
          <View style={styles.row}>
            <View style={styles.label}>
              <Text variant="titleMedium">Sharp-turn arc</Text>
              <Text variant="bodySmall" style={styles.detail}>Heading a turn must sweep; swerves stay below it</Text>
            </View>
            <Stepper
              value={tuning.turnHeadingDeg}
              label={`${tuning.turnHeadingDeg}°`}
              step={TURN_HEADING.step}
              min={TURN_HEADING.min}
              max={TURN_HEADING.max}
              onChange={(value) => update((current) => ({ ...current, turnHeadingDeg: clampTurnHeading(value) }))}
            />
          </View>

          <Button mode="outlined" style={styles.reset} onPress={() => setImuTuning(DEFAULT_IMU_TUNING)}>
            Reset to defaults
          </Button>
        </ScrollView>
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: colors.paper, borderRadius: 22, margin: 16, maxHeight: '88%', padding: 18 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  title: { color: colors.ink, fontWeight: '800' },
  live: { backgroundColor: '#173A2A', borderRadius: 10, color: '#D8E2DC', marginTop: 8, padding: 10 },
  hint: { color: colors.muted, marginTop: 8 },
  divider: { marginVertical: 8 },
  row: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
  label: { color: colors.ink, flex: 1, fontWeight: '700' },
  overallTitle: { color: colors.forest, fontWeight: '800' },
  detail: { color: colors.muted, flex: 1 },
  off: { opacity: 0.4 },
  stepper: { alignItems: 'center', flexDirection: 'row' },
  stepperValue: { color: colors.ink, fontWeight: '800', minWidth: 48, textAlign: 'center' },
  reset: { marginTop: 14 },
});
