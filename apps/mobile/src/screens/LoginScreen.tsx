/**
 * LoginScreen
 * - 1주차: mock 로그인 (실제 OAuth 미연결)
 * - 실제 구글 OAuth 연동은 2주차 이후
 */
import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { COLORS, APP_NAME } from '../lib/constants';

interface Props {
  onLogin: () => void;
}

export default function LoginScreen({ onLogin }: Props) {
  return (
    <SafeAreaView style={styles.container}>
      {/* 로고 영역 */}
      <View style={styles.logoArea}>
        <Text style={styles.logoEmoji}>🍊</Text>
        <Text style={styles.appName}>{APP_NAME}</Text>
        <Text style={styles.tagline}>내 주변 할인 쿠폰을 한 번에</Text>
      </View>

      {/* 로그인 버튼 */}
      <View style={styles.buttonArea}>
        {/* 1주차: mock 로그인 */}
        <TouchableOpacity style={styles.googleButton} onPress={onLogin}>
          <Text style={styles.googleIcon}>G</Text>
          <Text style={styles.googleButtonText}>구글로 시작하기</Text>
        </TouchableOpacity>

        <Text style={styles.notice}>
          {/* TODO: 실제 OAuth 연동 후 이 버튼은 expo-web-browser + OAuth URL로 교체 */}
          [현재 목업 모드 — 실제 로그인 아님]
        </Text>
      </View>

      {/* 약관 안내 */}
      <View style={styles.termsArea}>
        <Text style={styles.termsText}>
          로그인 시{' '}
          <Text style={styles.termsLink}>이용약관</Text> 및{' '}
          <Text style={styles.termsLink}>개인정보 처리방침</Text>에 동의합니다
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
    justifyContent: 'space-between',
    paddingVertical: 60,
    paddingHorizontal: 32,
  },
  logoArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  logoEmoji: { fontSize: 72 },
  appName: {
    fontSize: 36,
    fontWeight: '800',
    color: COLORS.primary,
  },
  tagline: {
    fontSize: 16,
    color: COLORS.subtext,
    marginTop: 4,
  },
  buttonArea: {
    gap: 16,
  },
  googleButton: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  googleIcon: {
    fontSize: 20,
    fontWeight: '700',
    color: '#4285F4',
  },
  googleButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  notice: {
    textAlign: 'center',
    fontSize: 11,
    color: COLORS.subtext,
  },
  termsArea: {
    alignItems: 'center',
  },
  termsText: {
    fontSize: 12,
    color: COLORS.subtext,
    textAlign: 'center',
    lineHeight: 20,
  },
  termsLink: {
    color: COLORS.primary,
    textDecorationLine: 'underline',
  },
});
