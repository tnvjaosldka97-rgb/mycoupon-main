/**
 * RootNavigator — react-navigation 기반
 * AuthContext.isLoggedIn 기준으로 AuthStack / MainTabs 분기
 */
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import AuthStack from './AuthStack';
import MainTabs from './MainTabs';
import { Colors } from '../theme/tokens';

export default function RootNavigator() {
  const { isLoggedIn } = useAuth();

  return (
    <NavigationContainer
      theme={{
        dark: false,
        colors: {
          primary:    Colors.primary,
          background: Colors.bg,
          card:       Colors.white,
          text:       Colors.text,
          border:     Colors.border,
          notification: Colors.primary,
        },
      }}
    >
      {isLoggedIn ? <MainTabs /> : <AuthStack />}
    </NavigationContainer>
  );
}
