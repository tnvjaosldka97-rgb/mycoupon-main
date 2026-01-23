/**
 * Railway 브릿지 서버 Socket.io 컨텍스트
 * 앱 전역에서 소켓 연결 상태 및 알림 관리
 */

import React, { createContext, useContext, useEffect, useRef, useState, useCallback, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

// 브릿지 서버 URL
const BRIDGE_SERVER_URL = import.meta.env.VITE_BRIDGE_SERVER_URL || '';

// 마스터 관리자 이메일 목록
const MASTER_ADMIN_EMAILS = [
  'tnvjaosldka97@gmail.com',
  'sakuradaezun@gmail.com',
];

// 알림 타입
export interface BridgeNotification {
  id: string;
  type: 'coupon' | 'expiring' | 'levelup' | 'nearby' | 'system';
  title: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp: Date;
  read: boolean;
}

// 컨텍스트 타입
interface BridgeSocketContextType {
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  notifications: BridgeNotification[];
  unreadCount: number;
  connect: () => void;
  disconnect: () => void;
  sendLocation: (lat: number, lng: number) => void;
  markAsRead: (notificationId: string) => void;
  markAllAsRead: () => void;
  clearNotifications: () => void;
}

const BridgeSocketContext = createContext<BridgeSocketContextType | null>(null);

interface BridgeSocketProviderProps {
  children: ReactNode;
}

export function BridgeSocketProvider({ children }: BridgeSocketProviderProps) {
  const { user, isLoggedIn } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<BridgeNotification[]>([]);

  // 관리자 여부
  const isAdmin = user?.email ? MASTER_ADMIN_EMAILS.includes(user.email) : false;

  // 읽지 않은 알림 수
  const unreadCount = notifications.filter(n => !n.read).length;

  // 알림 추가
  const addNotification = useCallback((notification: Omit<BridgeNotification, 'id' | 'timestamp' | 'read'>) => {
    const newNotification: BridgeNotification = {
      ...notification,
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      read: false,
    };
    setNotifications(prev => [newNotification, ...prev].slice(0, 50)); // 최대 50개 유지

    // 토스트 알림 표시
    toast(notification.title, {
      description: notification.message,
      duration: 5000,
    });
  }, []);

  // 소켓 연결
  const connect = useCallback(() => {
    if (!BRIDGE_SERVER_URL) {
      console.log('[BridgeSocket] 브릿지 서버 URL이 설정되지 않음 - 연결 건너뜀');
      return;
    }

    if (socketRef.current?.connected) {
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      const socket = io(BRIDGE_SERVER_URL, {
        transports: ['websocket', 'polling'],
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        auth: {
          userId: user?.id,
          email: user?.email,
          name: user?.name,
          isAdmin,
          appId: 'mycoupon',
        },
      });

      socket.on('connect', () => {
        console.log('[BridgeSocket] 연결 성공');
        setIsConnected(true);
        setIsConnecting(false);
        setError(null);
      });

      socket.on('disconnect', () => {
        console.log('[BridgeSocket] 연결 해제');
        setIsConnected(false);
      });

      socket.on('connect_error', (err) => {
        console.error('[BridgeSocket] 연결 오류:', err.message);
        setIsConnecting(false);
        setError(err.message);
      });

      // 신규 쿠폰 알림
      socket.on('coupon:created', (data) => {
        addNotification({
          type: 'coupon',
          title: '새로운 쿠폰!',
          message: `${data.storeName}에서 새 쿠폰이 등록되었습니다.`,
          data,
        });
      });

      // 쿠폰 마감 임박
      socket.on('coupon:expiring', (data) => {
        addNotification({
          type: 'expiring',
          title: '쿠폰 마감 임박!',
          message: `${data.couponTitle} 쿠폰이 곧 만료됩니다.`,
          data,
        });
      });

      // 레벨업
      socket.on('user:levelup', (data) => {
        addNotification({
          type: 'levelup',
          title: '레벨업!',
          message: `축하합니다! 레벨 ${data.newLevel}로 올랐습니다!`,
          data,
        });
      });

      // 근처 쿠폰
      socket.on('notification:nearby', (data) => {
        addNotification({
          type: 'nearby',
          title: '근처 쿠폰 발견!',
          message: `${data.distance}m 내에 쿠폰이 있습니다.`,
          data,
        });
      });

      socketRef.current = socket;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setIsConnecting(false);
      setError(errorMessage);
    }
  }, [user, isAdmin, addNotification]);

  // 소켓 연결 해제
  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      setIsConnected(false);
      setIsConnecting(false);
    }
  }, []);

  // 위치 업데이트 전송
  const sendLocation = useCallback((lat: number, lng: number) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('location:update', {
        userId: user?.id,
        lat,
        lng,
        timestamp: new Date().toISOString(),
      });
    }
  }, [user]);

  // 알림 읽음 처리
  const markAsRead = useCallback((notificationId: string) => {
    setNotifications(prev =>
      prev.map(n => n.id === notificationId ? { ...n, read: true } : n)
    );
  }, []);

  // 모든 알림 읽음 처리
  const markAllAsRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  // 알림 전체 삭제
  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  // 로그인 상태 변경 시 연결/해제
  useEffect(() => {
    if (isLoggedIn && BRIDGE_SERVER_URL) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [isLoggedIn, connect, disconnect]);

  return (
    <BridgeSocketContext.Provider
      value={{
        isConnected,
        isConnecting,
        error,
        notifications,
        unreadCount,
        connect,
        disconnect,
        sendLocation,
        markAsRead,
        markAllAsRead,
        clearNotifications,
      }}
    >
      {children}
    </BridgeSocketContext.Provider>
  );
}

export function useBridgeSocketContext() {
  const context = useContext(BridgeSocketContext);
  if (!context) {
    throw new Error('useBridgeSocketContext must be used within BridgeSocketProvider');
  }
  return context;
}
