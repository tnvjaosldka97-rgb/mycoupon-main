import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import MyCouponsScreen from '../screens/MyCouponsScreen';
import CouponDetailScreen from '../screens/CouponDetailScreen';
import type { CouponsStackParamList } from './types';
import { Colors } from '../theme/tokens';

const Stack = createNativeStackNavigator<CouponsStackParamList>();

export default function CouponsStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: Colors.bg },
      }}
    >
      <Stack.Screen name="CouponsMain"   component={MyCouponsScreen} />
      <Stack.Screen name="CouponDetail"  component={CouponDetailScreen} />
    </Stack.Navigator>
  );
}
