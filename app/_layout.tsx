import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { PaperProvider } from 'react-native-paper';

import { appTheme, colors } from '@/theme';

export default function RootLayout() {
  return (
    <PaperProvider theme={appTheme}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.cream } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="sensor-setup" options={{ gestureEnabled: true }} />
        <Stack.Screen name="drive" options={{ gestureEnabled: false }} />
        <Stack.Screen name="trips/[id]" />
        <Stack.Screen name="share" />
        <Stack.Screen name="parent/index" />
        <Stack.Screen name="parent/link" />
        <Stack.Screen name="parent/speeding" />
        <Stack.Screen name="parent/trips/[id]" />
        <Stack.Screen
          name="diagnostics"
          options={{
            headerShown: true,
            title: 'Bluetooth diagnostics',
            headerStyle: { backgroundColor: colors.cream },
            headerTintColor: colors.ink,
            headerShadowVisible: false,
          }}
        />
      </Stack>
      <StatusBar style="dark" />
    </PaperProvider>
  );
}
