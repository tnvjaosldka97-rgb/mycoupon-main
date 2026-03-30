/**
 * MyCouponsScreen — UI 완성도 개선
 * - SectionTitle, LoadingState, EmptyState 적용
 * - 필터 pill 스타일 일관화
 * - CouponCard D-3 강조 개선
 */
import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScreenContainer } from '../components/ScreenContainer';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingState } from '../components/ui/LoadingState';
import { SectionTitle } from '../components/ui/SectionTitle';
import type { CouponSummary } from '../types/contracts';
import type { CouponsStackParamList } from '../navigation/types';
import { MOCK_COUPONS } from '../mock/coupons';
import { Colors, Spacing, Radius } from '../theme/tokens';

type Nav = NativeStackNavigationProp<CouponsStackParamList, 'CouponsMain'>;
type Filter = 'all' | 'active' | 'expired';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'active', label: '사용 가능' },
  { id: 'expired', label: '만료' },
];

function isExpired(d: string) { return new Date(d) < new Date(); }
function daysLeft(d: string)  { return Math.ceil((new Date(d).getTime() - Date.now()) / 864e5); }
function fmtDate(d: string)   { return new Date(d).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }); }
function fmtDiscount(c: CouponSummary) {
  if (c.discountType === 'freebie') return '무료 증정';
  if (c.discountType === 'percentage') return `${c.discountValue}% 할인`;
  return `${c.discountValue.toLocaleString()}원 할인`;
}

export default function MyCouponsScreen() {
  const navigation                    = useNavigation<Nav>();
  const [filter, setFilter]           = useState<Filter>('all');
  const [refreshing, setRefreshing]   = useState(false);
  const [isLoading]                   = useState(false);

  const filtered = MOCK_COUPONS.filter((c) => {
    const exp = isExpired(c.endDate) || c.remainingQuantity === 0;
    if (filter === 'active')  return !exp;
    if (filter === 'expired') return exp;
    return true;
  });

  const activeCount = MOCK_COUPONS.filter(c => !isExpired(c.endDate) && c.remainingQuantity > 0).length;

  const onRefresh = () => { setRefreshing(true); setTimeout(() => setRefreshing(false), 600); };

  if (isLoading) return <ScreenContainer><LoadingState message="쿠폰을 불러오는 중..." /></ScreenContainer>;

  return (
    <ScreenContainer>
      {/* 헤더 */}
      <View style={styles.header}>
        <Text style={styles.title}>내 쿠폰</Text>
        <Text style={styles.subtitle}>
          사용 가능한 쿠폰{' '}
          <Text style={styles.count}>{activeCount}개</Text>
        </Text>
      </View>

      {/* 탭 필터 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.id}
            style={[styles.chip, filter === f.id && styles.chipActive]}
            onPress={() => setFilter(f.id)}
          >
            <Text style={[styles.chipText, filter === f.id && styles.chipTextActive]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <SectionTitle title={`${filtered.length}개`} subtitle="쿠폰" />

      <FlatList
        data={filtered}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={[styles.list, !filtered.length && styles.listEmpty]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => navigation.navigate('CouponDetail', { coupon: item })} activeOpacity={0.88}>
            <CouponCard coupon={item} />
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <EmptyState
            icon={filter === 'expired' ? '🗓️' : '🎁'}
            title={filter === 'expired' ? '만료된 쿠폰이 없어요' : '사용 가능한 쿠폰이 없어요'}
            subtitle={filter === 'active' ? '근처 매장을 방문해서 쿠폰을 받아보세요' : undefined}
          />
        }
      />
    </ScreenContainer>
  );
}

function CouponCard({ coupon }: { coupon: CouponSummary }) {
  const expired = isExpired(coupon.endDate) || coupon.remainingQuantity === 0;
  const days    = daysLeft(coupon.endDate);
  const isWarn  = !expired && days <= 3 && days >= 0;
  const emoji   = coupon.discountType === 'freebie' ? '🎁' : coupon.discountType === 'percentage' ? '🏷️' : '💰';

  return (
    <View style={[styles.card, expired && styles.cardExp]}>
      <View style={[styles.disc, expired && styles.discExp]}>
        <Text style={styles.discEmoji}>{emoji}</Text>
      </View>
      <View style={styles.body}>
        <Text style={[styles.couponName, expired && styles.muted]} numberOfLines={1}>{coupon.title}</Text>
        <Text style={[styles.discount, expired && styles.muted]}>{fmtDiscount(coupon)}</Text>
        <View style={styles.metaRow}>
          {isWarn && <View style={styles.warnBadge}><Text style={styles.warnText}>⚠️ D-{days}</Text></View>}
          <Text style={[styles.meta, isWarn && styles.metaWarn]}>~{fmtDate(coupon.endDate)}</Text>
          <Text style={styles.meta}>·</Text>
          <Text style={styles.meta}>{coupon.remainingQuantity}/{coupon.totalQuantity}개</Text>
        </View>
      </View>
      <View style={styles.status}>
        {expired
          ? <View style={styles.expBadge}><Text style={styles.expText}>만료</Text></View>
          : <View style={[styles.actBadge, isWarn && styles.actBadgeWarn]}>
              <Text style={[styles.actText, isWarn && styles.actTextWarn]}>{isWarn ? '임박' : '사용가능'}</Text>
            </View>}
        <Text style={styles.chevron}>›</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header:      { paddingHorizontal: Spacing.md, paddingTop: 16, paddingBottom: 12, backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  title:       { fontSize: 24, fontWeight: '800', color: Colors.text },
  subtitle:    { fontSize: 13, color: Colors.subtext, marginTop: 2 },
  count:       { color: Colors.primary, fontWeight: '700' },
  filterRow:   { paddingHorizontal: Spacing.md, paddingVertical: 12, gap: 8, backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  chip:        { paddingHorizontal: 16, paddingVertical: 8, borderRadius: Radius.full, backgroundColor: '#F3F4F6' },
  chipActive:  { backgroundColor: Colors.primary },
  chipText:    { fontSize: 13, fontWeight: '700', color: Colors.subtext },
  chipTextActive: { color: Colors.white },
  list:        { paddingHorizontal: Spacing.md, paddingTop: 4, paddingBottom: 24, gap: 10 },
  listEmpty:   { flex: 1 },
  card:        { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  cardExp:     { opacity: 0.55 },
  disc:        { width: 48, height: 48, borderRadius: 24, backgroundColor: '#FFF7ED', alignItems: 'center', justifyContent: 'center' },
  discExp:     { backgroundColor: '#F3F4F6' },
  discEmoji:   { fontSize: 22 },
  body:        { flex: 1, gap: 3 },
  couponName:  { fontSize: 15, fontWeight: '700', color: Colors.text },
  discount:    { fontSize: 13, color: Colors.primary, fontWeight: '600' },
  metaRow:     { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  meta:        { fontSize: 11, color: Colors.subtext },
  metaWarn:    { color: Colors.red, fontWeight: '600' },
  warnBadge:   { backgroundColor: '#FEF2F2', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  warnText:    { fontSize: 10, color: Colors.red, fontWeight: '800' },
  muted:       { color: Colors.subtext },
  status:      { alignItems: 'center', gap: 4 },
  actBadge:    { backgroundColor: '#DCFCE7', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  actText:     { fontSize: 10, color: '#16A34A', fontWeight: '700' },
  actBadgeWarn: { backgroundColor: '#FEF2F2' },
  actTextWarn: { color: Colors.red },
  expBadge:    { backgroundColor: '#F3F4F6', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  expText:     { fontSize: 10, color: Colors.subtext, fontWeight: '700' },
  chevron:     { fontSize: 18, color: '#D1D5DB' },
});
