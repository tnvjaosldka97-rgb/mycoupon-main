import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { CouponSummary } from '../types/contracts';

// AuthStack 파라미터
export type AuthStackParamList = {
  Login: undefined;
};

// HomeStack 파라미터 (홈 탭 내 스택)
export type HomeStackParamList = {
  HomeMain: undefined;
};

// CouponsStack 파라미터 (내 쿠폰 탭 내 스택)
export type CouponsStackParamList = {
  CouponsMain: undefined;
  CouponDetail: { coupon: CouponSummary };
};

// MainTabs 파라미터
export type MainTabsParamList = {
  Home:    undefined;
  Coupons: undefined;
};

// 개별 화면 navigation prop 타입
export type LoginNavProp = NativeStackNavigationProp<AuthStackParamList, 'Login'>;

export type HomeNavProp = CompositeNavigationProp<
  NativeStackNavigationProp<HomeStackParamList, 'HomeMain'>,
  BottomTabNavigationProp<MainTabsParamList>
>;

export type CouponsNavProp = CompositeNavigationProp<
  NativeStackNavigationProp<CouponsStackParamList, 'CouponsMain'>,
  BottomTabNavigationProp<MainTabsParamList>
>;

export type CouponDetailNavProp = NativeStackNavigationProp<CouponsStackParamList, 'CouponDetail'>;
