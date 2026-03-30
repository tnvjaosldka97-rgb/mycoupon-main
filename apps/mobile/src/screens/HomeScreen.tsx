/**
 * HomeScreen — react-navigation 연결
 * 탭 네비게이터 안에서 렌더링 (탭 전환은 MainTabs가 처리)
 */
import React, { useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, TextInput, ScrollView, RefreshControl,
} from 'react-native';
import { ScreenContainer } from '../components/ScreenContainer';
import { EmptyState } from './../../src/components/ui/EmptyState';
import type { StoreSummary, StoreCategory } from '../types/contracts';
import { MOCK_STORES } from '../mock/stores';
import { Colors } from '../theme/tokens';

const CATEGORY_LABEL: Record<string, string> = {
  cafe: '☕ 카페', restaurant: '🍽️ 음식점', beauty: '💅 뷰티',
  hospital: '🏥 병원', fitness: '💪 헬스장', other: '🎁 기타',
};

type CategoryFilter = StoreCategory | 'all';
const FILTERS: { id: CategoryFilter; label: string }[] = [
  { id: 'all', label: '전체' }, { id: 'cafe', label: '☕ 카페' },
  { id: 'restaurant', label: '🍽️ 음식점' }, { id: 'beauty', label: '💅 뷰티' },
  { id: 'fitness', label: '💪 헬스장' }, { id: 'hospital', label: '🏥 병원' },
  { id: 'other', label: '🎁 기타' },
];

export default function HomeScreen() {
  const [search, setSearch]           = useState('');
  const [activeCategory, setCategory] = useState<CategoryFilter>('all');
  const [refreshing, setRefreshing]   = useState(false);

  const filtered = MOCK_STORES.filter((s) => {
    const q = search.toLowerCase();
    const matchSearch  = !search || s.name.toLowerCase().includes(q) || s.address.toLowerCase().includes(q);
    const matchCat     = activeCategory === 'all' || s.category === activeCategory;
    return matchSearch && matchCat;
  });

  const onRefresh = () => { setRefreshing(true); setTimeout(() => setRefreshing(false), 800); };

  return (
    <ScreenContainer>
      {/* 헤더 */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>🍊 마이쿠폰</Text>
          <Text style={styles.headerSub}>내 주변 쿠폰을 찾아보세요</Text>
        </View>
        <View style={styles.locBadge}><Text style={styles.locText}>📍 위치 설정 중</Text></View>
      </View>

      {/* 검색바 */}
      <View style={styles.searchRow}>
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput} placeholder="가게 이름, 주소 검색"
            placeholderTextColor={Colors.subtext} value={search} onChangeText={setSearch}
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
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.id}
            style={[styles.filterChip, activeCategory === f.id && styles.filterChipActive]}
            onPress={() => setCategory(f.id)}
          >
            <Text style={[styles.filterText, activeCategory === f.id && styles.filterTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Text style={styles.resultCount}>
        {search || activeCategory !== 'all' ? `검색 결과 ${filtered.length}개` : `전체 ${filtered.length}개 매장`}
      </Text>

      <FlatList
        data={filtered} keyExtractor={(item) => String(item.id)}
        contentContainerStyle={[styles.list, !filtered.length && styles.listEmpty]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        renderItem={({ item }) => <StoreCard store={item} />}
        ListEmptyComponent={
          <EmptyState icon="🏙️" title="주변에 쿠폰이 없어요" subtitle="다른 카테고리나 검색어로 찾아보세요" />
        }
      />
    </ScreenContainer>
  );
}

function StoreCard({ store }: { store: StoreSummary }) {
  const dist = store.distance
    ? store.distance < 1000 ? `${store.distance}m` : `${(store.distance / 1000).toFixed(1)}km`
    : null;
  const hasCoupon = (store.couponCount ?? 0) > 0;

  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.9}>
      <View style={[styles.catIcon, store.ownerIsDormant && styles.catIconDormant]}>
        <Text style={styles.catEmoji}>{CATEGORY_LABEL[store.category]?.split(' ')[0] ?? '🎁'}</Text>
      </View>
      <View style={styles.cardInfo}>
        <View style={styles.cardTitleRow}>
          <Text style={styles.storeName} numberOfLines={1}>{store.name}</Text>
          {dist && <Text style={styles.distance}>{dist}</Text>}
        </View>
        <Text style={styles.storeAddr} numberOfLines={1}>{store.address}</Text>
        <View style={styles.badgeRow}>
          {store.ownerIsDormant
            ? <View style={styles.dormBadge}><Text style={styles.dormText}>쿠폰 없음</Text></View>
            : hasCoupon
              ? <View style={styles.couponBadge}><Text style={styles.couponText}>🎁 쿠폰 {store.couponCount}개</Text></View>
              : null}
          <View style={styles.catPill}><Text style={styles.catPillText}>{CATEGORY_LABEL[store.category] ?? store.category}</Text></View>
        </View>
      </View>
      <Text style={styles.arrow}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  header:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8, backgroundColor: Colors.white },
  headerTitle: { fontSize: 20, fontWeight: '800', color: Colors.primary },
  headerSub:   { fontSize: 12, color: Colors.subtext, marginTop: 1 },
  locBadge:    { backgroundColor: '#EFF6FF', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  locText:     { fontSize: 11, color: Colors.blue, fontWeight: '600' },
  searchRow:   { paddingHorizontal: 16, paddingVertical: 10, backgroundColor: Colors.white },
  searchBar:   { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F3F4F6',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, gap: 8 },
  searchIcon:  { fontSize: 15 },
  searchInput: { flex: 1, fontSize: 14, color: Colors.text, padding: 0 },
  clearBtn:    { fontSize: 14, color: Colors.subtext, paddingHorizontal: 4 },
  filterRow:   { paddingHorizontal: 16, paddingVertical: 10, gap: 8,
    backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  filterChip:  { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#F3F4F6',
    borderWidth: 1.5, borderColor: 'transparent' },
  filterChipActive: { backgroundColor: '#FFF7ED', borderColor: Colors.primary },
  filterText:  { fontSize: 13, color: Colors.subtext, fontWeight: '600' },
  filterTextActive: { color: Colors.primary },
  resultCount: { fontSize: 12, color: Colors.subtext, paddingHorizontal: 20, paddingVertical: 8, fontWeight: '500' },
  list:        { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
  listEmpty:   { flex: 1 },
  card:        { backgroundColor: Colors.white, borderRadius: 16, padding: 14,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  catIcon:     { width: 48, height: 48, borderRadius: 14, backgroundColor: '#FFF7ED', alignItems: 'center', justifyContent: 'center' },
  catIconDormant: { backgroundColor: '#F3F4F6' },
  catEmoji:    { fontSize: 24 },
  cardInfo:    { flex: 1, gap: 3 },
  cardTitleRow:{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  storeName:   { fontSize: 15, fontWeight: '700', color: Colors.text, flex: 1 },
  distance:    { fontSize: 12, color: Colors.subtext, marginLeft: 8 },
  storeAddr:   { fontSize: 12, color: Colors.subtext },
  badgeRow:    { flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  couponBadge: { backgroundColor: '#FFF7ED', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  couponText:  { fontSize: 11, color: Colors.primary, fontWeight: '700' },
  dormBadge:   { backgroundColor: '#F3F4F6', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  dormText:    { fontSize: 11, color: Colors.subtext, fontWeight: '600' },
  catPill:     { backgroundColor: '#EFF6FF', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  catPillText: { fontSize: 11, color: Colors.blue, fontWeight: '600' },
  arrow:       { fontSize: 20, color: '#D1D5DB' },
});
