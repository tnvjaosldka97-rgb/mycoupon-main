/**
 * Google OAuth 직접 연동 모듈
 * MANUS OAuth를 거치지 않고 Google OAuth를 직접 사용하여 성능 최적화
 */

import { ENV } from "./env";

// Google OAuth 엔드포인트
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

export interface GoogleUserInfo {
  id: string;
  email: string;
  verified_email: boolean;
  name: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  locale?: string;
}

export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
  refresh_token?: string;
  id_token?: string;
}

/**
 * Google OAuth 인증 URL 생성
 */
export function getGoogleAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: ENV.googleClientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    state: state,
    prompt: "select_account", // 항상 계정 선택 화면 표시
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/**
 * Authorization code를 access token으로 교환
 */
export async function exchangeCodeForToken(
  code: string,
  redirectUri: string
): Promise<GoogleTokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: ENV.googleClientId,
      client_secret: ENV.googleClientSecret,
      code: code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("[Google OAuth] Token exchange failed:", error);
    throw new Error(`Token exchange failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Access token으로 사용자 정보 조회
 */
export async function getUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("[Google OAuth] Get user info failed:", error);
    throw new Error(`Get user info failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Google OAuth 전체 플로우 (코드 → 토큰 → 사용자 정보)
 */
export async function authenticateWithGoogle(
  code: string,
  redirectUri: string
): Promise<GoogleUserInfo> {
  const startTime = Date.now();
  
  // 1. 토큰 교환
  const tokenResponse = await exchangeCodeForToken(code, redirectUri);
  const tokenTime = Date.now() - startTime;
  
  // 2. 사용자 정보 조회
  const userInfo = await getUserInfo(tokenResponse.access_token);
  const totalTime = Date.now() - startTime;
  
  console.log(`[Google OAuth] Auth completed in ${totalTime}ms (token: ${tokenTime}ms)`);
  
  return userInfo;
}
