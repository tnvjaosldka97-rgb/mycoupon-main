import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors, Spacing } from '../../theme/tokens';

interface Props {
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({ message = '오류가 발생했습니다.', onRetry }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.icon}>⚠️</Text>
      <Text style={styles.message}>{message}</Text>
      {onRetry ? (
        <TouchableOpacity style={styles.retryBtn} onPress={onRetry}>
          <Text style={styles.retryText}>다시 시도</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 12 },
  icon:      { fontSize: 40 },
  message:   { fontSize: 14, color: Colors.subtext, textAlign: 'center', paddingHorizontal: 32, lineHeight: 22 },
  retryBtn:  { backgroundColor: Colors.primary, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20, marginTop: 8 },
  retryText: { color: Colors.white, fontSize: 14, fontWeight: '700' },
});
