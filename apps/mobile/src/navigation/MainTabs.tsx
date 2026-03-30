import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import HomeScreen from '../screens/HomeScreen';
import CouponsStack from './CouponsStack';
import type { MainTabsParamList } from './types';
import { Colors, Shadow } from '../theme/tokens';

const Tab = createBottomTabNavigator<MainTabsParamList>();

function TabIcon({ icon, label, focused }: { icon: string; label: string; focused: boolean }) {
  return (
    <View style={tabStyles.iconWrap}>
      {focused && <View style={tabStyles.indicator} />}
      <Text style={[tabStyles.icon, !focused && tabStyles.iconDim]}>{icon}</Text>
      <Text style={[tabStyles.label, focused && tabStyles.labelActive]}>{label}</Text>
    </View>
  );
}

const tabStyles = StyleSheet.create({
  iconWrap: { alignItems: 'center', paddingTop: 6, gap: 2, width: 60 },
  indicator: {
    position: 'absolute',
    top: -6,
    width: 28,
    height: 3,
    backgroundColor: Colors.primary,
    borderRadius: 2,
  },
  icon:        { fontSize: 22, opacity: 0.4 },
  iconDim:     { opacity: 0.35 },
  label:       { fontSize: 10, color: Colors.subtext, fontWeight: '600' },
  labelActive: { color: Colors.primary, fontWeight: '800' },
});

export default function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: Colors.white,
          borderTopWidth: 1,
          borderTopColor: '#F3F4F6',
          paddingBottom: 20,
          paddingTop: 0,
          height: 72,
          ...Shadow.md,
        },
        tabBarShowLabel: false,
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon icon="🏠" label="홈" focused={focused} />
          ),
        }}
      />
      <Tab.Screen
        name="Coupons"
        component={CouponsStack}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon icon="🎁" label="내 쿠폰" focused={focused} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}
