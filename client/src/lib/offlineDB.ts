// IndexedDB 유틸리티 for 오프라인 쿠폰 저장

const DB_NAME = 'MyCouponDB';
const DB_VERSION = 1;
const STORE_NAME = 'offlineCoupons';

export interface OfflineCoupon {
  id?: number;
  couponCode: string;
  storeId: number;
  timestamp: number;
  data: {
    couponCode: string;
    storeId: number;
  };
}

// IndexedDB 열기
export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('IndexedDB error:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      
      // offlineCoupons 스토어 생성
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { 
          keyPath: 'id', 
          autoIncrement: true 
        });
        store.createIndex('couponCode', 'couponCode', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        console.log('IndexedDB store created:', STORE_NAME);
      }
    };
  });
}

// 오프라인 쿠폰 저장
export async function saveOfflineCoupon(coupon: Omit<OfflineCoupon, 'id'>): Promise<number> {
  const db = await openDB();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.add(coupon);

    request.onsuccess = () => {
      console.log('Offline coupon saved:', coupon.couponCode);
      resolve(request.result as number);
    };

    request.onerror = () => {
      console.error('Failed to save offline coupon:', request.error);
      reject(request.error);
    };
  });
}

// 모든 오프라인 쿠폰 가져오기
export async function getAllOfflineCoupons(): Promise<OfflineCoupon[]> {
  const db = await openDB();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      console.error('Failed to get offline coupons:', request.error);
      reject(request.error);
    };
  });
}

// 오프라인 쿠폰 삭제
export async function deleteOfflineCoupon(id: number): Promise<void> {
  const db = await openDB();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => {
      console.log('Offline coupon deleted:', id);
      resolve();
    };

    request.onerror = () => {
      console.error('Failed to delete offline coupon:', request.error);
      reject(request.error);
    };
  });
}

// 모든 오프라인 쿠폰 삭제
export async function clearAllOfflineCoupons(): Promise<void> {
  const db = await openDB();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => {
      console.log('All offline coupons cleared');
      resolve();
    };

    request.onerror = () => {
      console.error('Failed to clear offline coupons:', request.error);
      reject(request.error);
    };
  });
}

// 오프라인 쿠폰 수 가져오기
export async function getOfflineCouponCount(): Promise<number> {
  const db = await openDB();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.count();

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      console.error('Failed to count offline coupons:', request.error);
      reject(request.error);
    };
  });
}

// Background Sync 등록
export async function registerBackgroundSync(): Promise<void> {
  if ('serviceWorker' in navigator && 'sync' in ServiceWorkerRegistration.prototype) {
    try {
      const registration = await navigator.serviceWorker.ready;
      // @ts-ignore - Background Sync API
      await registration.sync.register('sync-offline-coupons');
      console.log('Background sync registered');
    } catch (error) {
      console.error('Failed to register background sync:', error);
    }
  } else {
    console.warn('Background sync not supported');
  }
}
