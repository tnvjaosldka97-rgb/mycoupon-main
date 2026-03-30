/**
 * CouponDetailScreen — UI Polish
 * - PIN 코드 크기/대비 강조
 * - 쿠폰 상태 시각화 개선
 * - 사용하기 버튼 개선
 * API 연동 별도 브랜치
 */
import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
} from 'react-native';
import type { CouponSummary } from '../types/contracts';
import { COLORS } from '../lib/constants';

interface Props {
  coupon: CouponSummary;
  onBack: () => void;
}

function formatDiscount(c: CouponSummary): string {
  if (c.discountType === 'freebie') return '무료 증정';
  if (c.discountType === 'percentage') return `${c.discountValue}% 할인`;
  return `${c.discountValue.toLocaleString()}원 할인`;
}

function isExpired(endDate: string): boolean {
  return new Date(endDate) < new Date();
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
}

export default function CouponDetailScreen({ coupon, onBack }: Props) {
  const expired = isExpired(coupon.endDate) || coupon.remainingQuantity === 0;
  const emoji =
    coupon.discountType === 'freebie' ? '🎁' :
    coupon.discountType === 'percentage' ? '🏷️' : '💰';

  return (
    <SafeAreaView style={styles.container}>
      {/* 뒤로가기 */}
      <TouchableOpacity style={styles.backBtn} onPress={onBack}>
        <Text style={styles.backArrow}>←</Text>
        <Text style={styles.backText}>내 쿠폰</Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* 쿠폰 카드 */}
        <View style={[styles.couponCard, expired && styles.couponCardExpired]}>
          {/* 티어 장식선 */}
          <View style={[styles.topBar, expired && styles.topBarExpired]} />

          <Text style={styles.couponEmoji}>{emoji}</Text>
          <Text style={[styles.couponTitle, expired && styles.textMuted]}>
            {coupon.title}
          </Text>
          <Text style={[styles.couponDiscount, expired && styles.textMuted]}>
            {formatDiscount(coupon)}
          </Text>

          {/* 점선 구분선 */}
          <View style={styles.dottedDivider}>
            {Array.from({ length: 20 }).map((_, i) => (
              <View key={i} style={styles.dot} />
            ))}
          </View>

          {/* PIN 코드 */}
          <Text style={styles.pinLabel}>사용 PIN 코드</Text>
          <View style={styles.pinBox}>
            <Text style={[styles.pinCode, expired && styles.pinCodeExpired]}>
              {coupon.pinCode ?? '------'}
            </Text>
          </View>
          <Text style={styles.pinHint}>
            {expired ? '만료된 쿠폰입니다' : '사장님께 이 코드를 보여주세요'}
          </Text>
        </View>

        {/* 쿠폰 정보 */}
        <View style={styles.infoCard}>
          <Text style={styles.infoCardTitle}>쿠폰 정보</Text>
          <InfoRow label="할인 내용" value={formatDiscount(coupon)} />
          <InfoRow label="사용 기간" value={`${fmtDate(coupon.startDate)} ~ ${fmtDate(coupon.endDate)}`} />
          <InfoRow label="잔여 수량" value={`${coupon.remainingQuantity} / ${coupon.totalQuantity}개`} />
          <InfoRow label="승인 상태" value={coupon.approvedBy ? '✅ 승인됨' : '⏳ 승인 대기'} />
        </View>

        {/* 사용하기 버튼 */}
        <TouchableOpacity
          style={[styles.useBtn, expired && styles.useBtnDisabled]}
          disabled={expired}
          onPress={() => alert('[목업] API 연동 전 — 실제 사용 처리 미구현')}
          activeOpacity={0.85}
        >
          <Text style={styles.useBtnText}>
            {expired ? '사용 불가 (만료됨)' : '🎫 이 쿠폰 사용하기'}
          </Text>
        </TouchableOpacity>

        <View style={styles.mockNotice}>
          <Text style={styles.mockText}>⚡ 목업 모드 — 실제 사용 처리 미연동</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  backArrow: { fontSize: 18, color: COLORS.primary },
  backText: { fontSize: 14, color: COLORS.primary, fontWeight: '700' },

  content: { paddingHorizontal: 20, paddingBottom: 40, gap: 16 },

  // 쿠폰 카드
  couponCard: {
    backgroundColor: COLORS.white,
    borderRadius: 20,
    paddingHorizontal: 24,
    paddingBottom: 24,
    alignItems: 'center',
    gap: 8,
    overflow: 'hidden',
    shadowColor: COLORS.primary,
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 6,
  },
  couponCardExpired: {
    shadowColor: '#000',
    shadowOpacity: 0.05,
    opacity: 0.7,
  },
  topBar: {
    width: '150%',
    height: 6,
    backgroundColor: COLORS.primary,
    marginBottom: 16,
  },
  topBarExpired: { backgroundColor: '#D1D5DB' },
  couponEmoji: { fontSize: 52 },
  couponTitle: { fontSize: 20, fontWeight: '800', color: COLORS.text, textAlign: 'center' },
  couponDiscount: { fontSize: 16, color: COLORS.primary, fontWeight: '700' },
  dottedDivider: {
    flexDirection: 'row',
    gap: 4,
    marginVertical: 12,
  },
  dot: { width: 4, height: 2, backgroundColor: '#E5E7EB', borderRadius: 1 },
  pinLabel: { fontSize: 12, color: COLORS.subtext, fontWeight: '600', letterSpacing: 1 },
  pinBox: {
    backgroundColor: '#FFF7ED',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: COLORS.primary,
    borderStyle: 'dashed',
  },
  pinCode: {
    fontSize: 40,
    fontWeight: '800',
    letterSpacing: 10,
    color: COLORS.text,
  },
  pinCodeExpired: { color: COLORS.subtext },
  pinHint: { fontSize: 12, color: COLORS.subtext },
  textMuted: { color: COLORS.subtext },

  // 정보 카드
  infoCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 18,
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  infoCardTitle: { fontSize: 14, fontWeight: '800', color: COLORS.text, marginBottom: 4 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  infoLabel: { fontSize: 13, color: COLORS.subtext },
  infoValue: { fontSize: 13, color: COLORS.text, fontWeight: '600', flexShrink: 1, textAlign: 'right', marginLeft: 12 },

  // 사용 버튼
  useBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: COLORS.primary,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  useBtnDisabled: {
    backgroundColor: '#E5E7EB',
    shadowOpacity: 0,
    elevation: 0,
  },
  useBtnText: { fontSize: 16, fontWeight: '800', color: COLORS.white },

  // 목업 안내
  mockNotice: {
    backgroundColor: '#FFF7ED',
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
  },
  mockText: { fontSize: 11, color: '#92400E' },
});
