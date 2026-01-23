# 지금쿠폰 디자인 시스템

## 🎨 디자인 컨셉

**"아기자기하고 따뜻한 동네 쿠폰북"**

- 타겟: 20-40대 (특히 여성 친화적)
- 감성: 인스타그램 감성, 카페 감성
- 스타일: 파스텔 톤, 둥근 모서리, 부드러운 그림자

---

## 🎨 색상 팔레트

### 주 색상 (Primary)
```css
--primary-50: #FFF3E0;   /* 아주 연한 복숭아 */
--primary-100: #FFE0B2;  /* 연한 복숭아 */
--primary-200: #FFCC80;  /* 복숭아 */
--primary-300: #FFB74D;  /* 진한 복숭아 */
--primary-400: #FFA726;  /* 오렌지 */
--primary-500: #FF9800;  /* 메인 오렌지 */
--primary-600: #FB8C00;  /* 진한 오렌지 */
```

### 보조 색상 (Secondary) - 민트
```css
--secondary-50: #E0F7FA;   /* 아주 연한 민트 */
--secondary-100: #B2EBF2;  /* 연한 민트 */
--secondary-200: #80DEEA;  /* 민트 */
--secondary-300: #4DD0E1;  /* 진한 민트 */
--secondary-400: #26C6DA;  /* 청록 */
--secondary-500: #00BCD4;  /* 메인 청록 */
```

### 강조 색상 (Accent) - 핑크
```css
--accent-50: #FCE4EC;    /* 아주 연한 핑크 */
--accent-100: #F8BBD0;   /* 연한 핑크 */
--accent-200: #F48FB1;   /* 핑크 */
--accent-300: #F06292;   /* 진한 핑크 */
--accent-400: #EC407A;   /* 로즈 */
--accent-500: #E91E63;   /* 메인 로즈 */
```

### 중립 색상 (Neutral)
```css
--gray-50: #FAFAFA;    /* 배경 */
--gray-100: #F5F5F5;   /* 연한 회색 */
--gray-200: #EEEEEE;   /* 회색 */
--gray-300: #E0E0E0;   /* 테두리 */
--gray-400: #BDBDBD;   /* 중간 회색 */
--gray-500: #9E9E9E;   /* 진한 회색 */
--gray-600: #757575;   /* 텍스트 보조 */
--gray-700: #616161;   /* 텍스트 */
--gray-800: #424242;   /* 텍스트 진함 */
--gray-900: #212121;   /* 텍스트 메인 */
```

### 기능 색상
```css
--success: #66BB6A;    /* 성공 - 연한 초록 */
--warning: #FFA726;    /* 경고 - 오렌지 */
--error: #EF5350;      /* 에러 - 연한 빨강 */
--info: #42A5F5;       /* 정보 - 연한 파랑 */
```

---

## 📝 타이포그래피

### 폰트 패밀리
```css
font-family: 'Pretendard Variable', -apple-system, BlinkMacSystemFont, system-ui, Roboto, sans-serif;
```

### 폰트 크기
```css
--text-xs: 12px;      /* 작은 텍스트 */
--text-sm: 14px;      /* 보조 텍스트 */
--text-base: 16px;    /* 기본 텍스트 */
--text-lg: 18px;      /* 큰 텍스트 */
--text-xl: 20px;      /* 제목 */
--text-2xl: 24px;     /* 큰 제목 */
--text-3xl: 30px;     /* 메인 제목 */
--text-4xl: 36px;     /* 히어로 제목 */
```

### 폰트 굵기
```css
--font-light: 300;
--font-normal: 400;
--font-medium: 500;
--font-semibold: 600;
--font-bold: 700;
```

---

## 🔲 간격 시스템

```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-8: 32px;
--space-10: 40px;
--space-12: 48px;
--space-16: 64px;
```

---

## 🔘 둥근 모서리

```css
--radius-sm: 8px;     /* 작은 요소 */
--radius-md: 12px;    /* 기본 */
--radius-lg: 16px;    /* 큰 요소 */
--radius-xl: 20px;    /* 아주 큰 요소 */
--radius-full: 9999px; /* 완전 둥근 */
```

---

## 🌟 그림자

```css
--shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
--shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
--shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
--shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
```

---

## 🎨 컴포넌트 스타일

### 버튼
```css
/* 주 버튼 */
.btn-primary {
  background: linear-gradient(135deg, var(--primary-400), var(--primary-500));
  color: white;
  border-radius: var(--radius-lg);
  padding: 12px 24px;
  font-weight: var(--font-semibold);
  box-shadow: var(--shadow-md);
  transition: all 0.3s ease;
}

.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg);
}

/* 보조 버튼 */
.btn-secondary {
  background: white;
  color: var(--primary-500);
  border: 2px solid var(--primary-200);
  border-radius: var(--radius-lg);
  padding: 12px 24px;
  font-weight: var(--font-semibold);
}
```

### 카드
```css
.card {
  background: white;
  border-radius: var(--radius-xl);
  padding: var(--space-6);
  box-shadow: var(--shadow-md);
  transition: all 0.3s ease;
}

.card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-xl);
}

/* 쿠폰 카드 */
.coupon-card {
  background: white;
  border-radius: var(--radius-xl);
  padding: var(--space-4);
  box-shadow: var(--shadow-md);
  border: 2px solid var(--primary-50);
  position: relative;
  overflow: hidden;
}

.coupon-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: linear-gradient(90deg, var(--primary-400), var(--accent-400));
}
```

### 배지
```css
.badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  border-radius: var(--radius-full);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
}

.badge-primary {
  background: var(--primary-100);
  color: var(--primary-600);
}

.badge-secondary {
  background: var(--secondary-100);
  color: var(--secondary-600);
}

.badge-accent {
  background: var(--accent-100);
  color: var(--accent-600);
}
```

---

## 🎯 아이콘 스타일

- **스타일**: 둥글고 부드러운 라인
- **크기**: 20px, 24px, 32px
- **색상**: 주 색상 또는 회색
- **사용**: Lucide React Icons

---

## 🖼️ 이미지 스타일

```css
.image-rounded {
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.image-circle {
  border-radius: var(--radius-full);
  overflow: hidden;
}
```

---

## 📱 반응형 브레이크포인트

```css
--mobile: 640px;
--tablet: 768px;
--desktop: 1024px;
--wide: 1280px;
```

---

## ✨ 애니메이션

```css
/* 부드러운 페이드인 */
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 통통 튀는 효과 */
@keyframes bounce {
  0%, 100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-10px);
  }
}

/* 반짝이는 효과 */
@keyframes shimmer {
  0% {
    background-position: -1000px 0;
  }
  100% {
    background-position: 1000px 0;
  }
}
```

---

## 🎨 사용 예시

### 히어로 섹션
```
배경: 파스텔 그라데이션 (primary-50 → secondary-50)
제목: text-4xl, font-bold, gray-900
서브: text-xl, font-normal, gray-600
버튼: btn-primary
```

### 쿠폰 카드
```
배경: white
테두리: primary-50
그림자: shadow-md
둥근 모서리: radius-xl
상단 바: primary-400 → accent-400 그라데이션
```

### 네비게이션
```
배경: white
그림자: shadow-sm
높이: 64px
로고: primary-500
링크: gray-700, hover → primary-500
```

---

*디자인 시스템 v1.0 - 2025-12-09*
