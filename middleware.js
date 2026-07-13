// Vercel Edge Middleware — server-side guard for the app page.
// Runs BEFORE the /app page is served. If AUTH_SECRET is set and the request
// doesn't carry a valid signed session cookie (issued by verify-email on the
// sign-in page), the visitor is redirected to the sign-in gate at "/".
// If AUTH_SECRET is unset, the gate is off and the page is served normally.

export const config = { matcher: ['/app', '/app.html'] };

export default async function middleware(request) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return; // gate not configured → allow through

  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(/(?:^|;\s*)rh_session=([^;]+)/);
  const token = match ? decodeURIComponent(match[1]) : '';

  if (await isValidToken(token, secret)) return; // valid session → allow

  const url = new URL(request.url);
  url.pathname = '/';
  url.search = '';
  return Response.redirect(url, 307);
}

async function isValidToken(token, secret) {
  if (!token || !token.includes('.')) return false;
  const [b64, sig] = token.split('.');
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const macBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(b64));
    const expected = [...new Uint8Array(macBuf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    if (expected !== sig) return false;
    const payload = b64urlDecode(b64);
    // Token payload is "email|role|exp" (exp is always the LAST segment).
    const parts = payload.split('|');
    const exp = Number(parts[parts.length - 1]);
    if (!exp || exp < Date.now()) return false;
    return true;
  } catch (e) {
    return false;
  }
}

function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return atob(s);
}
