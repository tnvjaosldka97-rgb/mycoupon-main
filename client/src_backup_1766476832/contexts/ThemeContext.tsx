import React, { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme?: () => void;
  switchable: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
  switchable?: boolean;
}

export function ThemeProvider({
  children,
  defaultTheme = "light",
  switchable = false,
}: ThemeProviderProps) {
  // 다크 모드 강제 비활성화: 항상 light 테마 사용
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const root = document.documentElement;
    const rootElement = document.getElementById('root');
    
    // 다크 모드 클래스 강제 제거 및 스타일 강제 설정
    const removeDarkMode = () => {
      root.classList.remove("dark");
      document.body.classList.remove("dark");
      if (rootElement) {
        rootElement.classList.remove("dark");
      }
      
      // 스타일 강제 설정
      root.style.setProperty('background-color', '#FFF5F0', 'important');
      root.style.setProperty('color', '#000000', 'important');
      document.body.style.setProperty('background-color', '#FFF5F0', 'important');
      document.body.style.setProperty('color', '#000000', 'important');
      if (rootElement) {
        rootElement.style.setProperty('background-color', '#FFF5F0', 'important');
        rootElement.style.setProperty('color', '#000000', 'important');
      }
    };
    
    removeDarkMode();
    
    // localStorage에 저장된 다크 모드 설정도 삭제
    if (localStorage.getItem("theme") === "dark") {
      localStorage.removeItem("theme");
      localStorage.setItem("theme", "light");
    }
    
    // 브라우저의 prefers-color-scheme 미디어 쿼리 무시
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    if (mediaQuery.matches) {
      // 시스템이 다크 모드여도 강제로 라이트 모드 유지
      removeDarkMode();
    }
    
    // MutationObserver로 다크 모드 클래스 추가 방지
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          removeDarkMode();
        }
      });
    });
    
    observer.observe(root, {
      attributes: true,
      attributeFilter: ['class'],
      subtree: true,
    });
    
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
    });
    
    if (rootElement) {
      observer.observe(rootElement, {
        attributes: true,
        attributeFilter: ['class'],
      });
    }
    
    // 주기적으로 다크 모드 클래스 확인 (500ms마다 - 더 빠르게)
    const interval = setInterval(removeDarkMode, 500);
    
    return () => {
      observer.disconnect();
      clearInterval(interval);
    };
  }, []);

  const toggleTheme = switchable
    ? () => {
        setTheme(prev => (prev === "light" ? "dark" : "light"));
      }
    : undefined;

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, switchable }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
