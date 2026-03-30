/**
 * MyCouponsScreen — react-navigation 연결
 * CouponDetail 이동: navigation.navigate('CouponDetail', { coupon })
 */
import React, { useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScreenContainer } from '../components/ScreenContainer';
import { EmptyState } from './../../src/components/ui/EmptyState';
import type { CouponSummary } from '../types/contracts';
import type { CouponsStackParamList } from '../navigation/types';
import { MOCK_COUPONS } from '../mock/coupons';
import { Colors } from '../theme/tokens';

type Nav = NativeStackNavigationProp<CouponsStackParamList, 'CouponsMain'>;

type Filter = 'all' | 'active' | 'expired';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'active', label: '사용 가능' },
  { id: 'expired', label: '만료' },
];

function isExpired(d: string)  { return new Date(d) < new Date(); }
function daysLeft(d: string)   { return Math.ceil((new Date(d).getTime() - Date.now()) / 864e5); }
function fmtDate(d: string)    { return new Date(d).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }); }
function fmtDiscount(c: CouponSummary) {
  if (c.discountType === 'freebie') return '무료 증정';
  if (c.discountType === 'percentage') return `${c.discountValue}% 할인`;
  return `${c.discountValue.toLocaleString()}원 할인`;
}

export default function MyCouponsScreen() {
  const navigation = useNavigation<Nav>();
  const [filter, setFilter]     = useState<Filter>('all');
  const [refreshing, setRefreshing] = useState(false);

  const filtered = MOCK_COUPONS.filter((c) => {
    const exp = isExpired(c.endDate) || c.remainingQuantity === 0;
    if (filter === 'active')  return !exp;
    if (filter === 'expired') return exp;
    return true;
  });

  const activeCount = MOCK_COUPONS.filter(c => !isExpired(c.endDate) && c.remainingQuantity > 0).length;

  const onRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 600);
  };

  const goDetail = (coupon: CouponSummary) =>
    navigation.navigate('CouponDetail', { coupon });

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Text style={styles.title}>내 쿠폰</Text>
        <Text style={styles.subtitle}>
          사용 가능한 쿠폰{' '}
          <Text style={styles.activeCount}>{activeCount}개</Text>
        </Text>
      </View>

      {/* 탭 필터 */}
      <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterBar}
      >
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.id}
            style={[styles.filterBtn, filter === f.id && styles.filterBtnActive]}
            onPress={() => setFilter(f.id)}
          >
            <Text style={[styles.filterText, filter === f.id && styles.filterTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <FlatList
        data={filtered}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={[styles.list, !filtered.length && styles.listEmpty]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => goDetail(item)} activeOpacity={0.88}>
            <CouponCard coupon={item} />
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <EmptyState
            icon={filter === 'expired' ? '🗓️' : '🎁'}
            title={filter === 'expired' ? '만료된 쿠폰이 없어요' : '사용 가능한 쿠폰이 없어요'}
            subtitle={filter === 'active' ? '근처 가게를 방문해서 쿠폰을 받아보세요' : undefined}
          />
        }
      />
    </ScreenContainer>
  );
}

function CouponCard({ coupon }: { coupon: CouponSummary }) {
  const expired  = isExpired(coupon.endDate) || coupon.remainingQuantity === 0;
  const days     = daysLeft(coupon.endDate);
  const isWarn   = !expired && days <= 3 && days >= 0;
  const emoji    = coupon.discountType === 'freebie' ? '🎁' : coupon.discountType === 'percentage' ? '🏷️' : '💰';

  return (
    <View style={[styles.card, expired && styles.cardExpired]}>
      <View style={[styles.discCircle, expired && styles.discCircleExp]}>
        <Text style={styles.discEmoji}>{emoji}</Text>
      </View>
      <View style={styles.cardBody}>
        <Text style={[styles.couponTitle, expired && styles.muted]} numberOfLines={1}>
          {coupon.title}
        </Text>
        <Text style={[styles.couponDiscount, expired && styles.muted]}>{fmtDiscount(coupon)}</Text>
        <View style={styles.metaRow}>
          {isWarn && (
            <View style={styles.warnBadge}><Text style={styles.warnText}>⚠️ D-{days}</Text></View>
          )}
          <Text style={[styles.meta, isWarn && styles.metaWarn]}>~{fmtDate(coupon.endDate)}</Text>
          <Text style={styles.meta}>·</Text>
          <Text style={styles.meta}>{coupon.remainingQuantity}/{coupon.totalQuantity}개</Text>
        </View>
      </View>
      <View style={styles.statusCol}>
        {expired
          ? <View style={styles.expBadge}><Text style={styles.expText}>만료</Text></View>
          : <View style={[styles.actBadge, isWarn && styles.actBadgeWarn]}>
              <Text style={[styles.actText, isWarn && styles.actTextWarn]}>{isWarn ? '임박' : '사용가능'}</Text>
            </View>
        }
        <Text style={styles.chevron}>›</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
    backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
  },
  title:        { fontSize: 24, fontWeight: '800', color: Colors.text },
  subtitle:     { fontSize: 13, color: Colors.subtext, marginTop: 2 },
  activeCount:  { color: Colors.primary, fontWeight: '700' },
  filterBar:    { paddingHorizontal: 16, paddingVertical: 12, gap: 8,
    backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  filterBtn:    { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F3F4F6' },
  filterBtnActive: { backgroundColor: Colors.primary },
  filterText:   { fontSize: 13, fontWeight: '700', color: Colors.subtext },
  filterTextActive: { color: Colors.white },
  list:         { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24, gap: 10 },
  listEmpty:    { flex: 1 },
  card:         { backgroundColor: Colors.white, borderRadius: 16, padding: 14,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  cardExpired:  { opacity: 0.55 },
  discCircle:   { width: 48, height: 48, borderRadius: 24, backgroundColor: '#FFF7ED', alignItems: 'center', justifyContent: 'center' },
  discCircleExp:{ backgroundColor: '#F3F4F6' },
  discEmoji:    { fontSize: 22 },
  cardBody:     { flex: 1, gap: 3 },
  couponTitle:  { fontSize: 15, fontWeight: '700', color: Colors.text },
  couponDiscount: { fontSize: 13, color: Colors.primary, fontWeight: '600' },
  metaRow:      { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  meta:         { fontSize: 11, color: Colors.subtext },
  metaWarn:     { color: Colors.red, fontWeight: '600' },
  warnBadge:    { backgroundColor: '#FEF2F2', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  warnText:     { fontSize: 10, color: Colors.red, fontWeight: '800' },
  muted:        { color: Colors.subtext },
  statusCol:    { alignItems: 'center', gap: 4 },
  actBadge:     { backgroundColor: '#DCFCE7', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  actText:      { fontSize: 10, color: '#16A34A', fontWeight: '700' },
  actBadgeWarn: { backgroundColor: '#FEF2F2' },
  actTextWarn:  { color: Colors.red },
  expBadge:     { backgroundColor: '#F3F4F6', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  expText:      { fontSize: 10, color: Colors.subtext, fontWeight: '700' },
  chevron:      { fontSize: 18, color: '#D1D5DB' },
});
