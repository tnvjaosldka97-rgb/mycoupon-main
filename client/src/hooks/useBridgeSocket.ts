/**
 * Railway 브릿지 서버 Socket.io 클라이언트 훅
 * 실시간 알림 수신을 위한 소켓 연결 관리
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './useAuth';

// 브릿지 서버 URL (환경 변수에서 가져오거나 기본값 사용)
const BRIDGE_SERVER_URL = import.meta.env.VITE_BRIDGE_SERVER_URL || '';

// 마스터 관리자 이메일 목록
const MASTER_ADMIN_EMAILS = [
  'tnvjaosldka97@gmail.com',
  'sakuradaezun@gmail.com',
  'onlyup.myr@gmail.com',
  'mapo8887@gmail.com',
];

// 소켓 이벤트 타입
export type SocketEventType =
  | 'notification:coupon'      // 신규 쿠폰 알림
  | 'notification:expiring'    // 쿠폰 마감 임박 알림
  | 'notification:levelup'     // 레벨업 알림
  | 'notification:nearby'      // 근처 쿠폰 알림
  | 'system:connected'         // 연결 성공
  | 'system:disconnected'      // 연결 해제
  | 'system:error';            // 오류

// 알림 데이터 인터페이스
export interface NotificationData {
  type: SocketEventType;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

// 소켓 상태
export interface SocketState {
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  lastNotification: NotificationData | null;
}

/**
 * Railway 브릿지 서버 소켓 연결 훅
 */
export function useBridgeSocket() {
  const { user, isLoggedIn } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  const [state, setState] = useState<SocketState>({
    isConnected: false,
    isConnecting: false,
    error: null,
    lastNotification: null,
  });

  // 관리자 여부 확인
  const isAdmin = user?.email ? MASTER_ADMIN_EMAILS.includes(user.email) : false;

  // 알림 핸들러 목록
  const notificationHandlersRef = useRef<Map<string, (data: NotificationData) => void>>(new Map());

  // 알림 핸들러 등록
  const onNotification = useCallback((
    eventType: SocketEventType,
    handler: (data: NotificationData) => void
  ) => {
    notificationHandlersRef.current.set(eventType, handler);
    return () => {
      notificationHandlersRef.current.delete(eventType);
    };
  }, []);

  // 소켓 연결
  const connect = useCallback(() => {
    if (!BRIDGE_SERVER_URL) {
      console.log('[BridgeSocket] 브릿지 서버 URL이 설정되지 않음');
      return;
    }

    if (socketRef.current?.connected) {
      console.log('[BridgeSocket] 이미 연결됨');
      return;
    }

    setState(prev => ({ ...prev, isConnecting: true, error: null }));

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
        console.log('[BridgeSocket] 연결 성공:', socket.id);
        setState(prev => ({
          ...prev,
          isConnected: true,
          isConnecting: false,
          error: null,
        }));

        // 연결 성공 알림
        const notification: NotificationData = {
          type: 'system:connected',
          title: '연결됨',
          message: '실시간 알림 서버에 연결되었습니다.',
          timestamp: new Date().toISOString(),
        };
        setState(prev => ({ ...prev, lastNotification: notification }));
      });

      socket.on('disconnect', (reason) => {
        console.log('[BridgeSocket] 연결 해제:', reason);
        setState(prev => ({
          ...prev,
          isConnected: false,
          isConnecting: false,
        }));
      });

      socket.on('connect_error', (error) => {
        console.error('[BridgeSocket] 연결 오류:', error.message);
        setState(prev => ({
          ...prev,
          isConnected: false,
          isConnecting: false,
          error: error.message,
        }));
      });

      // 알림 이벤트 수신
      socket.on('notification', (data: NotificationData) => {
        console.log('[BridgeSocket] 알림 수신:', data);
        setState(prev => ({ ...prev, lastNotification: data }));

        // 등록된 핸들러 호출
        const handler = notificationHandlersRef.current.get(data.type);
        if (handler) {
          handler(data);
        }
      });

      // 신규 쿠폰 알림
      socket.on('coupon:created', (data) => {
        const notification: NotificationData = {
          type: 'notification:coupon',
          title: '새로운 쿠폰!',
          message: `${data.storeName}에서 새 쿠폰이 등록되었습니다.`,
          data,
          timestamp: new Date().toISOString(),
        };
        setState(prev => ({ ...prev, lastNotification: notification }));
        notificationHandlersRef.current.get('notification:coupon')?.(notification);
      });

      // 쿠폰 마감 임박 알림
      socket.on('coupon:expiring', (data) => {
        const notification: NotificationData = {
          type: 'notification:expiring',
          title: '쿠폰 마감 임박!',
          message: `${data.couponTitle} 쿠폰이 ${data.hoursRemaining}시간 후 만료됩니다.`,
          data,
          timestamp: new Date().toISOString(),
        };
        setState(prev => ({ ...prev, lastNotification: notification }));
        notificationHandlersRef.current.get('notification:expiring')?.(notification);
      });

      // 레벨업 알림
      socket.on('user:levelup', (data) => {
        const notification: NotificationData = {
          type: 'notification:levelup',
          title: '레벨업!',
          message: `축하합니다! 레벨 ${data.newLevel}로 올랐습니다!`,
          data,
          timestamp: new Date().toISOString(),
        };
        setState(prev => ({ ...prev, lastNotification: notification }));
        notificationHandlersRef.current.get('notification:levelup')?.(notification);
      });

      // 근처 쿠폰 알림
      socket.on('notification:nearby', (data) => {
        const notification: NotificationData = {
          type: 'notification:nearby',
          title: '근처 쿠폰 발견!',
          message: `${data.distance}m 내에 ${data.count}개의 쿠폰이 있습니다.`,
          data,
          timestamp: new Date().toISOString(),
        };
        setState(prev => ({ ...prev, lastNotification: notification }));
        notificationHandlersRef.current.get('notification:nearby')?.(notification);
      });

      socketRef.current = socket;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[BridgeSocket] 초기화 오류:', errorMessage);
      setState(prev => ({
        ...prev,
        isConnecting: false,
        error: errorMessage,
      }));
    }
  }, [user, isAdmin]);

  // 소켓 연결 해제
  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      setState(prev => ({
        ...prev,
        isConnected: false,
        isConnecting: false,
      }));
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

  // 로그인 상태 변경 시 소켓 연결/해제
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

  return {
    ...state,
    isAdmin,
    connect,
    disconnect,
    onNotification,
    sendLocation,
    socket: socketRef.current,
  };
}

/**
 * 브릿지 서버 연결 상태 표시 컴포넌트용 훅
 */
export function useBridgeConnectionStatus() {
  const { isConnected, isConnecting, error } = useBridgeSocket();

  const status = isConnected
    ? 'connected'
    : isConnecting
    ? 'connecting'
    : error
    ? 'error'
    : 'disconnected';

  const statusText = {
    connected: '실시간 알림 연결됨',
    connecting: '연결 중...',
    error: `연결 오류: ${error}`,
    disconnected: '연결 안됨',
  }[status];

  const statusColor = {
    connected: 'green',
    connecting: 'yellow',
    error: 'red',
    disconnected: 'gray',
  }[status];

  return { status, statusText, statusColor };
}
