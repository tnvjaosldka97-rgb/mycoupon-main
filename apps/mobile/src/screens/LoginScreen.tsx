/**
 * LoginScreen — UI 완성도 개선
 * - CTAButton 공통 컴포넌트 사용
 * - authStep 디버그 표시 유지
 */
import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { ScreenContainer } from '../components/ScreenContainer';
import { CTAButton } from '../components/ui/CTAButton';
import { useAuth } from '../context/AuthContext';
import type { AuthStep } from '../context/AuthContext';
import { Colors } from '../theme/tokens';

const STEP_LABEL: Record<AuthStep, string> = {
  idle:                 '',
  opening_oauth:        '🌐 구글 로그인 창 여는 중...',
  callback_received:    '📲 콜백 수신 완료',
  ticket_extracted:     '🎫 티켓 추출 완료',
  app_exchange_pending: '🔄 세션 설정 중...',
  app_exchange_success: '✅ 세션 설정 완료',
  auth_me_pending:      '👤 사용자 정보 확인 중...',
  auth_me_success:      '✅ 사용자 확인 완료',
  login_complete:       '🎉 로그인 완료!',
  login_failed:         '❌ 로그인 실패',
};

export default function LoginScreen() {
  const { login, authLoading, authError, authStep } = useAuth();

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

        {/* 로그인 카드 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>시작하기</Text>
          <Text style={styles.cardSub}>구글 계정으로 30초만에 가입하세요</Text>

          {/* 인증 단계 디버그 */}
          {authStep !== 'idle' && authStep !== 'login_complete' && (
            <View style={[styles.stepBox, authStep === 'login_failed' ? styles.stepBoxFail : styles.stepBoxOk]}>
              <Text style={styles.stepText}>{STEP_LABEL[authStep]}</Text>
            </View>
          )}

          {/* 에러 */}
          {authError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>⚠️ {authError}</Text>
            </View>
          ) : null}

          {/* 로그인 버튼 */}
          <CTAButton
            label={authLoading ? '로그인 중...' : 'Google로 계속하기'}
            onPress={login}
            loading={authLoading}
            disabled={authLoading}
            style={styles.googleBtn}
          />

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
  heroArea:    { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  logoCircle:  { width: 88, height: 88, borderRadius: 44, backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  logoEmoji:   { fontSize: 52 },
  appName:     { fontSize: 38, fontWeight: '800', color: '#fff', letterSpacing: -0.5 },
  tagline:     { fontSize: 15, color: 'rgba(255,255,255,0.85)', fontWeight: '500' },
  tagRow:      { flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' },
  tagChip:     { backgroundColor: 'rgba(255,255,255,0.22)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  tagText:     { fontSize: 11, color: '#fff', fontWeight: '600' },
  card:        { backgroundColor: '#fff', borderRadius: 24, padding: 24, gap: 12, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 20, elevation: 8 },
  cardTitle:   { fontSize: 20, fontWeight: '800', color: Colors.text },
  cardSub:     { fontSize: 13, color: Colors.subtext, marginBottom: 4 },
  stepBox:     { borderRadius: 10, padding: 10, alignItems: 'center' },
  stepBoxOk:   { backgroundColor: '#ECFDF5' },
  stepBoxFail: { backgroundColor: '#FEF2F2' },
  stepText:    { fontSize: 13, fontWeight: '700' },
  errorBox:    { backgroundColor: '#FEF2F2', borderRadius: 10, padding: 12 },
  errorText:   { fontSize: 13, color: Colors.red, lineHeight: 20 },
  googleBtn:   { marginTop: 4 },
  terms:       { fontSize: 11, color: Colors.subtext, textAlign: 'center', lineHeight: 18 },
  termsLink:   { color: Colors.primary, fontWeight: '600' },
  footer:      { textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 12 },
});
