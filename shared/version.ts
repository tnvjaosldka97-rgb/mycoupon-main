// 앱 버전 정보
export const APP_VERSION = '1.0.0';

// 버전 비교 함수
export function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const part1 = parts1[i] || 0;
    const part2 = parts2[i] || 0;

    if (part1 > part2) return 1;
    if (part1 < part2) return -1;
  }

  return 0;
}

// 버전 체크: v1이 v2보다 낮으면 true
export function isVersionLower(v1: string, v2: string): boolean {
  return compareVersions(v1, v2) < 0;
}
