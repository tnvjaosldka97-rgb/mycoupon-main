import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";

export default function AuthFinalize() {
  const [, navigate] = useLocation();
  const resolvedRef = useRef(false);
  const [statusText, setStatusText] = useState("로그인 완료 처리 중...");

  const utils = trpc.useUtils();
  const meQuery = trpc.auth.me.useQuery(undefined, {
    staleTime: 0,
    retry: 3,
    retryDelay: 1500,
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next") || "/";

    // Hard timeout: 8s fail-open → navigate to next
    const hardTimeout = setTimeout(() => {
      if (resolvedRef.current) return;
      resolvedRef.current = true;
      console.warn("[AUTH-FINALIZE] hard timeout 8s — navigating fail-open to", next);
      navigate(next);
    }, 8000);

    // Polling: refetch every 1500ms until success
    const interval = setInterval(() => {
      if (resolvedRef.current) return;
      meQuery.refetch();
    }, 1500);

    return () => {
      clearTimeout(hardTimeout);
      clearInterval(interval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On success: save to localStorage, update global cache, navigate
  useEffect(() => {
    if (!meQuery.data) return;
    if (resolvedRef.current) return;
    resolvedRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const next = params.get("next") || "/";

    console.log("[AUTH-FINALIZE] auth.me resolved — user:", (meQuery.data as any)?.role, "navigating to", next);

    // Save to localStorage
    try {
      localStorage.setItem("mycoupon-user-info", JSON.stringify(meQuery.data));
    } catch (_) {}

    // Update global query cache
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
      </div>
    </div>
  );
}
