import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "path";
import { defineConfig, Plugin } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";
import { visualizer } from "rollup-plugin-visualizer";

// Service Worker 버전 자동 주입 플러그인
function injectServiceWorkerVersion(): Plugin {
  // 빌드 시점의 타임스탬프 기반 버전 생성
  const version = `v${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 13)}`;
  
  return {
    name: 'inject-sw-version',
    
    // HTML 파일 변환 (index.html)
    transformIndexHtml(html) {
      console.log(`🔧 [Vite Plugin] Injecting Service Worker version: ${version}`);
      
      // __SW_VERSION__ 플레이스홀더를 실제 버전으로 교체
      return html.replace(/__SW_VERSION__/g, version);
    },
    
    // 빌드 완료 후 Service Worker 파일 수정
    closeBundle() {
      const distPublicDir = path.resolve(import.meta.dirname, 'dist/public');
      const swPaths = [
        path.join(distPublicDir, 'sw.js'),
        path.join(distPublicDir, 'service-worker.js')
      ];
      
      swPaths.forEach(swPath => {
        if (fs.existsSync(swPath)) {
          let content = fs.readFileSync(swPath, 'utf8');
          
          // __SW_VERSION__ 플레이스홀더 또는 기존 버전을 새 버전으로 교체
          content = content.replace(
            /const CACHE_VERSION = ['"](__SW_VERSION__|v[^'"]*)['"]/,
            `const CACHE_VERSION = '${version}'`
          );
          
          fs.writeFileSync(swPath, content, 'utf8');
          console.log(`✅ [Vite Plugin] Updated ${path.basename(swPath)} with version ${version}`);
        }
      });
      
      console.log('✅ [Vite Plugin] Service Worker version injection complete!');
    }
  };
}

const plugins: Plugin[] = [
  react(),
  tailwindcss(),
  jsxLocPlugin(),
  vitePluginManusRuntime(),
  injectServiceWorkerVersion(), // 버전 자동 주입 플러그인 추가
];

// 번들 분석 — ANALYZE=true 환경변수 설정 시에만 활성화 (빌드 시 결과: stats.html)
// 실행: ANALYZE=true npm run build
if (process.env.ANALYZE === 'true') {
  plugins.push(
    visualizer({
      open:       true,         // 빌드 완료 후 브라우저 자동 오픈
      filename:   'stats.html', // 프로젝트 루트에 생성
      gzipSize:   true,         // gzip 압축 후 크기 표시
      brotliSize: true,         // brotli 압축 후 크기 표시
    }) as unknown as Plugin
  );
}

export default defineConfig(({ mode }) => ({
  plugins,
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(process.env.VITE_APP_VERSION || 'unknown'),
  },
  // QA-C3 (PR-19): production 빌드에서 console.* + debugger 자동 제거
  // sensitive 정보(auth 상태, GPS 좌표, 권한 토큰 등)가 브라우저 devtools 노출되는 것 차단
  // dev/serve 모드에서는 그대로 유지 — 개발 디버깅 영향 없음
  esbuild: {
    drop: mode === 'production' ? ['console', 'debugger'] : [],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    minify: 'esbuild', // esbuild 사용 (빠르고 안정적)
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // React 관련 번들
          if (id.includes('react') || id.includes('react-dom')) {
            return 'react-vendor';
          }
          // UI 라이브러리 번들
          if (id.includes('@radix-ui') || id.includes('lucide-react')) {
            return 'ui-vendor';
          }
          // TRPC/Query 번들
          if (id.includes('@trpc') || id.includes('@tanstack/react-query')) {
            return 'trpc-vendor';
          }
          // 지도 관련 번들 (큰 라이브러리 분리)
          if (id.includes('google-maps') || id.includes('leaflet')) {
            return 'map-vendor';
          }
          // Wouter 라우터 번들
          if (id.includes('wouter')) {
            return 'router-vendor';
          }
          // node_modules는 별도 vendor 번들로
          if (id.includes('node_modules')) {
            return 'vendor';
          }
        },
        // 🔒 Unexpected token '<' 에러 방지: HTML fallback 설정
        assetFileNames: (assetInfo) => {
          const info = assetInfo.name?.split('.');
          const ext = info?.[info.length - 1];
          if (/png|jpe?g|svg|gif|tiff|bmp|ico|webp/i.test(ext || '')) {
            return `assets/images/[name]-[hash][extname]`;
          } else if (/css/i.test(ext || '')) {
            return `assets/css/[name]-[hash][extname]`;
          }
          return `assets/[name]-[hash][extname]`;
        },
        chunkFileNames: 'assets/js/[name]-[hash].js',
        entryFileNames: 'assets/js/[name]-[hash].js',
      },
    },
    // 청크 크기 경고 제한 상향 (지도 라이브러리가 큼)
    chunkSizeWarningLimit: 1000,
  },
  server: {
    host: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
}));
