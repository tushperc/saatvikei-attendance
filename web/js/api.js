// Talks to the Apps Script backend. Sends text/plain so the browser skips the CORS preflight.
import { mockCall } from './mock.js';

export class ApiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export const isMock = () => window.APP_CONFIG.API_URL === 'mock';

export async function call(action, body = {}, { timeoutMs = 45000 } = {}) {
  const payload = { ...body, action };
  let data;
  if (isMock()) {
    data = await mockCall(payload);
  } else {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(window.APP_CONFIG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
        redirect: 'follow'
      });
    } catch (err) {
      throw new ApiError('NETWORK', navigator.onLine ? 'Could not reach the server. Check the internet and try again.' : 'No internet connection.');
    } finally {
      clearTimeout(timer);
    }
    try { data = await res.json(); } catch { throw new ApiError('SERVER_ERROR', 'The server sent an unexpected reply.'); }
  }
  // A rejected punch (wrong face, after hours, away from store…) is a normal answer, not an error.
  const isPunchRejection = action === 'kiosk.punch' && 'face_fail_count' in data;
  if (!data.ok && !isPunchRejection) throw new ApiError(data.code || 'ERROR', data.message || 'Something went wrong.');
  return data;
}
