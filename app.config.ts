import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Car Assistant',
  slug: 'car-assistant-wolfhacks',
  version: '0.1.0',
  orientation: 'portrait',
  scheme: 'carassistant',
  userInterfaceStyle: 'automatic',
  plugins: [
    'expo-router',
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
