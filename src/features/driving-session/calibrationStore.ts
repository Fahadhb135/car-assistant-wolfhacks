import { File, Paths } from 'expo-file-system';

import { isVehicleFrameCalibration, type VehicleFrameCalibration } from '../../core/imu';

type CalibrationMap = Record<string, VehicleFrameCalibration>;

const file = new File(Paths.document, 'sensortile-calibrations.json');

async function readAll(): Promise<CalibrationMap> {
  if (!file.exists) return {};
  try {
    const parsed: unknown = JSON.parse(await file.text());
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, VehicleFrameCalibration] =>
        isVehicleFrameCalibration(entry[1])),
    );
  } catch {
    return {};
  }
}

async function writeAll(calibrations: CalibrationMap): Promise<void> {
  file.create({ overwrite: true, intermediates: true });
  file.write(JSON.stringify(calibrations));
}

export async function loadSensorCalibration(deviceId: string): Promise<VehicleFrameCalibration | undefined> {
  return (await readAll())[deviceId];
}

export async function saveSensorCalibration(deviceId: string, calibration: VehicleFrameCalibration): Promise<void> {
  const calibrations = await readAll();
  calibrations[deviceId] = calibration;
  await writeAll(calibrations);
}

export async function deleteSensorCalibration(deviceId: string): Promise<void> {
  const calibrations = await readAll();
  delete calibrations[deviceId];
  await writeAll(calibrations);
}
