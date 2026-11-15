import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler } from './api';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(!!getToken());
  const refresh = useCallback(async () => {
    if (!getToken()) { setMe(null); setLoading(false); return null; }
    try { const m = await api.get('/auth/me'); setMe(m); return m; } catch { setToken(null); setMe(null); return null; } finally { setLoading(false); }
  }, []);
  useEffect(() => { setUnauthorizedHandler(() => { setToken(null); setMe(null); }); refresh(); }, [refresh]);
  const login = async (loginName, password) => { const r = await api.post('/auth/login', { login: loginName, password }); setToken(r.token); return refresh(); };
  const logout = async () => { try { await api.post('/auth/logout'); } catch { /* ignore */ } setToken(null); setMe(null); };
  const can = useCallback((mod, action = 'V') => !!(me && me.modules[mod] && me.modules[mod].actions.includes(action)), [me]);
  const hasRole = useCallback((...codes) => !!(me && codes.some((c) => me.roles.includes(c))), [me]);
  const value = useMemo(() => ({ me, loading, login, logout, refresh, can, hasRole, setMe }), [me, loading, refresh, can, hasRole]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

// ---- toasts
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const id = useRef(0);
  const push = useCallback((message, kind = 'info') => {
    const n = ++id.current; setItems((x) => [...x, { id: n, message, kind }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== n)), kind === 'error' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">{items.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.message}</div>)}</div>
    </ToastCtx.Provider>
  );
}

// ---- entity metadata cache
const metaCache = new Map();
export function loadMeta(entity) {
  if (!metaCache.has(entity)) metaCache.set(entity, api.get(`/e/${entity}/meta`).catch((e) => { metaCache.delete(entity); throw e; }));
  return metaCache.get(entity);
}
export const clearMetaCache = () => metaCache.clear();
export function useMeta(entity) {
  const [meta, setMeta] = useState(null); const [error, setError] = useState(null);
  useEffect(() => { let on = true; setMeta(null); setError(null); loadMeta(entity).then((m) => on && setMeta(m)).catch((e) => on && setError(e)); return () => { on = false; }; }, [entity]);
  return { meta, error };
}
// optional picklist label lookup
export const labelOf = (meta, field, value) => (meta && meta.labels && meta.labels[`${field.options}:${value}`]) || value;

export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const run = useCallback(() => { setState((s) => ({ ...s, loading: true, error: null })); return Promise.resolve().then(fn).then((data) => setState({ loading: false, data, error: null })).catch((error) => setState({ loading: false, data: null, error })); }, deps); // eslint-disable-line
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
}
