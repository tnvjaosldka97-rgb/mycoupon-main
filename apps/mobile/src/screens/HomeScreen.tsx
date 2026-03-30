/**
 * HomeScreen — UI 완성도 개선
 * - SectionTitle, LoadingState, EmptyState, ErrorState 적용
 * - 검색/필터 UX 정리
 * - StoreCard 레이아웃 개선
 */
import React, { useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  TextInput, ScrollView, RefreshControl,
} from 'react-native';
import { ScreenContainer } from '../components/ScreenContainer';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingState } from '../components/ui/LoadingState';
import { SectionTitle } from '../components/ui/SectionTitle';
import type { StoreSummary, StoreCategory } from '../types/contracts';
import { MOCK_STORES } from '../mock/stores';
import { Colors, Spacing, Radius } from '../theme/tokens';

const CATEGORY_LABEL: Record<string, string> = {
  cafe: '☕ 카페', restaurant: '🍽️ 음식점', beauty: '💅 뷰티',
  hospital: '🏥 병원', fitness: '💪 헬스장', other: '🎁 기타',
};

type CategoryFilter = StoreCategory | 'all';
const FILTERS: { id: CategoryFilter; label: string }[] = [
  { id: 'all', label: '전체' }, { id: 'cafe', label: '☕' },
  { id: 'restaurant', label: '🍽️' }, { id: 'beauty', label: '💅' },
  { id: 'fitness', label: '💪' }, { id: 'hospital', label: '🏥' },
  { id: 'other', label: '🎁' },
];

export default function HomeScreen() {
  const [search, setSearch]           = useState('');
  const [category, setCategory]       = useState<CategoryFilter>('all');
  const [refreshing, setRefreshing]   = useState(false);
  const [isLoading]                   = useState(false); // mock: 항상 false

  const filtered = MOCK_STORES.filter((s) => {
    const q = search.toLowerCase();
    return (
      (!search || s.name.toLowerCase().includes(q) || s.address.toLowerCase().includes(q)) &&
      (category === 'all' || s.category === category)
    );
  });

  const onRefresh = () => { setRefreshing(true); setTimeout(() => setRefreshing(false), 700); };

  if (isLoading) return <ScreenContainer><LoadingState message="가게 정보를 불러오는 중..." /></ScreenContainer>;

  return (
    <ScreenContainer>
      {/* 헤더 */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>🍊 마이쿠폰</Text>
          <Text style={styles.headerSub}>내 주변 쿠폰</Text>
        </View>
        <View style={styles.locBadge}>
          <Text style={styles.locText}>📍 위치 사용 중</Text>
        </View>
      </View>

      {/* 검색바 */}
      <View style={styles.searchWrap}>
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="가게 이름 또는 주소 검색"
            placeholderTextColor={Colors.subtext}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.clearBtn}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* 카테고리 필터 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.id}
            style={[styles.chip, category === f.id && styles.chipActive]}
            onPress={() => setCategory(f.id)}
          >
            <Text style={[styles.chipText, category === f.id && styles.chipTextActive]}>
              {f.id === 'all' ? '전체' : f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* 결과 수 */}
      <SectionTitle
        title={search || category !== 'all' ? `검색 결과 ${filtered.length}개` : `주변 매장 ${filtered.length}개`}
      />

      {/* 가게 목록 */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={[styles.list, !filtered.length && styles.listEmpty]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        renderItem={({ item }) => <StoreCard store={item} />}
        ListEmptyComponent={
          <EmptyState
            icon="🏙️"
            title="주변에 매장이 없어요"
            subtitle={search ? `"${search}"에 대한 결과가 없습니다` : '다른 카테고리를 선택해보세요'}
          />
        }
      />
    </ScreenContainer>
  );
}

function StoreCard({ store }: { store: StoreSummary }) {
  const dist = store.distance
    ? store.distance < 1000 ? `${store.distance}m` : `${(store.distance / 1000).toFixed(1)}km`
    : null;

  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.88}>
      <View style={[styles.catBox, store.ownerIsDormant && styles.catBoxDormant]}>
        <Text style={styles.catEmoji}>{CATEGORY_LABEL[store.category]?.split(' ')[0] ?? '🎁'}</Text>
      </View>
      <View style={styles.info}>
        <View style={styles.row}>
          <Text style={styles.name} numberOfLines={1}>{store.name}</Text>
          {dist && <Text style={styles.dist}>{dist}</Text>}
        </View>
        <Text style={styles.addr} numberOfLines={1}>{store.address}</Text>
        <View style={styles.badges}>
          {store.ownerIsDormant
            ? <View style={[styles.badge, styles.badgeDormant]}><Text style={styles.badgeDormantText}>쿠폰 없음</Text></View>
            : (store.couponCount ?? 0) > 0
              ? <View style={[styles.badge, styles.badgeCoupon]}><Text style={styles.badgeCouponText}>🎁 쿠폰 {store.couponCount}개</Text></View>
              : null}
          <View style={[styles.badge, styles.badgeCat]}>
            <Text style={styles.badgeCatText}>{CATEGORY_LABEL[store.category]?.replace(/^.+\s/, '') ?? store.category}</Text>
          </View>
        </View>
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  header:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: 12, backgroundColor: Colors.white },
  headerTitle: { fontSize: 20, fontWeight: '800', color: Colors.primary },
  headerSub:   { fontSize: 12, color: Colors.subtext, marginTop: 1 },
  locBadge:    { backgroundColor: '#EFF6FF', paddingHorizontal: 10, paddingVertical: 5, borderRadius: Radius.full },
  locText:     { fontSize: 11, color: Colors.blue, fontWeight: '600' },
  searchWrap:  { paddingHorizontal: Spacing.md, paddingVertical: 10, backgroundColor: Colors.white },
  searchBar:   { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F3F4F6', borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 10, gap: 8 },
  searchIcon:  { fontSize: 15 },
  searchInput: { flex: 1, fontSize: 14, color: Colors.text, padding: 0 },
  clearBtn:    { fontSize: 14, color: Colors.subtext },
  filterRow:   { paddingHorizontal: Spacing.md, paddingVertical: 10, gap: 8, backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  chip:        { paddingHorizontal: 14, paddingVertical: 7, borderRadius: Radius.full, backgroundColor: '#F3F4F6', borderWidth: 1.5, borderColor: 'transparent' },
  chipActive:  { backgroundColor: '#FFF7ED', borderColor: Colors.primary },
  chipText:    { fontSize: 13, fontWeight: '600', color: Colors.subtext },
  chipTextActive: { color: Colors.primary },
  list:        { paddingHorizontal: Spacing.md, paddingBottom: 24, gap: 10 },
  listEmpty:   { flex: 1 },
  card:        { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  catBox:      { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: '#FFF7ED', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  catBoxDormant: { backgroundColor: '#F3F4F6' },
  catEmoji:    { fontSize: 24 },
  info:        { flex: 1, gap: 3 },
  row:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name:        { fontSize: 15, fontWeight: '700', color: Colors.text, flex: 1 },
  dist:        { fontSize: 12, color: Colors.subtext, marginLeft: 6 },
  addr:        { fontSize: 12, color: Colors.subtext },
  badges:      { flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  badge:       { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeCoupon: { backgroundColor: '#FFF7ED' },
  badgeCouponText: { fontSize: 11, color: Colors.primary, fontWeight: '700' },
  badgeDormant:    { backgroundColor: '#F3F4F6' },
  badgeDormantText: { fontSize: 11, color: Colors.subtext, fontWeight: '600' },
  badgeCat:    { backgroundColor: '#EFF6FF' },
  badgeCatText: { fontSize: 11, color: Colors.blue, fontWeight: '600' },
  chevron:     { fontSize: 20, color: '#D1D5DB' },
});
