import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Surface, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LastDriveCard } from '@/features/parent-dashboard/LastDriveCard';
import { colors } from '@/theme';

export default function HomeRoute() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text variant="labelLarge" style={styles.eyebrow}>DRIVEWISE</Text>
            <Text variant="headlineMedium" style={styles.heading}>Your calm co-pilot.</Text>
          </View>
          <Surface style={styles.avatar} elevation={0} accessibilityLabel="Driver profile">
            <Text variant="titleMedium">AV</Text>
          </Surface>
        </View>

        <Card style={styles.hero} mode="contained">
          <Card.Content style={styles.heroContent}>
            <View style={styles.statusRow}>
              <View style={styles.liveDot} />
              <Text variant="labelLarge" style={styles.readyLabel}>SENSOR READY</Text>
            </View>
            <View style={styles.heroCopy}>
              <Text variant="displaySmall" style={styles.heroTitle}>Ready when{`\n`}you are.</Text>
              <Text variant="bodyLarge" style={styles.heroSubtitle}>
                We’ll watch the road with you and keep feedback simple.
              </Text>
            </View>
            <Button
              mode="contained"
              buttonColor={colors.white}
              textColor={colors.forestDeep}
              contentStyle={styles.primaryButtonContent}
              labelStyle={styles.primaryButtonLabel}
              icon="arrow-right"
              onPress={() => router.push('/sensor-setup')}
            >
              Start drive
            </Button>
          </Card.Content>
        </Card>

        <Button
          mode="outlined"
          icon="play-circle-outline"
          contentStyle={styles.secondaryButtonContent}
          onPress={() => router.push('/drive?mode=replay')}
        >
          Run replay demo
        </Button>

        <LastDriveCard />

        <Surface style={styles.privacyNote} elevation={0}>
          <Text variant="titleMedium">Designed for the road</Text>
          <Text variant="bodyMedium" style={styles.privacyCopy}>
            Live safety checks happen on your phone. Voice handles the details while you drive.
          </Text>
        </Surface>

        <Button
          mode="outlined"
          icon="chart-line"
          contentStyle={styles.secondaryButtonContent}
          onPress={() => router.push('/parent')}
        >
          Dashboard
        </Button>

        <Button
          compact
          mode="text"
          textColor={colors.muted}
          icon="bluetooth"
          onPress={() => router.push('/diagnostics')}
          style={styles.diagnostics}
        >
          Developer diagnostics
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.cream, flex: 1 },
  container: { gap: 18, padding: 20, paddingBottom: 36 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  eyebrow: { color: colors.leaf, fontWeight: '800', letterSpacing: 1.8 },
  heading: { color: colors.ink, fontWeight: '700', marginTop: 2 },
  avatar: { alignItems: 'center', backgroundColor: colors.mint, borderRadius: 24, height: 48, justifyContent: 'center', width: 48 },
  hero: { backgroundColor: colors.forestDeep, borderRadius: 28, overflow: 'hidden' },
  heroContent: { gap: 24, padding: 24 },
  statusRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  liveDot: { backgroundColor: '#79D69F', borderRadius: 5, height: 10, width: 10 },
  readyLabel: { color: '#A8DDBD', fontWeight: '800', letterSpacing: 1.2 },
  heroCopy: { gap: 10 },
  heroTitle: { color: colors.white, fontWeight: '800', letterSpacing: -1 },
  heroSubtitle: { color: '#C9D8CF', lineHeight: 25, maxWidth: 300 },
  primaryButtonContent: { height: 54, flexDirection: 'row-reverse' },
  primaryButtonLabel: { fontSize: 16, fontWeight: '800' },
  secondaryButtonContent: { height: 50 },
  privacyNote: { backgroundColor: colors.mint, borderRadius: 20, gap: 6, padding: 18 },
  privacyCopy: { color: colors.muted, lineHeight: 21 },
  diagnostics: { alignSelf: 'center', marginTop: 2 },
});
