import type { PhraseId } from './phrases';

/**
 * Phrase id -> bundled mp3 (made by `npm run phrases`). Typed against PHRASES, so adding a phrase
 * without its audio file is a compile error. Metro resolves each require() to an asset id.
 */
export const BUNDLED_PHRASES: Record<PhraseId, number> = {
  crash_check: require('../../../assets/audio/crash_check.mp3'),
  crash_confirmed: require('../../../assets/audio/crash_confirmed.mp3'),
  ran_stop: require('../../../assets/audio/ran_stop.mp3'),
  stop_sign_ahead: require('../../../assets/audio/stop_sign_ahead.mp3'),
  rolling_stop: require('../../../assets/audio/rolling_stop.mp3'),
  erratic_driving: require('../../../assets/audio/erratic_driving.mp3'),
  stop_ok: require('../../../assets/audio/stop_ok.mp3'),
  traffic_light_ahead: require('../../../assets/audio/traffic_light_ahead.mp3'),
  highway_merge: require('../../../assets/audio/highway_merge.mp3'),
  highway_exit: require('../../../assets/audio/highway_exit.mp3'),
  hotspot_rolling: require('../../../assets/audio/hotspot_rolling.mp3'),
  hotspot_ran: require('../../../assets/audio/hotspot_ran.mp3'),
  hotspot_erratic: require('../../../assets/audio/hotspot_erratic.mp3'),
};
