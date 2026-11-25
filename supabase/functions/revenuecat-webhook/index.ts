// Supabase Edge Function: RevenueCat webhook → subscription tier and trip passes.
// Configure in RevenueCat: Integrations → Webhooks, URL of this function, and an
// Authorization header equal to the REVENUECAT_WEBHOOK_AUTH secret.
// Setup: docs/features/store-billing.md
import { createClient } from 'npm:@supabase/supabase-js@2';
import { billingActionFor, type RevenueCatEvent } from '../_shared/billing.ts';

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async req => {
  const secret = Deno.env.get('REVENUECAT_WEBHOOK_AUTH');
  if (!secret || !timingSafeEqual(req.headers.get('authorization') ?? '', secret)) {
    return new Response('Unauthorized', { status: 401 });
  }
  const body = await req.json().catch(() => null) as { event?: RevenueCatEvent } | null;
  const event = body?.event;
  if (!event?.id || !event.type) return new Response('Bad request', { status: 400 });
  // Sandbox purchases never change production entitlements unless explicitly allowed.
  if (event.environment === 'SANDBOX' && Deno.env.get('BILLING_ACCEPT_SANDBOX') !== 'true') {
    return new Response('Sandbox ignored', { status: 200 });
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const action = billingActionFor(event);
  let result;
  switch (action.kind) {
    case 'set_tier':
      result = await admin.rpc('apply_billing_tier', {
        p_event_id: event.id, p_event_type: event.type, p_user_id: action.userId, p_tier: action.tier, p_expires_at: action.expiresAt,
      });
      break;
    case 'grant_pass':
      result = await admin.rpc('apply_billing_pass', {
        p_event_id: event.id, p_event_type: event.type, p_user_id: action.userId, p_ride_id: action.rideId, p_transaction_id: action.transactionId, p_grant: true,
      });
      break;
    case 'revoke_pass':
      result = await admin.rpc('apply_billing_pass', {
        p_event_id: event.id, p_event_type: event.type, p_user_id: action.userId, p_ride_id: null, p_transaction_id: action.transactionId, p_grant: false,
      });
      break;
    default:
      return new Response(JSON.stringify({ ignored: action.reason }), { headers: { 'content-type': 'application/json' } });
  }
  // A 5xx makes RevenueCat retry, which is what we want for transient failures.
  if (result.error) return new Response(result.error.message, { status: 500 });
  return new Response(JSON.stringify({ applied: action.kind, fresh: result.data }), { headers: { 'content-type': 'application/json' } });
});
