/**
 * CouponDetailScreen — UI 완성도 개선
 * - AppHeader showBack 적용
 * - CTAButton 공통 컴포넌트
 * - PIN 코드 가독성 개선
 * - 정보 섹션 카드 분리
 */
import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../components/ScreenContainer';
import { AppHeader } from '../components/AppHeader';
import { CTAButton } from '../components/ui/CTAButton';
import type { CouponsStackParamList } from '../navigation/types';
import type { CouponSummary } from '../types/contracts';
import { Colors, Spacing, Radius, Shadow } from '../theme/tokens';

type Props = NativeStackScreenProps<CouponsStackParamList, 'CouponDetail'>;

function isExpired(d: string) { return new Date(d) < new Date(); }
function fmtDate(d: string)   { return new Date(d).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' }); }
function fmtDiscount(c: CouponSummary) {
  if (c.discountType === 'freebie')    return '무료 증정';
  if (c.discountType === 'percentage') return `${c.discountValue}% 할인`;
  return `${c.discountValue.toLocaleString()}원 할인`;
}

export default function CouponDetailScreen({ route }: Props) {
  const { coupon } = route.params;
  const expired = isExpired(coupon.endDate) || coupon.remainingQuantity === 0;
  const emoji   = coupon.discountType === 'freebie' ? '🎁' : coupon.discountType === 'percentage' ? '🏷️' : '💰';

  return (
    <ScreenContainer>
      <AppHeader title="쿠폰 상세" showBack />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* 메인 쿠폰 카드 */}
        <View style={[styles.couponCard, expired && styles.couponCardExp]}>
          <View style={[styles.topBar, expired && styles.topBarExp]} />
          <Text style={styles.emoji}>{emoji}</Text>
          <Text style={[styles.title, expired && styles.muted]}>{coupon.title}</Text>
          <Text style={[styles.discount, expired && styles.muted]}>{fmtDiscount(coupon)}</Text>

          {/* 점선 */}
          <View style={styles.dashes}>
            {Array.from({ length: 16 }).map((_, i) => <View key={i} style={styles.dash} />)}
          </View>

          {/* PIN 코드 */}
          <Text style={styles.pinLabel}>사용 PIN 코드</Text>
          <View style={[styles.pinBox, expired && styles.pinBoxExp]}>
            <Text style={[styles.pinCode, expired && styles.muted]}>
              {coupon.pinCode ?? '------'}
            </Text>
          </View>
          <Text style={styles.pinHint}>{expired ? '만료된 쿠폰입니다' : '사장님께 이 코드를 보여주세요'}</Text>
        </View>

        {/* 쿠폰 정보 */}
        <View style={styles.infoCard}>
          <Text style={styles.infoCardTitle}>쿠폰 정보</Text>
          <InfoRow label="할인 내용" value={fmtDiscount(coupon)} />
          <InfoRow label="사용 기간" value={`${fmtDate(coupon.startDate)} ~ ${fmtDate(coupon.endDate)}`} />
          <InfoRow label="잔여 수량" value={`${coupon.remainingQuantity} / ${coupon.totalQuantity}개`} />
          <InfoRow label="승인 상태" value={coupon.approvedBy ? '✅ 승인됨' : '⏳ 승인 대기'} />
        </View>

        {/* 사용 CTA */}
        <CTAButton
          label={expired ? '사용 불가 (만료됨)' : '🎫 이 쿠폰 사용하기'}
          onPress={() => alert('[목업] 실제 markAsUsed API 미연동')}
          disabled={expired}
          variant={expired ? 'outline' : 'primary'}
        />

        <View style={styles.mockNote}>
          <Text style={styles.mockText}>⚡ 목업 모드 — 실제 사용 처리 미연동</Text>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content:      { paddingHorizontal: Spacing.md, paddingBottom: 40, gap: 16, paddingTop: 16 },
  couponCard:   { backgroundColor: Colors.white, borderRadius: 20, paddingHorizontal: 24, paddingBottom: 24,
    alignItems: 'center', gap: 8, overflow: 'hidden',
    ...Shadow.primary },
  couponCardExp: { ...Shadow.sm, opacity: 0.7 },
  topBar:       { width: '150%', height: 6, backgroundColor: Colors.primary, marginBottom: 16 },
  topBarExp:    { backgroundColor: '#D1D5DB' },
  emoji:        { fontSize: 52 },
  title:        { fontSize: 20, fontWeight: '800', color: Colors.text, textAlign: 'center' },
  discount:     { fontSize: 16, color: Colors.primary, fontWeight: '700' },
  dashes:       { flexDirection: 'row', gap: 4, marginVertical: 12 },
  dash:         { width: 4, height: 2, backgroundColor: '#E5E7EB', borderRadius: 1 },
  pinLabel:     { fontSize: 12, color: Colors.subtext, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase' },
  pinBox:       { backgroundColor: '#FFF7ED', paddingHorizontal: 28, paddingVertical: 16,
    borderRadius: Radius.lg, borderWidth: 2, borderColor: Colors.primary, borderStyle: 'dashed' },
  pinBoxExp:    { borderColor: '#D1D5DB', backgroundColor: '#F9FAFB' },
  pinCode:      { fontSize: 36, fontWeight: '800', letterSpacing: 10, color: Colors.text },
  pinHint:      { fontSize: 12, color: Colors.subtext },
  muted:        { color: Colors.subtext },
  infoCard:     { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: 18, gap: 12, ...Shadow.sm },
  infoCardTitle:{ fontSize: 14, fontWeight: '800', color: Colors.text, marginBottom: 4 },
  infoRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  infoLabel:    { fontSize: 13, color: Colors.subtext },
  infoValue:    { fontSize: 13, color: Colors.text, fontWeight: '600', flex: 1, textAlign: 'right', marginLeft: 12 },
  mockNote:     { backgroundColor: '#FFF7ED', borderRadius: 10, padding: 10, alignItems: 'center' },
  mockText:     { fontSize: 11, color: '#92400E' },
});
