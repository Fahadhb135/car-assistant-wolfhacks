import { StyleSheet, View } from 'react-native';
import { Button, Chip, Text } from 'react-native-paper';

import { colors } from '@/theme';
import { QUICK_QUESTIONS, type CoachChatApi } from './useCoachChat';

const STATUS: Partial<Record<CoachChatApi['state'], string>> = {
  listening: 'Listening…',
  thinking: 'Thinking…',
  error: "Couldn't hear that. Try again.",
};

/** Tap a question, or hold the button and ask out loud (when a recognizer is installed). For the passenger. */
export function CoachChatBar({ chat }: { chat: CoachChatApi }) {
  if (!chat.enabled) return null;
  return (
    <View style={styles.wrap}>
      <View style={styles.chips}>
        {QUICK_QUESTIONS.map((q) => (
          <Chip key={q} compact style={styles.chip} textStyle={styles.chipText} disabled={chat.state === 'thinking'} onPress={() => chat.ask(q)}>
            {q}
          </Chip>
        ))}
      </View>
      {chat.canTalk ? (
        <Button
          mode="contained-tonal"
          icon="microphone"
          onPressIn={chat.pressIn}
          onPressOut={chat.pressOut}
          accessibilityHint="Hold to ask the coach a question"
        >
          Hold to talk
        </Button>
      ) : null}
      {STATUS[chat.state] ? <Text variant="labelMedium" style={styles.status}>{STATUS[chat.state]}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10, paddingVertical: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: '#173A2A' },
  chipText: { color: '#D8E2DC' },
  status: { color: colors.mint, textAlign: 'center' },
});
