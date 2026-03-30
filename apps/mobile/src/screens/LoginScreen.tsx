/**
 * LoginScreen — react-navigation 연결
 * useAuth().login() 호출 → RootNavigator가 MainTabs로 자동 전환
 */
import React from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { ScreenContainer } from '../components/ScreenContainer';
import { useAuth } from '../context/AuthContext';
import { Colors } from '../theme/tokens';

export default function LoginScreen() {
  const { login } = useAuth();

  return (
    <ScreenContainer bg={Colors.primary} edges={['top', 'bottom']}>
      <StatusBar style="light" />
      <View style={styles.inner}>
        {/* 히어로 */}
        <View style={styles.heroArea}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoEmoji}>🍊</Text>
          </View>
          <Text style={styles.appName}>마이쿠폰</Text>
          <Text style={styles.tagline}>내 주변 할인쿠폰을 한눈에</Text>
          <View style={styles.tagRow}>
            {['📍 GPS 기반', '🎁 실시간 쿠폰', '⚡ 무료 서비스'].map((t) => (
              <View key={t} style={styles.tagChip}>
                <Text style={styles.tagText}>{t}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* 카드 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>시작하기</Text>
          <Text style={styles.cardSub}>구글 계정으로 30초만에 가입하세요</Text>

          <TouchableOpacity style={styles.googleBtn} onPress={login} activeOpacity={0.85}>
            <View style={styles.googleIconBox}>
              <Text style={styles.googleG}>G</Text>
            </View>
            <Text style={styles.googleBtnText}>Google로 계속하기</Text>
          </TouchableOpacity>

          <View style={styles.mockBadge}>
            <Text style={styles.mockText}>⚡ 현재 목업 모드 — OAuth 미연결</Text>
          </View>

          <Text style={styles.terms}>
            계속하면{' '}
            <Text style={styles.termsLink}>이용약관</Text>
            {' '}및{' '}
            <Text style={styles.termsLink}>개인정보 처리방침</Text>에 동의합니다
          </Text>
        </View>
        <Text style={styles.footer}>© 2026 마이쿠폰</Text>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  inner: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'android' ? 24 : 12,
    paddingBottom: 24,
    backgroundColor: Colors.primary,
  },
  heroArea: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  logoCircle: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  logoEmoji: { fontSize: 52 },
  appName:   { fontSize: 38, fontWeight: '800', color: '#fff', letterSpacing: -0.5 },
  tagline:   { fontSize: 15, color: 'rgba(255,255,255,0.85)', fontWeight: '500' },
  tagRow:    { flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' },
  tagChip: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)',
  },
  tagText: { fontSize: 11, color: '#fff', fontWeight: '600' },
  card: {
    backgroundColor: '#fff', borderRadius: 24, padding: 24, gap: 12,
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 20, elevation: 8,
  },
  cardTitle: { fontSize: 20, fontWeight: '800', color: Colors.text },
  cardSub:   { fontSize: 13, color: Colors.subtext, marginBottom: 4 },
  googleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.text, borderRadius: 14, paddingVertical: 14, gap: 10,
  },
  googleIconBox: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
  },
  googleG:       { fontSize: 13, fontWeight: '800', color: '#4285F4' },
  googleBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  mockBadge: { backgroundColor: '#FFF7ED', borderRadius: 8, padding: 8, alignItems: 'center' },
  mockText:  { fontSize: 11, color: '#92400E' },
  terms:     { fontSize: 11, color: Colors.subtext, textAlign: 'center', lineHeight: 18 },
  termsLink: { color: Colors.primary, fontWeight: '600' },
  footer:    { textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 12 },
});
