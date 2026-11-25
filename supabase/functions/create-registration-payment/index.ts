// Supabase Edge Function: start a paid ride registration (F16).
// The rider calls it with their own JWT; it records a pending registration and
// returns a Razorpay payment link to open. Setup: docs/features/paid-registrations.md
import { createClient } from 'npm:@supabase/supabase-js@2';
import { paymentLinkRequest } from '../_shared/razorpay.ts';

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const keyId = Deno.env.get('RAZORPAY_KEY_ID');
  const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET');
  if (!keyId || !keySecret) return json({ error: 'Paid registration is not set up yet.' }, 503);

  const url = Deno.env.get('SUPABASE_URL')!;
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { authorization: req.headers.get('authorization') ?? '' } },
    auth: { persistSession: false },
  });
  const { data: who } = await asUser.auth.getUser();
  if (!who.user) return json({ error: 'Sign in again.' }, 401);
  const { ride_id: rideId } = await req.json().catch(() => ({})) as { ride_id?: string };
  if (!rideId) return json({ error: 'Missing ride.' }, 400);

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: flag } = await admin.from('app_flags').select('enabled,rollout_percent').eq('key', 'paid_registrations').maybeSingle();
  if (!flag?.enabled || flag.rollout_percent < 100) return json({ error: 'Paid registration is not available yet.' }, 403);

  const { data: reg, error } = await admin.rpc('begin_ride_registration', { p_ride_id: rideId, p_user_id: who.user.id });
  if (error) return json({ error: error.message }, 400);
  if (reg.status === 'paid') return json({ status: 'paid' });
  if (reg.payment_link_url) return json({ status: 'pending', url: reg.payment_link_url });

  const { data: ride } = await admin.from('rides').select('start_date').eq('id', rideId).single();
  const body = paymentLinkRequest({
    registrationId: reg.id, rideId, rideName: reg.ride_name, amountPaise: reg.amount_paise,
    rideStartIso: ride?.start_date ? `${ride.start_date}T00:00:00+05:30` : null,
    callbackUrl: Deno.env.get('REGISTRATION_CALLBACK_URL') ?? null,
  });
  const res = await fetch('https://api.razorpay.com/v1/payment_links', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}` },
    body: JSON.stringify(body),
  });
  const link = await res.json().catch(() => null) as { id?: string; short_url?: string; error?: { description?: string } } | null;
  if (!res.ok || !link?.id || !link.short_url) {
    return json({ error: link?.error?.description ?? 'Could not start the payment. Try again.' }, 502);
  }
  await admin.rpc('attach_registration_link', { p_registration_id: reg.id, p_link_id: link.id, p_link_url: link.short_url });
  return json({ status: 'pending', url: link.short_url });
});
