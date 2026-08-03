export const config = { matcher: ['/app', '/app.html'] };

function b64urlDecode(value) {
  value = value.replace(/-/g, '+').replace(/_/g, '/');
  while (value.length % 4) value += '=';
  return atob(value);
}

async function validLegacy(token, secret) {
  if (!token || !secret || !token.includes('.')) return false;
  const parts = token.split('.');
  try {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(parts[0]));
    const expected = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('');
    const payload = b64urlDecode(parts[0]).split('|');
    return expected === parts[1] && Number(payload[payload.length - 1]) > Date.now();
  } catch (error) { return false; }
}

export default async function middleware(request) {
  const cookie = request.headers.get('cookie') || '';
  const legacy = /(?:^|;\s*)rh_session=([^;]+)/.exec(cookie);
  if (legacy && await validLegacy(decodeURIComponent(legacy[1]), process.env.AUTH_SECRET)) return;

  if (/(?:^|;\s*)lh_shared_session=/.test(cookie)) {
    try {
      const response = await fetch('https://launchcalendar.lemonadehospitality.com/api/auth/session', { headers: { cookie } });
      const session = await response.json();
      if (response.ok && session.authenticated && session.permissions && session.permissions.role) return;
    } catch (error) { /* redirect to the shared gate */ }
  }

  const url = new URL(request.url); url.pathname = '/'; url.search = '';
  return Response.redirect(url, 307);
}
