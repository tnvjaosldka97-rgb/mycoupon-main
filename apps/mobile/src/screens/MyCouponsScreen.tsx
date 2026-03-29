/**
 * MyCouponsScreen
 * - 1주차: mock 쿠폰 목록 (실제 API 미연결)
 * - 탭 필터: 전체 / 사용 가능 / 만료
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import type { CouponSummary } from '../types/contracts';
import { MOCK_COUPONS } from '../mock/coupons';
import { COLORS } from '../lib/constants';
import CouponDetailScreen from './CouponDetailScreen';

type Filter = 'all' | 'active' | 'expired';

function isExpired(endDate: string): boolean {
  return new Date(endDate) < new Date();
}

function formatDiscount(coupon: CouponSummary): string {
  if (coupon.discountType === 'freebie') return '무료 증정';
  if (coupon.discountType === 'percentage') return `${coupon.discountValue}% 할인`;
  return `${coupon.discountValue.toLocaleString()}원 할인`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ko-KR', {
    month: 'short',
    day: 'numeric',
  });
}

export default function MyCouponsScreen() {
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<CouponSummary | null>(null);

  const filtered = MOCK_COUPONS.filter((c) => {
    if (filter === 'active') return !isExpired(c.endDate) && c.remainingQuantity > 0;
    if (filter === 'expired') return isExpired(c.endDate) || c.remainingQuantity === 0;
    return true;
  });

  if (selected) {
    return (
      <CouponDetailScreen
        coupon={selected}
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>🎁 내 쿠폰</Text>

      {/* 필터 탭 */}
      <View style={styles.filterRow}>
        {(['all', 'active', 'expired'] as Filter[]).map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterBtn, filter === f && styles.filterBtnActive]}
            onPress={() => setFilter(f)}
          >
            <Text
              style={[styles.filterText, filter === f && styles.filterTextActive]}
            >
              {f === 'all' ? '전체' : f === 'active' ? '사용 가능' : '만료'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 쿠폰 목록 */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => setSelected(item)}>
            <CouponCard coupon={item} />
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>쿠폰이 없습니다.</Text>
        }
      />
    </SafeAreaView>
  );
}

function CouponCard({ coupon }: { coupon: CouponSummary }) {
  const expired = isExpired(coupon.endDate) || coupon.remainingQuantity === 0;
  const expiresText = `~${formatDate(coupon.endDate)} 까지`;

  return (
    <View style={[styles.card, expired && styles.cardExpired]}>
      <View style={styles.cardLeft}>
        <Text style={[styles.couponTitle, expired && styles.textMuted]}>
          {coupon.title}
        </Text>
        <Text style={[styles.couponDiscount, expired && styles.textMuted]}>
          {formatDiscount(coupon)}
        </Text>
        <Text style={styles.couponMeta}>
          {expiresText} · 남은 수량 {coupon.remainingQuantity}개
        </Text>
      </View>
      <View style={styles.cardRight}>
        {expired ? (
          <View style={styles.expiredBadge}>
            <Text style={styles.expiredBadgeText}>만료</Text>
          </View>
        ) : (
          <View style={styles.activeBadge}>
            <Text style={styles.activeBadgeText}>사용 가능</Text>
          </View>
        )}
        <Text style={styles.arrow}>›</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.text,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 12,
  },
  filterBtn: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  filterBtnActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  filterText: { fontSize: 13, color: COLORS.subtext },
  filterTextActive: { color: COLORS.white, fontWeight: '700' },
  list: { paddingHorizontal: 16, paddingBottom: 20, gap: 12 },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardExpired: { opacity: 0.5 },
  cardLeft: { flex: 1, gap: 4 },
  cardRight: { alignItems: 'center', gap: 6 },
  couponTitle: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  couponDiscount: { fontSize: 14, color: COLORS.primary, fontWeight: '600' },
  couponMeta: { fontSize: 11, color: COLORS.subtext },
  textMuted: { color: COLORS.subtext },
  activeBadge: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  activeBadgeText: { fontSize: 10, color: '#16A34A', fontWeight: '700' },
  expiredBadge: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  expiredBadgeText: { fontSize: 10, color: COLORS.subtext, fontWeight: '700' },
  arrow: { fontSize: 18, color: COLORS.subtext },
  empty: { textAlign: 'center', color: COLORS.subtext, marginTop: 40 },
});
