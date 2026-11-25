// Supabase Edge Function: Razorpay webhook → paid ride registrations (F16).
// Razorpay dashboard → Webhooks: this function's URL, events payment_link.paid,
// payment_link.cancelled, payment_link.expired, payment.failed, refund.processed,
// and the secret in RAZORPAY_WEBHOOK_SECRET. Setup: docs/features/paid-registrations.md
import { createClient } from 'npm:@supabase/supabase-js@2';
import { registrationActionFor, verifyRazorpaySignature, webhookEventId, type RazorpayWebhook } from '../_shared/razorpay.ts';

Deno.serve(async req => {
  const secret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET') ?? '';
  const raw = await req.text();
  if (!(await verifyRazorpaySignature(raw, req.headers.get('x-razorpay-signature'), secret))) {
    return new Response('Bad signature', { status: 401 });
  }
  let hook: RazorpayWebhook;
  try { hook = JSON.parse(raw); } catch { return new Response('Bad request', { status: 400 }); }

  const action = registrationActionFor(hook);
  if (action.kind === 'ignore') return new Response(JSON.stringify({ ignored: action.reason }), { headers: { 'content-type': 'application/json' } });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data, error } = await admin.rpc('apply_registration_payment', {
    p_event_id: webhookEventId(req.headers, hook),
    p_registration_id: action.registrationId,
    p_status: action.status,
    p_payment_id: action.paymentId,
    p_amount_paise: action.amountPaise,
  });
  // 5xx makes Razorpay retry, which is right for transient database errors.
  if (error) return new Response(error.message, { status: 500 });
  return new Response(JSON.stringify({ result: data }), { headers: { 'content-type': 'application/json' } });
});
