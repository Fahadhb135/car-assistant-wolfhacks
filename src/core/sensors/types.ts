export type Vector3 = Readonly<{
  x: number;
  y: number;
  z: number;
}>;

/** A normalized sample emitted by either live BLE or replay input. */
export type ImuSample = Readonly<{
  sequence?: number;
  deviceTimeMs?: number;
  receivedMonotonicMs: number;
  accelerationG: Vector3;
  angularVelocityDps: Vector3;
  frame: 'sensor';
}>;
