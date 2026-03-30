import React from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { Colors, Spacing } from '../../theme/tokens';

interface Props {
  message?: string;
}

export function LoadingState({ message = '불러오는 중...' }: Props) {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={Colors.primary} />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: 60 },
  text:      { fontSize: 14, color: Colors.subtext, marginTop: 8 },
});
