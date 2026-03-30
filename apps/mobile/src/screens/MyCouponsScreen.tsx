/**
 * MyCouponsScreen — UI Polish
 * - 탭 필터 pill 스타일
 * - D-3 만료 임박 강조 (붉은 표시)
 * - 빈 상태 EmptyState
 * - CouponCard 레이아웃 개선
 * API 연동 별도 브랜치
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  RefreshControl,
} from 'react-native';
import type { CouponSummary } from '../types/contracts';
import { MOCK_COUPONS } from '../mock/coupons';
import { COLORS } from '../lib/constants';
import { EmptyState } from '../components/ui/EmptyState';
import CouponDetailScreen from './CouponDetailScreen';

type Filter = 'all' | 'active' | 'expired';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all',     label: '전체' },
  { id: 'active',  label: '사용 가능' },
  { id: 'expired', label: '만료' },
];

function isExpired(endDate: string): boolean {
  return new Date(endDate) < new Date();
}

function daysLeft(endDate: string): number {
  return Math.ceil((new Date(endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

function formatDiscount(c: CouponSummary): string {
  if (c.discountType === 'freebie') return '무료 증정';
  if (c.discountType === 'percentage') return `${c.discountValue}% 할인`;
  return `${c.discountValue.toLocaleString()}원 할인`;
}

export default function MyCouponsScreen() {
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<CouponSummary | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const filtered = MOCK_COUPONS.filter((c) => {
    const expired = isExpired(c.endDate) || c.remainingQuantity === 0;
    if (filter === 'active') return !expired;
    if (filter === 'expired') return expired;
    return true;
  });

  const activeCount = MOCK_COUPONS.filter(
    (c) => !isExpired(c.endDate) && c.remainingQuantity > 0
  ).length;

  if (selected) {
    return <CouponDetailScreen coupon={selected} onBack={() => setSelected(null)} />;
  }

  const onRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 600);
    // TODO: 실제 API 호출
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* 헤더 */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>내 쿠폰</Text>
          <Text style={styles.subtitle}>
            사용 가능한 쿠폰{' '}
            <Text style={styles.activeCount}>{activeCount}개</Text>
          </Text>
        </View>
      </View>

      {/* 탭 필터 pill */}
      <View style={styles.filterBar}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.id}
            style={[styles.filterBtn, filter === f.id && styles.filterBtnActive]}
            onPress={() => setFilter(f.id)}
            activeOpacity={0.8}
          >
            <Text style={[styles.filterText, filter === f.id && styles.filterTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 쿠폰 목록 */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={[styles.list, filtered.length === 0 && styles.listEmpty]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => setSelected(item)} activeOpacity={0.88}>
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
    </SafeAreaView>
  );
}

function CouponCard({ coupon }: { coupon: CouponSummary }) {
  const expired = isExpired(coupon.endDate) || coupon.remainingQuantity === 0;
  const days = daysLeft(coupon.endDate);
  const isWarning = !expired && days <= 3 && days >= 0;

  return (
    <View style={[styles.card, expired && styles.cardExpired]}>
      {/* 왼쪽: 할인 유형 원형 배지 */}
      <View style={[styles.discountCircle, expired && styles.discountCircleExpired]}>
        <Text style={styles.discountEmoji}>
          {coupon.discountType === 'freebie' ? '🎁' :
           coupon.discountType === 'percentage' ? '%' : '₩'}
        </Text>
      </View>

      {/* 가운데: 쿠폰 정보 */}
      <View style={styles.cardBody}>
        <Text style={[styles.couponTitle, expired && styles.textMuted]} numberOfLines={1}>
          {coupon.title}
        </Text>
        <Text style={[styles.couponDiscount, expired && styles.textMuted]}>
          {formatDiscount(coupon)}
        </Text>

        <View style={styles.metaRow}>
          {/* 만료 임박 경고 */}
          {isWarning && (
            <View style={styles.warningBadge}>
              <Text style={styles.warningText}>⚠️ D-{days}</Text>
            </View>
          )}
          <Text style={[styles.metaText, isWarning && styles.metaTextWarning]}>
            ~{formatDate(coupon.endDate)}
          </Text>
          <Text style={styles.metaDot}>·</Text>
          <Text style={styles.metaText}>
            {coupon.remainingQuantity}/{coupon.totalQuantity}개
          </Text>
        </View>
      </View>

      {/* 오른쪽: 상태 뱃지 */}
      <View style={styles.statusCol}>
        {expired ? (
          <View style={styles.expiredBadge}>
            <Text style={styles.expiredText}>만료</Text>
          </View>
        ) : (
          <View style={[styles.activeBadge, isWarning && styles.warningActiveBadge]}>
            <Text style={[styles.activeText, isWarning && styles.warningActiveText]}>
              {isWarning ? '임박' : '사용 가능'}
            </Text>
          </View>
        )}
        <Text style={styles.chevron}>›</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },

  // 헤더
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  title: { fontSize: 24, fontWeight: '800', color: COLORS.text },
  subtitle: { fontSize: 13, color: COLORS.subtext, marginTop: 2 },
  activeCount: { color: COLORS.primary, fontWeight: '700' },

  // 필터
  filterBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  filterBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
  },
  filterBtnActive: { backgroundColor: COLORS.primary },
  filterText: { fontSize: 13, fontWeight: '700', color: COLORS.subtext },
  filterTextActive: { color: COLORS.white },

  // 리스트
  list: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24, gap: 10 },
  listEmpty: { flex: 1 },

  // 카드
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  cardExpired: { opacity: 0.55 },
  discountCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFF7ED',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  discountCircleExpired: { backgroundColor: '#F3F4F6' },
  discountEmoji: { fontSize: 22 },
  cardBody: { flex: 1, gap: 3 },
  couponTitle: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  couponDiscount: { fontSize: 13, color: COLORS.primary, fontWeight: '600' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  metaText: { fontSize: 11, color: COLORS.subtext },
  metaTextWarning: { color: '#EF4444', fontWeight: '600' },
  metaDot: { fontSize: 11, color: COLORS.subtext },
  warningBadge: {
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  warningText: { fontSize: 10, color: '#EF4444', fontWeight: '800' },
  textMuted: { color: COLORS.subtext },
  statusCol: { alignItems: 'center', gap: 4 },
  activeBadge: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  activeText: { fontSize: 11, color: '#16A34A', fontWeight: '700' },
  warningActiveBadge: { backgroundColor: '#FEF2F2' },
  warningActiveText: { color: '#EF4444' },
  expiredBadge: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  expiredText: { fontSize: 11, color: COLORS.subtext, fontWeight: '700' },
  chevron: { fontSize: 18, color: '#D1D5DB' },
});
