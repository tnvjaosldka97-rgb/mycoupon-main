/**
 * RootNavigator — UI Polish
 * - 탭바 스타일 개선 (active 인디케이터)
 * - 1주차: mock 로그인 유지
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import LoginScreen from '../screens/LoginScreen';
import HomeScreen from '../screens/HomeScreen';
import MyCouponsScreen from '../screens/MyCouponsScreen';
import { COLORS } from '../lib/constants';

type Tab = 'home' | 'coupons';

const TABS: { id: Tab; label: string; icon: string; activeIcon: string }[] = [
  { id: 'home',    label: '홈',     icon: '🏠',  activeIcon: '🏠' },
  { id: 'coupons', label: '내 쿠폰', icon: '🎁', activeIcon: '🎁' },
];

export default function RootNavigator() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('home');

  if (!isLoggedIn) {
    return <LoginScreen onLogin={() => setIsLoggedIn(true)} />;
  }

  return (
    <View style={styles.container}>
      {/* 화면 */}
      <View style={styles.screen}>
        {activeTab === 'home'    && <HomeScreen />}
        {activeTab === 'coupons' && <MyCouponsScreen />}
      </View>

      {/* 탭바 */}
      <View style={styles.tabBar}>
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <TouchableOpacity
              key={tab.id}
              style={styles.tabButton}
              onPress={() => setActiveTab(tab.id)}
              activeOpacity={0.7}
            >
              {active && <View style={styles.activeIndicator} />}
              <Text style={[styles.tabIcon, active && styles.tabIconActive]}>
                {active ? tab.activeIcon : tab.icon}
              </Text>
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  screen: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: COLORS.white,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    paddingBottom: 24,
    paddingTop: 8,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 8,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingTop: 4,
    position: 'relative',
  },
  activeIndicator: {
    position: 'absolute',
    top: -8,
    width: 28,
    height: 3,
    backgroundColor: COLORS.primary,
    borderRadius: 2,
  },
  tabIcon: { fontSize: 22, opacity: 0.45 },
  tabIconActive: { opacity: 1 },
  tabLabel: { fontSize: 10, color: COLORS.subtext, fontWeight: '600' },
  tabLabelActive: { color: COLORS.primary, fontWeight: '800' },
});
