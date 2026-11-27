// Supabase Edge Function: join the website waitlist.
// The web form sends the email, an optional name and a Cloudflare Turnstile
// token. The function checks the token, then calls join_waitlist (service role,
// rate limited per network) and emails a confirmation link through Resend.
// A place counts toward the launch offer only once the link is opened.
// Setup and secrets: docs/features/waitlist.md
import { createClient } from 'npm:@supabase/supabase-js@2';
import { clientIp, confirmationEmail, EMAIL_SHAPE, ipHash, RESEND_URL, verifyTurnstile } from '../_shared/waitlist.ts';

const OFFER = { places: 10, months: 3 };

function corsFor(req: Request) {
  const allowed = (Deno.env.get('WAITLIST_ALLOWED_ORIGINS') ?? 'https://ridentrack.app,https://www.ridentrack.app')
    .split(',').map(s => s.trim()).filter(Boolean);
  const origin = req.headers.get('origin') ?? '';
  return {
    'access-control-allow-origin': allowed.includes(origin) ? origin : allowed[0] ?? '',
    'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS',
    vary: 'origin',
  };
}

Deno.serve(async req => {
  const cors = corsFor(req);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const turnstileSecret = Deno.env.get('TURNSTILE_SECRET_KEY');
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('WAITLIST_FROM_EMAIL');
  // Fail closed: without the CAPTCHA and the email sender, nobody can join.
  if (!turnstileSecret || !resendKey || !from) return json({ error: 'The waitlist isn’t open yet. Try again soon.' }, 503);

  const body = await req.json().catch(() => null) as { email?: unknown; name?: unknown; turnstile_token?: unknown } | null;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 80) : '';
  const token = typeof body?.turnstile_token === 'string' ? body.turnstile_token : '';
  if (!EMAIL_SHAPE.test(email) || email.length > 254) return json({ error: 'Enter a valid email address.' }, 400);

  const ip = clientIp(req.headers);
  if (!(await verifyTurnstile(token, turnstileSecret, ip, fetch))) {
    return json({ error: 'The check that you’re not a bot didn’t pass. Try again.' }, 403);
  }

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await admin.rpc('join_waitlist', {
    p_email: email,
    p_name: name || null,
    p_ip_hash: await ipHash(ip, Deno.env.get('WAITLIST_IP_SALT') ?? serviceKey),
  });
  if (error) {
    if (error.code === '53400') return json({ error: 'Too many tries. Wait a while and try again.' }, 429);
    if (error.code === '22023') return json({ error: error.message.endsWith('.') ? error.message : error.message + '.' }, 400);
    return json({ error: 'Couldn’t join the waitlist just now. Try again in a moment.' }, 500);
  }

  const confirmToken = (data as { token?: string | null } | null)?.token;
  if (confirmToken) {
    const site = Deno.env.get('WAITLIST_SITE_URL') ?? 'https://ridentrack.app';
    const { link: _link, ...message } = confirmationEmail({ to: email, from, siteUrl: site, token: confirmToken, ...OFFER });
    const sent = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${resendKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(message),
    }).catch(() => null);
    if (!sent?.ok) return json({ error: 'Couldn’t send the confirmation email. Try again in a few minutes.' }, 502);
  }
  // Same answer whether the email was new, waiting or already confirmed, so the
  // form never reveals who is on the list.
  return json({ status: 'check_email' });
});
