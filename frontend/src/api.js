// Thin fetch wrapper: JWT from localStorage, JSON in/out, structured errors.
const KEY = 'crm_token';
export const getToken = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const setToken = (t) => { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch { /* private mode */ } };

export class ApiError extends Error {
  constructor(status, data) { super((data && data.error) || `Request failed (${status})`); this.status = status; this.data = data || {}; }
}
let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

async function request(method, path, body, opts = {}) {
  const headers = {};
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(`/api${path}`, { method, headers, body: payload });
  if (opts.raw) return res;
  const isJson = (res.headers.get('content-type') || '').includes('json');
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/login')) onUnauthorized();
    throw new ApiError(res.status, isJson ? data : { error: String(data).slice(0, 200) });
  }
  return data;
}
export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b ?? {}),
  put: (p, b) => request('PUT', p, b ?? {}),
  del: (p, b) => request('DELETE', p, b ?? {}),
  raw: (p) => request('GET', p, undefined, { raw: true }),
  upload: (p, form) => request('POST', p, form),
};
// Open an authenticated binary/CSV resource in a new tab or download it
export async function openAuthed(path, filename) {
  const res = await api.raw(path);
  if (!res.ok) throw new ApiError(res.status, { error: 'Download failed' });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  if (filename) { const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); } else window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
