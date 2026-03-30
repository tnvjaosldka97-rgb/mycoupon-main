import React from 'react';
import { TouchableOpacity, Text, ActivityIndicator, StyleSheet, ViewStyle } from 'react-native';
import { Colors, Radius, Shadow } from '../../theme/tokens';

interface Props {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'outline' | 'ghost';
  style?: ViewStyle;
}

export function CTAButton({ label, onPress, loading, disabled, variant = 'primary', style }: Props) {
  const isPrimary = variant === 'primary';
  const isOutline = variant === 'outline';

  return (
    <TouchableOpacity
      style={[
        styles.base,
        isPrimary && styles.primary,
        isOutline && styles.outline,
        variant === 'ghost' && styles.ghost,
        (disabled || loading) && styles.disabled,
        style,
      ]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.82}
    >
      {loading
        ? <ActivityIndicator size="small" color={isPrimary ? Colors.white : Colors.primary} />
        : <Text style={[styles.label, !isPrimary && styles.labelAlt]}>{label}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base:     { borderRadius: Radius.lg, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  primary:  { backgroundColor: Colors.primary, ...Shadow.primary },
  outline:  { backgroundColor: Colors.white, borderWidth: 1.5, borderColor: Colors.primary },
  ghost:    { backgroundColor: 'transparent' },
  disabled: { opacity: 0.5 },
  label:    { fontSize: 15, fontWeight: '700', color: Colors.white },
  labelAlt: { color: Colors.primary },
});
