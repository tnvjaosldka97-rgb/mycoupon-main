#!/usr/bin/env node

/**
 * Service Worker 자동 버전 주입 스크립트
 * 
 * 빌드 시 타임스탬프 기반 버전을 생성하여
 * - client/public/sw.js (Service Worker)
 * - client/index.html (메인 HTML)
 * 에 자동으로 주입합니다.
 */

const fs = require('fs');
const path = require('path');

// 타임스탬프 기반 버전 생성 (예: v20241219-234530)
const now = new Date();
const version = `v${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;

console.log(`[inject-version] 생성된 버전: ${version}`);

// 1. Service Worker 파일 경로
const swPath = path.join(__dirname, '../client/public/sw.js');

if (fs.existsSync(swPath)) {
  let swContent = fs.readFileSync(swPath, 'utf-8');
  
  // const CACHE_VERSION = 'v...' 패턴 찾아서 교체
  swContent = swContent.replace(
    /const CACHE_VERSION = ['"]v[^'"]*['"]/,
    `const CACHE_VERSION = '${version}'`
  );
  
  fs.writeFileSync(swPath, swContent, 'utf-8');
  console.log(`[inject-version] Service Worker 버전 주입 완료: ${swPath}`);
} else {
  console.warn(`[inject-version] Service Worker 파일을 찾을 수 없습니다: ${swPath}`);
}

// 2. index.html 파일 경로
const htmlPath = path.join(__dirname, '../client/index.html');

if (fs.existsSync(htmlPath)) {
  let htmlContent = fs.readFileSync(htmlPath, 'utf-8');
  
  // const CURRENT_SW_VERSION = 'v...' 패턴 찾아서 교체
  htmlContent = htmlContent.replace(
    /const CURRENT_SW_VERSION = ['"]v[^'"]*['"]/,
    `const CURRENT_SW_VERSION = '${version}'`
  );
  
  fs.writeFileSync(htmlPath, htmlContent, 'utf-8');
  console.log(`[inject-version] index.html 버전 주입 완료: ${htmlPath}`);
} else {
  console.warn(`[inject-version] index.html 파일을 찾을 수 없습니다: ${htmlPath}`);
}

console.log(`[inject-version] 버전 주입 완료: ${version}`);
