export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  emailUser: process.env.EMAIL_USER ?? "",
  emailPass: process.env.EMAIL_PASS ?? "",
  // Google OAuth
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  // Railway 브릿지 서버
  bridgeSecret: process.env.BRIDGE_SECRET ?? "",
  bridgeServerUrl: process.env.BRIDGE_SERVER_URL ?? "",
  // 마스터 관리자 이메일 (쉼표로 구분)
  masterAdminEmails: (process.env.MASTER_ADMIN_EMAILS || "").split(',').map(e => e.trim()).filter(Boolean),
};
