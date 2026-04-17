import { useState, useEffect, useRef, useContext } from 'react';
import { useLocation } from 'wouter';
import { trpc } from '@/lib/trpc';
import { AuthTransitionContext } from '@/contexts/AuthTransitionContext';

const MAX_EVENTS = 6;

function shouldShowOverlay(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (new URLSearchParams(window.location.search).get('debugAuth') === '1') return true;
  } catch (_) { /* ignore */ }
  try {
    if (localStorage.getItem('debug_auth_overlay') === '1') return true;
  } catch (_) { /* ignore */ }
  return false;
}

export function AuthDebugOverlay() {
  const [visible, setVisible] = useState<boolean>(() => shouldShowOverlay());
  const [pathname] = useLocation();
  const authStabilizing = useContext(AuthTransitionContext);
  const utils = trpc.useUtils();

  const [tick, setTick] = useState(0);
  const [pageshowCount, setPageshowCount] = useState(0);
  const [lastPersisted, setLastPersisted] = useState<boolean | null>(null);
  const [events, setEvents] = useState<string[]>([]);

  useEffect(() => { setVisible(shouldShowOverlay()); }, [pathname]);

  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => setTick(t => (t + 1) % 1_000_000), 500);
    return () => clearInterval(id);
  }, [visible]);

  const pushEvent = (msg: string) => {
    const ts = new Date().toISOString().slice(11, 19);
    setEvents(prev => {
      const next = [...prev, `${ts} ${msg}`];
      if (next.length > MAX_EVENTS) next.shift();
      return next;
    });
  };

  let cachedUser: { id?: string | number; role?: string } | null | undefined;
  try { cachedUser = utils.auth.me.getData() as any; } catch { cachedUser = undefined; }
  const userStr =
    cachedUser === undefined ? 'pending'
    : cachedUser === null ? 'null'
    : `${cachedUser.id}:${cachedUser.role}`;

  const mountedRef = useRef(false);
  useEffect(() => {
    if (!visible || mountedRef.current) return;
    mountedRef.current = true;
    pushEvent('mounted');
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const handler = (e: PageTransitionEvent) => {
      setPageshowCount(c => c + 1);
      setLastPersisted(e.persisted);
      pushEvent(`pageshow persisted=${e.persisted ? 'T' : 'F'}`);
    };
    window.addEventListener('pageshow', handler);
    return () => window.removeEventListener('pageshow', handler);
  }, [visible]);

  const prevUserRef = useRef<string | null>(null);
  useEffect(() => {
    if (!visible) return;
    if (prevUserRef.current === null) {
      prevUserRef.current = userStr;
      pushEvent(`auth.init=${userStr}`);
      return;
    }
    if (prevUserRef.current !== userStr) {
      pushEvent(`auth:${prevUserRef.current}→${userStr}`);
      prevUserRef.current = userStr;
    }
  }, [userStr, visible]);

  const prevPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (!visible) return;
    if (prevPathRef.current === null) { prevPathRef.current = pathname; return; }
    if (prevPathRef.current !== pathname) {
      pushEvent(`route→${pathname}`);
      prevPathRef.current = pathname;
    }
  }, [pathname, visible]);

  const oauthSeenRef = useRef(false);
  useEffect(() => {
    if (!visible) return;
    try {
      const p = new URLSearchParams(window.location.search);
      const has = p.has('code') || p.has('state') || p.has('auth_callback');
      if (has && !oauthSeenRef.current) {
        oauthSeenRef.current = true;
        pushEvent('oauth:callback detected');
      } else if (!has && oauthSeenRef.current) {
        oauthSeenRef.current = false;
      }
    } catch (_) { /* ignore */ }
  }, [pathname, tick, visible]);

  const prevGuardRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (!visible) return;
    const until = (window as unknown as { __mc_oauth_guard_until?: number }).__mc_oauth_guard_until ?? 0;
    const active = until > Date.now();
    if (prevGuardRef.current === null) { prevGuardRef.current = active; return; }
    if (active !== prevGuardRef.current) {
      pushEvent(active ? 'guard:start' : 'guard:expire');
      prevGuardRef.current = active;
    }
  }, [tick, visible]);

  if (!visible) return null;

  let searchStr = '';
  let params: URLSearchParams;
  try {
    searchStr = window.location.search;
    params = new URLSearchParams(searchStr);
  } catch (_) {
    params = new URLSearchParams();
  }
  const hasCode = params.has('code');
  const hasState = params.has('state');
  const hasAuthCallback = params.has('auth_callback');
  const isFinalize = pathname === '/auth/finalize';
  const nextParam = params.get('next') || '';
  const guardUntil = ((window as unknown as { __mc_oauth_guard_until?: number }).__mc_oauth_guard_until ?? 0) as number;
  const now = Date.now();
  const guardActive = guardUntil > now;
  const guardRemaining = Math.max(0, guardUntil - now);
  const rootChildren = document.getElementById('root')?.children.length ?? 0;

  const Row = ({ k, v }: { k: string; v: string | number | boolean }) => (
    <div style={{ display: 'flex', gap: 4 }}>
      <span style={{ color: '#6cf', minWidth: 62 }}>{k}</span>
      <span style={{ color: '#bfb', wordBreak: 'break-all' }}>{String(v)}</span>
    </div>
  );
  const Sep = () => <div style={{ borderTop: '1px dashed #555', margin: '3px 0' }} />;

  return (
    <div
      style={{
        position: 'fixed', right: 8, bottom: 8, zIndex: 2147483647,
        background: 'rgba(0,0,0,0.82)', color: '#cfc',
        fontFamily: 'ui-monospace, Consolas, monospace',
        fontSize: 10, lineHeight: 1.35,
        padding: '6px 8px', borderRadius: 4,
        maxWidth: 300, maxHeight: '55vh', overflow: 'hidden',
        pointerEvents: 'none', userSelect: 'none',
        boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
      }}
      data-auth-debug-overlay="1"
    >
      <div style={{ color: '#ff0', fontWeight: 700 }}>auth-debug · t={tick}</div>
      <Sep />
      <Row k="path" v={pathname} />
      <Row k="search" v={searchStr.slice(0, 40) || '(none)'} />
      <Sep />
      <Row k="user" v={userStr} />
      <Sep />
      <Row k="code" v={hasCode} />
      <Row k="state" v={hasState} />
      <Row k="auth_cb" v={hasAuthCallback} />
      <Sep />
      <Row k="g.until" v={guardUntil || 0} />
      <Row k="g.active" v={guardActive} />
      <Row k="g.rem_ms" v={guardRemaining} />
      <Sep />
      <Row k="finalize" v={isFinalize} />
      <Row k="next" v={nextParam || '(none)'} />
      <Sep />
      <Row k="pgshow.n" v={pageshowCount} />
      <Row k="pgshow.last" v={lastPersisted === null ? '(none)' : String(lastPersisted)} />
      <Sep />
      <Row k="#root.kids" v={rootChildren} />
      <Row k="authStab" v={authStabilizing} />
      <div style={{ borderTop: '1px solid #555', margin: '4px 0 2px', color: '#ff0' }}>events</div>
      {events.length === 0
        ? <div style={{ fontSize: 9, color: '#888' }}>(none)</div>
        : events.slice().reverse().map((e, i) => (
            <div key={i} style={{ fontSize: 9, color: i === 0 ? '#fff' : '#aaa' }}>{e}</div>
          ))
      }
    </div>
  );
}
