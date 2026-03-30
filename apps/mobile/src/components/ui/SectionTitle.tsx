import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Typography, Spacing } from '../../theme/tokens';

interface Props {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}

export function SectionTitle({ title, subtitle, right }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.left}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {right ? <View>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  left:     { flex: 1 },
  title:    { ...Typography.h3 },
  subtitle: { ...Typography.caption, marginTop: 2 },
});
