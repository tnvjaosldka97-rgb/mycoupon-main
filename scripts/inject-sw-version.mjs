import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 타임스탬프 기반 버전 생성 (예: v20241219-093000)
const version = `v${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 13)}`;

console.log(`🔧 Injecting Service Worker version: ${version}`);

// Service Worker 파일 경로
const swPaths = [
  path.join(__dirname, '../client/public/sw.js'),
  path.join(__dirname, '../client/public/service-worker.js')
];

swPaths.forEach(swPath => {
  if (fs.existsSync(swPath)) {
    let content = fs.readFileSync(swPath, 'utf8');
    
    // 플레이스홀더 또는 기존 버전을 새 버전으로 교체
    content = content.replace(
      /const CACHE_VERSION = ['"](__SW_VERSION__|v[^'"]*)['"]/,
      `const CACHE_VERSION = '${version}'`
    );
    
    fs.writeFileSync(swPath, content, 'utf8');
    console.log(`✅ Updated ${path.basename(swPath)} with version ${version}`);
  } else {
    console.warn(`⚠️  File not found: ${swPath}`);
  }
});

// index.html 처리
const indexHtmlPath = path.join(__dirname, '../client/index.html');
if (fs.existsSync(indexHtmlPath)) {
  let content = fs.readFileSync(indexHtmlPath, 'utf8');
  
  // __SW_VERSION__ 플레이스홀더 또는 기존 버전을 새 버전으로 교체
  content = content.replace(
    /const CURRENT_SW_VERSION = ['"](__SW_VERSION__|v[^'"]*)['"]/,
    `const CURRENT_SW_VERSION = '${version}'`
  );
  
  fs.writeFileSync(indexHtmlPath, content, 'utf8');
  console.log(`✅ Updated index.html with version ${version}`);
} else {
  console.warn(`⚠️  File not found: ${indexHtmlPath}`);
}

console.log('✅ Service Worker version injection complete!');
console.log('💡 Tip: The version will be automatically updated on every build');
