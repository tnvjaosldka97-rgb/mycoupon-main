/**
 * CouponDetailScreen — react-navigation 연결
 * route.params.coupon 으로 데이터 수신
 * navigation.goBack() 뒤로가기
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../components/ScreenContainer';
import { AppHeader } from '../components/AppHeader';
import type { CouponsStackParamList } from '../navigation/types';
import type { CouponSummary } from '../types/contracts';
import { Colors } from '../theme/tokens';

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
        {/* 쿠폰 카드 */}
        <View style={[styles.couponCard, expired && styles.couponCardExp]}>
          <View style={[styles.topBar, expired && styles.topBarExp]} />
          <Text style={styles.emoji}>{emoji}</Text>
          <Text style={[styles.title, expired && styles.muted]}>{coupon.title}</Text>
          <Text style={[styles.discount, expired && styles.muted]}>{fmtDiscount(coupon)}</Text>
          <View style={styles.dotRow}>
            {Array.from({ length: 18 }).map((_, i) => (
              <View key={i} style={styles.dot} />
            ))}
          </View>
          <Text style={styles.pinLabel}>사용 PIN 코드</Text>
          <View style={[styles.pinBox, expired && styles.pinBoxExp]}>
            <Text style={[styles.pinCode, expired && styles.muted]}>
              {coupon.pinCode ?? '------'}
            </Text>
          </View>
          <Text style={styles.pinHint}>
            {expired ? '만료된 쿠폰입니다' : '사장님께 이 코드를 보여주세요'}
          </Text>
        </View>

        {/* 정보 카드 */}
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>쿠폰 정보</Text>
          <InfoRow label="할인 내용"   value={fmtDiscount(coupon)} />
          <InfoRow label="사용 기간"   value={`${fmtDate(coupon.startDate)} ~ ${fmtDate(coupon.endDate)}`} />
          <InfoRow label="잔여 수량"   value={`${coupon.remainingQuantity} / ${coupon.totalQuantity}개`} />
          <InfoRow label="승인 상태"   value={coupon.approvedBy ? '✅ 승인됨' : '⏳ 승인 대기'} />
        </View>

        {/* 사용 버튼 */}
        <TouchableOpacity
          style={[styles.useBtn, expired && styles.useBtnDis]}
          disabled={expired}
          onPress={() => alert('[목업] 실제 markAsUsed API 미연동')}
          activeOpacity={0.85}
        >
          <Text style={styles.useBtnText}>
            {expired ? '사용 불가 (만료)' : '🎫 이 쿠폰 사용하기'}
          </Text>
        </TouchableOpacity>

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
  content:      { paddingHorizontal: 20, paddingBottom: 40, gap: 16, paddingTop: 16 },
  couponCard:   { backgroundColor: Colors.white, borderRadius: 20, paddingHorizontal: 24, paddingBottom: 24,
    alignItems: 'center', gap: 8, overflow: 'hidden',
    shadowColor: Colors.primary, shadowOpacity: 0.12, shadowRadius: 16, elevation: 6 },
  couponCardExp:{ shadowColor: '#000', shadowOpacity: 0.05, opacity: 0.7 },
  topBar:       { width: '150%', height: 6, backgroundColor: Colors.primary, marginBottom: 16 },
  topBarExp:    { backgroundColor: '#D1D5DB' },
  emoji:        { fontSize: 52 },
  title:        { fontSize: 20, fontWeight: '800', color: Colors.text, textAlign: 'center' },
  discount:     { fontSize: 16, color: Colors.primary, fontWeight: '700' },
  dotRow:       { flexDirection: 'row', gap: 4, marginVertical: 12 },
  dot:          { width: 4, height: 2, backgroundColor: '#E5E7EB', borderRadius: 1 },
  pinLabel:     { fontSize: 12, color: Colors.subtext, fontWeight: '600', letterSpacing: 1 },
  pinBox:       { backgroundColor: '#FFF7ED', paddingHorizontal: 24, paddingVertical: 14,
    borderRadius: 14, borderWidth: 2, borderColor: Colors.primary, borderStyle: 'dashed' },
  pinBoxExp:    { borderColor: '#D1D5DB', backgroundColor: '#F9FAFB' },
  pinCode:      { fontSize: 36, fontWeight: '800', letterSpacing: 8, color: Colors.text },
  pinHint:      { fontSize: 12, color: Colors.subtext },
  muted:        { color: Colors.subtext },
  infoCard:     { backgroundColor: Colors.white, borderRadius: 16, padding: 18, gap: 12,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  infoTitle:    { fontSize: 14, fontWeight: '800', color: Colors.text, marginBottom: 4 },
  infoRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  infoLabel:    { fontSize: 13, color: Colors.subtext },
  infoValue:    { fontSize: 13, color: Colors.text, fontWeight: '600', flex: 1, textAlign: 'right', marginLeft: 12 },
  useBtn:       { backgroundColor: Colors.primary, borderRadius: 16, paddingVertical: 16, alignItems: 'center',
    shadowColor: Colors.primary, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
  useBtnDis:    { backgroundColor: '#E5E7EB', shadowOpacity: 0, elevation: 0 },
  useBtnText:   { fontSize: 16, fontWeight: '800', color: Colors.white },
  mockNote:     { backgroundColor: '#FFF7ED', borderRadius: 10, padding: 10, alignItems: 'center' },
  mockText:     { fontSize: 11, color: '#92400E' },
});
