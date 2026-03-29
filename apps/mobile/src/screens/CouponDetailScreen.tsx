/**
 * CouponDetailScreen
 * - 1주차: mock 쿠폰 상세 + PIN 코드 표시
 * - 실제 사용 처리(markAsUsed) 연동은 2주차 이후
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

function formatDiscount(coupon: CouponSummary): string {
  if (coupon.discountType === 'freebie') return '무료 증정';
  if (coupon.discountType === 'percentage') return `${coupon.discountValue}% 할인`;
  return `${coupon.discountValue.toLocaleString()}원 할인`;
}

function isExpired(endDate: string): boolean {
  return new Date(endDate) < new Date();
}

export default function CouponDetailScreen({ coupon, onBack }: Props) {
  const expired = isExpired(coupon.endDate) || coupon.remainingQuantity === 0;

  return (
    <SafeAreaView style={styles.container}>
      {/* 뒤로가기 */}
      <TouchableOpacity style={styles.backBtn} onPress={onBack}>
        <Text style={styles.backText}>← 내 쿠폰으로</Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.content}>
        {/* 쿠폰 카드 */}
        <View style={[styles.couponCard, expired && styles.couponCardExpired]}>
          <Text style={styles.couponEmoji}>🎁</Text>
          <Text style={styles.couponTitle}>{coupon.title}</Text>
          <Text style={styles.couponDiscount}>{formatDiscount(coupon)}</Text>
          <View style={styles.divider} />

          {/* PIN 코드 */}
          <Text style={styles.pinLabel}>PIN 코드 (오프라인 사용)</Text>
          <Text style={styles.pinCode}>
            {coupon.pinCode ?? '---'}
          </Text>
          <Text style={styles.pinNote}>
            사장님께 이 코드를 보여주세요
          </Text>
        </View>

        {/* 쿠폰 정보 */}
        <View style={styles.infoBox}>
          <InfoRow label="잔여 수량" value={`${coupon.remainingQuantity} / ${coupon.totalQuantity}개`} />
          <InfoRow
            label="유효 기간"
            value={`${fmtDate(coupon.startDate)} ~ ${fmtDate(coupon.endDate)}`}
          />
          <InfoRow label="할인 유형" value={formatDiscount(coupon)} />
          <InfoRow label="승인 상태" value={coupon.approvedBy ? '승인됨' : '승인 대기'} />
        </View>

        {/* 사용하기 버튼 */}
        <TouchableOpacity
          style={[styles.useBtn, expired && styles.useBtnDisabled]}
          disabled={expired}
          onPress={() => {
            // TODO: trpc.coupons.markAsUsed.mutate() 연동 (2주차 이후)
            alert('[목업] 실제 사용 처리는 2주차 이후 연동됩니다.');
          }}
        >
          <Text style={styles.useBtnText}>
            {expired ? '사용 불가 (만료)' : '🎫 사용하기'}
          </Text>
        </TouchableOpacity>

        <Text style={styles.notice}>
          {/* TODO: 실제 서버 연동 후 제거 */}
          [현재 목업 모드 — 실제 사용 처리 미연동]
        </Text>
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

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  backBtn: { paddingHorizontal: 20, paddingVertical: 14 },
  backText: { fontSize: 14, color: COLORS.primary, fontWeight: '600' },
  content: { paddingHorizontal: 20, paddingBottom: 40, gap: 20 },
  couponCard: {
    backgroundColor: COLORS.white,
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    gap: 8,
    borderWidth: 2,
    borderColor: COLORS.primary,
    shadowColor: COLORS.primary,
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },
  couponCardExpired: {
    borderColor: COLORS.border,
    opacity: 0.6,
  },
  couponEmoji: { fontSize: 48 },
  couponTitle: { fontSize: 20, fontWeight: '800', color: COLORS.text, textAlign: 'center' },
  couponDiscount: { fontSize: 16, color: COLORS.primary, fontWeight: '700' },
  divider: {
    width: '100%',
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: 8,
    borderStyle: 'dashed',
  },
  pinLabel: { fontSize: 12, color: COLORS.subtext },
  pinCode: {
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: 8,
    color: COLORS.text,
    fontFamily: 'monospace',
  },
  pinNote: { fontSize: 12, color: COLORS.subtext },
  infoBox: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  infoLabel: { fontSize: 13, color: COLORS.subtext },
  infoValue: { fontSize: 13, color: COLORS.text, fontWeight: '600' },
  useBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  useBtnDisabled: { backgroundColor: COLORS.border },
  useBtnText: { fontSize: 16, fontWeight: '800', color: COLORS.white },
  notice: { textAlign: 'center', fontSize: 11, color: COLORS.subtext },
});
