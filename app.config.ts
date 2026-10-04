import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Car Assistant',
  slug: 'car-assistant-wolfhacks',
  version: '0.1.0',
  orientation: 'portrait',
  scheme: 'carassistant',
  userInterfaceStyle: 'automatic',
  ios: {
    // Each developer signs with their own Apple team, so the bundle ID is set
    // per machine in .env rather than committed.
    bundleIdentifier: process.env.IOS_BUNDLE_IDENTIFIER,
  },
  plugins: [
    'expo-router',
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Allow Car Assistant to use your location to warn you about stop signs, traffic lights and highway ramps ahead.',
      },
    ],
    [
      'react-native-ble-plx',
      {
        bluetoothAlwaysPermission:
          'Allow Car Assistant to connect to the vehicle motion sensor.',
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
