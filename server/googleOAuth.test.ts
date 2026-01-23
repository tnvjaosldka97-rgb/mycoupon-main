import { describe, it, expect } from "vitest";
import { ENV } from "./_core/env";

describe("Google OAuth Configuration", () => {
  it("should have GOOGLE_CLIENT_ID configured", () => {
    expect(ENV.googleClientId).toBeTruthy();
    expect(ENV.googleClientId).toContain(".apps.googleusercontent.com");
    console.log("[Test] GOOGLE_CLIENT_ID is configured:", ENV.googleClientId.substring(0, 20) + "...");
  });

  it("should have GOOGLE_CLIENT_SECRET configured", () => {
    expect(ENV.googleClientSecret).toBeTruthy();
    expect(ENV.googleClientSecret.length).toBeGreaterThan(10);
    console.log("[Test] GOOGLE_CLIENT_SECRET is configured (length:", ENV.googleClientSecret.length, ")");
  });

  it("should generate valid Google OAuth URL", async () => {
    const { getGoogleAuthUrl } = await import("./_core/googleOAuth");
    
    const redirectUri = "http://localhost:3000/api/oauth/google/callback";
    const state = Buffer.from("/").toString("base64");
    
    const authUrl = getGoogleAuthUrl(redirectUri, state);
    
    expect(authUrl).toContain("https://accounts.google.com/o/oauth2/v2/auth");
    expect(authUrl).toContain("client_id=" + encodeURIComponent(ENV.googleClientId));
    expect(authUrl).toContain("redirect_uri=" + encodeURIComponent(redirectUri));
    expect(authUrl).toContain("response_type=code");
    expect(authUrl).toContain("scope=");
    
    console.log("[Test] Generated Google OAuth URL:", authUrl.substring(0, 100) + "...");
  });
});
