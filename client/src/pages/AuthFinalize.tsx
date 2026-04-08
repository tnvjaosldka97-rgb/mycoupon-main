import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";

// Railway cold start 대응: 최대 25초 대기
// 기존 8s → Railway 재시작/cold start(10~20s) 보다 짧아서 실패
const HARD_TIMEOUT_MS = 25_000;
const POLL_INTERVAL_MS = 2_000;

export default function AuthFinalize() {
  const [, navigate] = useLocation();
  const resolvedRef = useRef(false);
  const [statusText, setStatusText] = useState("로그인 완료 처리 중...");
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());

  const utils = trpc.useUtils();
  const meQuery = trpc.auth.me.useQuery(undefined, {
    staleTime: 0,
    // retry는 refetch() 에 영향 없음 — 폴링 루프로 직접 제어
    retry: false,
    enabled: true,
  });

  // 경과 시간 카운터 (UX)
  useEffect(() => {
    const id = setInterval(() => {
      const sec = Math.round((Date.now() - startRef.current) / 1000);
      setElapsed(sec);
      if (sec > 5) setStatusText(`서버 연결 중... (${sec}초)`);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // 핵심 폴링 루프
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const next = decodeURIComponent(params.get("next") || "/");

    console.log("[AUTH-FINALIZE] mounted — next:", next, "| timeout:", HARD_TIMEOUT_MS + "ms");

    const doResolve = (userData: unknown, reason: string) => {
      if (resolvedRef.current) return;
      resolvedRef.current = true;
      const elapsed = Math.round((Date.now() - startRef.current) / 1000);
      console.log(`[AUTH-FINALIZE] resolve — reason:${reason} elapsed:${elapsed}s user:${userData ? 'OK' : 'null'}`);
      if (userData) {
        try { localStorage.setItem("mycoupon-user-info", JSON.stringify(userData)); } catch (_) {}
        utils.auth.me.setData(undefined, userData as any);
        setStatusText("로그인 완료!");
      }
      navigate(next);
    };

    // Hard timeout: 25s — cold start 완료 후 한 번 더 시도
    const hardTimeout = setTimeout(async () => {
      if (resolvedRef.current) return;
      console.warn("[AUTH-FINALIZE] hard timeout 25s — last-chance refetch before fail-open");
      setStatusText("마지막 확인 중...");
      try {
        const result = await meQuery.refetch();
        if (result.data) { doResolve(result.data, "last-chance-success"); return; }
      } catch (_) {}
      doResolve(null, "timeout-fail-open");
    }, HARD_TIMEOUT_MS);

    // 폴링: 2초마다 auth.me 재시도
    let pollCount = 0;
    const interval = setInterval(async () => {
      if (resolvedRef.current) { clearInterval(interval); return; }
      pollCount++;
      const elapsed = Math.round((Date.now() - startRef.current) / 1000);
      console.log(`[AUTH-FINALIZE] poll #${pollCount} at ${elapsed}s`);
      try {
        const result = await meQuery.refetch();
        if (result.data) {
          clearInterval(interval);
          clearTimeout(hardTimeout);
          doResolve(result.data, `poll-${pollCount}`);
        } else {
          console.log(`[AUTH-FINALIZE] poll #${pollCount} → null (서버 미세션 or cold start 중)`);
        }
      } catch (err: any) {
        // AbortError = auth.me 12s abort → cold start 아직 진행 중 → 계속 폴링
        console.warn(`[AUTH-FINALIZE] poll #${pollCount} error — ${err?.name}: ${err?.message?.slice(0, 60)}`);
      }
    }, POLL_INTERVAL_MS);

    return () => {
      clearTimeout(hardTimeout);
      clearInterval(interval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // meQuery 즉시 응답 감지 (첫 로드 시 캐시에 이미 있을 경우)
  useEffect(() => {
    if (!meQuery.data) return;
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const next = decodeURIComponent(params.get("next") || "/");
    console.log("[AUTH-FINALIZE] immediate data — navigating to", next);
    try { localStorage.setItem("mycoupon-user-info", JSON.stringify(meQuery.data)); } catch (_) {}
    utils.auth.me.setData(undefined, meQuery.data);
    setStatusText("로그인 완료!");
    navigate(next);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meQuery.data]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 via-pink-50 to-purple-50">
      <div className="flex flex-col items-center gap-4">
        <div className="w-16 h-16 border-4 border-orange-300 border-t-orange-600 rounded-full animate-spin" />
        <p className="text-gray-700 text-base font-semibold">{statusText}</p>
        {elapsed >= 8 && (
          <p className="text-gray-400 text-sm">잠시만 기다려주세요...</p>
        )}
      </div>
    </div>
  );
}
