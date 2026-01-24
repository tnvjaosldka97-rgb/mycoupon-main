import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "path";
import { defineConfig, Plugin } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";

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

const plugins = [
  react(), 
  tailwindcss(), 
  jsxLocPlugin(), 
  vitePluginManusRuntime(),
  injectServiceWorkerVersion() // 버전 자동 주입 플러그인 추가
];

export default defineConfig({
  plugins,
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(process.env.VITE_APP_VERSION || 'unknown'),
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
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'ui-vendor': ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu'],
          'trpc-vendor': ['@trpc/client', '@trpc/react-query'],
        },
      },
    },
  },
  server: {
    host: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
