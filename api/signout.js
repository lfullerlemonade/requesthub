const REQUEST_HUB_URL = 'https://requests.lemonadehospitality.com/';
const SHARED_SIGNOUT_URL = 'https://launchcalendar.lemonadehospitality.com/api/signout';

export default function handler(_req, res) {
  res.setHeader('Set-Cookie', 'rh_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
  const destination = new URL(SHARED_SIGNOUT_URL);
  destination.searchParams.set('return_to', REQUEST_HUB_URL);
  res.writeHead(302, { Location: destination.toString() });
  res.end();
}
