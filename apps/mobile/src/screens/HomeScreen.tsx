/**
 * HomeScreen — UI Polish
 * - 카테고리 필터 가로 스크롤 바
 * - StoreCard 거리/뱃지 개선
 * - 빈 상태 EmptyState 컴포넌트
 * - 검색바 개선
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
  TextInput,
  ScrollView,
  RefreshControl,
} from 'react-native';
import type { StoreSummary, StoreCategory } from '../types/contracts';
import { MOCK_STORES } from '../mock/stores';
import { COLORS, CATEGORY_LABEL } from '../lib/constants';
import { EmptyState } from '../components/ui/EmptyState';

type CategoryFilter = StoreCategory | 'all';

const CATEGORY_FILTERS: { id: CategoryFilter; label: string }[] = [
  { id: 'all',        label: '전체' },
  { id: 'cafe',       label: '☕ 카페' },
  { id: 'restaurant', label: '🍽️ 음식점' },
  { id: 'beauty',     label: '💅 뷰티' },
  { id: 'fitness',    label: '💪 헬스장' },
  { id: 'hospital',   label: '🏥 병원' },
  { id: 'other',      label: '🎁 기타' },
];

export default function HomeScreen() {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>('all');
  const [refreshing, setRefreshing] = useState(false);

  const filtered = MOCK_STORES.filter((s) => {
    const matchSearch =
      !search ||
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.address.toLowerCase().includes(search.toLowerCase());
    const matchCategory = activeCategory === 'all' || s.category === activeCategory;
    return matchSearch && matchCategory;
  });

  const onRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 800);
    // TODO: 실제 API 호출로 교체
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* 헤더 */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>🍊 마이쿠폰</Text>
          <Text style={styles.headerSub}>내 주변 쿠폰을 찾아보세요</Text>
        </View>
        <View style={styles.locationBadge}>
          <Text style={styles.locationText}>📍 위치 설정 중</Text>
        </View>
      </View>

      {/* 검색바 */}
      <View style={styles.searchRow}>
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="가게 이름, 주소 검색"
            placeholderTextColor={COLORS.subtext}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Text style={styles.clearBtn}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* 카테고리 필터 */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        {CATEGORY_FILTERS.map((f) => (
          <TouchableOpacity
            key={f.id}
            style={[styles.filterChip, activeCategory === f.id && styles.filterChipActive]}
            onPress={() => setActiveCategory(f.id)}
            activeOpacity={0.75}
          >
            <Text style={[styles.filterText, activeCategory === f.id && styles.filterTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* 결과 수 */}
      <Text style={styles.resultCount}>
        {search || activeCategory !== 'all'
          ? `검색 결과 ${filtered.length}개`
          : `전체 ${filtered.length}개 매장`}
      </Text>

      {/* 가게 목록 */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={[styles.list, filtered.length === 0 && styles.listEmpty]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        renderItem={({ item }) => <StoreCard store={item} />}
        ListEmptyComponent={
          <EmptyState
            icon="🏙️"
            title="주변에 쿠폰이 없어요"
            subtitle="다른 카테고리나 검색어로 찾아보세요"
          />
        }
      />
    </SafeAreaView>
  );
}

function StoreCard({ store }: { store: StoreSummary }) {
  const distanceText = store.distance
    ? store.distance < 1000
      ? `${store.distance}m`
      : `${(store.distance / 1000).toFixed(1)}km`
    : null;

  const hasCoupon = (store.couponCount ?? 0) > 0;
  const isDormant = store.ownerIsDormant;

  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.9}>
      {/* 카테고리 아이콘 */}
      <View style={[styles.categoryIcon, isDormant && styles.categoryIconDormant]}>
        <Text style={styles.categoryEmoji}>
          {CATEGORY_LABEL[store.category]?.split(' ')[0] ?? '🎁'}
        </Text>
      </View>

      {/* 정보 */}
      <View style={styles.cardInfo}>
        <View style={styles.cardTitleRow}>
          <Text style={styles.storeName} numberOfLines={1}>{store.name}</Text>
          {distanceText && <Text style={styles.distance}>{distanceText}</Text>}
        </View>
        <Text style={styles.storeAddress} numberOfLines={1}>{store.address}</Text>

        <View style={styles.badgeRow}>
          {isDormant ? (
            <View style={[styles.badge, styles.badgeDormant]}>
              <Text style={styles.badgeDormantText}>쿠폰 없음</Text>
            </View>
          ) : hasCoupon ? (
            <View style={[styles.badge, styles.badgeCoupon]}>
              <Text style={styles.badgeCouponText}>🎁 쿠폰 {store.couponCount}개</Text>
            </View>
          ) : null}
          <View style={styles.categoryPill}>
            <Text style={styles.categoryPillText}>{CATEGORY_LABEL[store.category] ?? store.category}</Text>
          </View>
        </View>
      </View>

      <Text style={styles.arrow}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },

  // 헤더
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: COLORS.white,
  },
  headerTitle: { fontSize: 20, fontWeight: '800', color: COLORS.primary },
  headerSub: { fontSize: 12, color: COLORS.subtext, marginTop: 1 },
  locationBadge: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  locationText: { fontSize: 11, color: '#3B82F6', fontWeight: '600' },

  // 검색
  searchRow: { paddingHorizontal: 16, paddingVertical: 10, backgroundColor: COLORS.white },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  searchIcon: { fontSize: 15 },
  searchInput: { flex: 1, fontSize: 14, color: COLORS.text, padding: 0 },
  clearBtn: { fontSize: 14, color: COLORS.subtext, paddingHorizontal: 4 },

  // 카테고리 필터
  filterRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  filterChipActive: {
    backgroundColor: '#FFF7ED',
    borderColor: COLORS.primary,
  },
  filterText: { fontSize: 13, color: COLORS.subtext, fontWeight: '600' },
  filterTextActive: { color: COLORS.primary },

  // 결과 수
  resultCount: {
    fontSize: 12,
    color: COLORS.subtext,
    paddingHorizontal: 20,
    paddingVertical: 8,
    fontWeight: '500',
  },

  // 리스트
  list: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
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
  categoryIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#FFF7ED',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  categoryIconDormant: { backgroundColor: '#F3F4F6' },
  categoryEmoji: { fontSize: 24 },
  cardInfo: { flex: 1, gap: 3 },
  cardTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  storeName: { fontSize: 15, fontWeight: '700', color: COLORS.text, flex: 1 },
  distance: { fontSize: 12, color: COLORS.subtext, marginLeft: 8, flexShrink: 0 },
  storeAddress: { fontSize: 12, color: COLORS.subtext },
  badgeRow: { flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeCoupon: { backgroundColor: '#FFF7ED' },
  badgeCouponText: { fontSize: 11, color: COLORS.primary, fontWeight: '700' },
  badgeDormant: { backgroundColor: '#F3F4F6' },
  badgeDormantText: { fontSize: 11, color: COLORS.subtext, fontWeight: '600' },
  categoryPill: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  categoryPillText: { fontSize: 11, color: '#3B82F6', fontWeight: '600' },
  arrow: { fontSize: 20, color: '#D1D5DB' },
});
