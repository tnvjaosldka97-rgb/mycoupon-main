/**
 * HomeScreen
 * - 1주차: mock 가게 목록 (실제 API 미연결)
 * - 위치 권한 요청은 자리만 (expo-location 추후 연동)
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
} from 'react-native';
import type { StoreSummary } from '../types/contracts';
import { MOCK_STORES } from '../mock/stores';
import { COLORS, CATEGORY_LABEL } from '../lib/constants';

export default function HomeScreen() {
  const [search, setSearch] = useState('');

  const filtered = MOCK_STORES.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* 헤더 */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>🍊 마이쿠폰</Text>
        <Text style={styles.headerSub}>내 주변 쿠폰</Text>
      </View>

      {/* 검색바 */}
      <View style={styles.searchBar}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="가게 이름 검색"
          placeholderTextColor={COLORS.subtext}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* 위치 안내 */}
      <View style={styles.locationBanner}>
        <Text style={styles.locationText}>
          📍 위치 기반 서비스 — 실제 연동 시 반경 내 가게 표시
        </Text>
      </View>

      {/* 가게 목록 */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => <StoreCard store={item} />}
        ListEmptyComponent={
          <Text style={styles.empty}>검색 결과가 없습니다.</Text>
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
    : '';

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.storeName}>{store.name}</Text>
        {distanceText ? (
          <Text style={styles.distance}>{distanceText}</Text>
        ) : null}
      </View>
      <View style={styles.cardMeta}>
        <Text style={styles.category}>
          {CATEGORY_LABEL[store.category] ?? store.category}
        </Text>
        {store.ownerIsDormant ? (
          <Text style={styles.dormantBadge}>쿠폰 없음</Text>
        ) : store.couponCount ? (
          <Text style={styles.couponBadge}>🎁 쿠폰 {store.couponCount}개</Text>
        ) : null}
      </View>
      <Text style={styles.address} numberOfLines={1}>
        {store.address}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: { fontSize: 20, fontWeight: '800', color: COLORS.primary },
  headerSub: { fontSize: 13, color: COLORS.subtext },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    marginVertical: 10,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  searchIcon: { fontSize: 16, marginRight: 8 },
  searchInput: { flex: 1, fontSize: 14, color: COLORS.text },
  locationBanner: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: '#FFF7ED',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  locationText: { fontSize: 12, color: '#92400E' },
  list: { paddingHorizontal: 16, paddingBottom: 20, gap: 12 },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 4,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  storeName: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  distance: { fontSize: 12, color: COLORS.subtext },
  cardMeta: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  category: { fontSize: 12, color: COLORS.subtext },
  couponBadge: {
    fontSize: 11,
    color: COLORS.primary,
    fontWeight: '700',
    backgroundColor: '#FFF7ED',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  dormantBadge: {
    fontSize: 11,
    color: COLORS.subtext,
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  address: { fontSize: 12, color: COLORS.subtext },
  empty: { textAlign: 'center', color: COLORS.subtext, marginTop: 40 },
});
