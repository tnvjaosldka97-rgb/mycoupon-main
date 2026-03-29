/**
 * RootNavigator
 * - 인증 상태에 따라 AuthStack / MainTab 분기
 * - 1주차: mock 로그인 버튼으로 isLoggedIn 토글
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import LoginScreen from '../screens/LoginScreen';
import HomeScreen from '../screens/HomeScreen';
import MyCouponsScreen from '../screens/MyCouponsScreen';
import { COLORS } from '../lib/constants';

type Tab = 'home' | 'coupons';

export default function RootNavigator() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('home');

  if (!isLoggedIn) {
    return <LoginScreen onLogin={() => setIsLoggedIn(true)} />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.screen}>
        {activeTab === 'home' && <HomeScreen />}
        {activeTab === 'coupons' && <MyCouponsScreen />}
      </View>

      <View style={styles.tabBar}>
        <TabButton
          label="홈"
          icon="🏠"
          active={activeTab === 'home'}
          onPress={() => setActiveTab('home')}
        />
        <TabButton
          label="내 쿠폰"
          icon="🎁"
          active={activeTab === 'coupons'}
          onPress={() => setActiveTab('coupons')}
        />
      </View>
    </View>
  );
}

function TabButton({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.tabButton} onPress={onPress}>
      <Text style={styles.tabIcon}>{icon}</Text>
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  screen: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: COLORS.white,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingBottom: 20,
    paddingTop: 8,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  tabIcon: { fontSize: 22 },
  tabLabel: { fontSize: 11, color: COLORS.subtext },
  tabLabelActive: { color: COLORS.primary, fontWeight: '700' },
});
