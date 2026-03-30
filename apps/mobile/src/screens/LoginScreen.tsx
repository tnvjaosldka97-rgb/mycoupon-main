/**
 * LoginScreen — UI Polish
 * - 그라디언트 배경 + 플로팅 카드 레이아웃
 * - 로고 + 태그라인 강조
 * - 구글 로그인 버튼 pill 스타일
 * - 약관 안내 개선
 * OAuth 실연동은 별도 브랜치에서 진행
 */
import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Platform,
} from 'react-native';
import { COLORS } from '../lib/constants';

interface Props {
  onLogin: () => void;
}

export default function LoginScreen({ onLogin }: Props) {
  return (
    <View style={styles.root}>
      {/* 배경 그라디언트 효과 (색상 레이어) */}
      <View style={styles.bgTop} />
      <View style={styles.bgBottom} />

      <SafeAreaView style={styles.inner}>
        {/* 로고 영역 */}
        <View style={styles.heroArea}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoEmoji}>🍊</Text>
          </View>
          <Text style={styles.appName}>마이쿠폰</Text>
          <Text style={styles.tagline}>내 주변 할인쿠폰을 한눈에</Text>
          <View style={styles.tagRow}>
            <TagChip label="📍 GPS 기반" />
            <TagChip label="🎁 실시간 쿠폰" />
            <TagChip label="⚡ 무료 서비스" />
          </View>
        </View>

        {/* 로그인 카드 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>시작하기</Text>
          <Text style={styles.cardSub}>구글 계정으로 30초만에 가입하세요</Text>

          {/* 구글 로그인 버튼 */}
          <TouchableOpacity style={styles.googleBtn} onPress={onLogin} activeOpacity={0.85}>
            <View style={styles.googleIconBox}>
              <Text style={styles.googleG}>G</Text>
            </View>
            <Text style={styles.googleBtnText}>Google로 계속하기</Text>
          </TouchableOpacity>

          {/* 목업 안내 */}
          <View style={styles.mockBadge}>
            <Text style={styles.mockText}>⚡ 현재 목업 모드 — OAuth 미연결</Text>
          </View>

          {/* 약관 */}
          <Text style={styles.terms}>
            계속하면{' '}
            <Text style={styles.termsLink}>이용약관</Text>
            {' '}및{' '}
            <Text style={styles.termsLink}>개인정보 처리방침</Text>
            에 동의합니다
          </Text>
        </View>

        <Text style={styles.footer}>© 2026 마이쿠폰</Text>
      </SafeAreaView>
    </View>
  );
}

function TagChip({ label }: { label: string }) {
  return (
    <View style={chipStyles.chip}>
      <Text style={chipStyles.text}>{label}</Text>
    </View>
  );
}

const chipStyles = StyleSheet.create({
  chip: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  text: { fontSize: 11, color: '#fff', fontWeight: '600' },
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.primary },
  bgTop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.primary,
    bottom: '40%',
  },
  bgBottom: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FFEEDD',
    top: '60%',
  },
  inner: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'android' ? 40 : 0,
    paddingBottom: 24,
  },
  // 히어로
  heroArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  logoCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  logoEmoji: { fontSize: 52 },
  appName: {
    fontSize: 38,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '500',
  },
  tagRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  // 카드
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 24,
    padding: 24,
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 8,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.text,
  },
  cardSub: {
    fontSize: 13,
    color: COLORS.subtext,
    marginBottom: 4,
  },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.text,
    borderRadius: 14,
    paddingVertical: 14,
    gap: 10,
    marginTop: 4,
  },
  googleIconBox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleG: {
    fontSize: 13,
    fontWeight: '800',
    color: '#4285F4',
  },
  googleBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  mockBadge: {
    backgroundColor: '#FFF7ED',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  mockText: { fontSize: 11, color: '#92400E' },
  terms: {
    fontSize: 11,
    color: COLORS.subtext,
    textAlign: 'center',
    lineHeight: 18,
  },
  termsLink: { color: COLORS.primary, fontWeight: '600' },
  footer: {
    textAlign: 'center',
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 12,
  },
});
