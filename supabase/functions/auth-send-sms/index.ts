// Supabase Edge Function: Auth "Send SMS" hook for phone sign-in codes.
// Supabase Auth calls this instead of its built-in SMS provider whenever a
// rider asks for a sign-in code (or confirms a number added in Profile).
// It checks the Standard Webhooks signature, applies the sign-in code caps
// (public.claim_auth_sms, separate from the SOS budget) and sends through the
// same MSG91 / Gupshup account as server SMS, with its own DLT template.
// Setup and secrets: docs/features/phone-login.md
import { createClient } from 'npm:@supabase/supabase-js@2';
import { Webhook } from 'npm:standardwebhooks@1.0.0';
import { providerFromEnv, type ProviderEnv } from '../_shared/outbound.ts';
import { buildAuthOtpRequest, capReasonResponse, hookOtp, hookRecipient, type SendSmsHookPayload } from '../_shared/authSms.ts';

function reply(error: { http_code: number; message: string } | null) {
  return new Response(JSON.stringify(error ? { error } : {}), {
    status: error ? error.http_code : 200,
    headers: { 'content-type': 'application/json' },
  });
}

Deno.serve(async req => {
  const secret = Deno.env.get('SEND_SMS_HOOK_SECRET');
  if (!secret) return reply(capReasonResponse('disabled'));
  const raw = await req.text();
  let payload: SendSmsHookPayload;
  try {
    payload = new Webhook(secret.replace(/^v1,whsec_/, '')).verify(raw, Object.fromEntries(req.headers)) as SendSmsHookPayload;
  } catch {
    return new Response(JSON.stringify({ error: { http_code: 401, message: 'Invalid signature' } }), { status: 401 });
  }

  const env = Deno.env.toObject() as ProviderEnv;
  if ((env.AUTH_SMS_ENABLED ?? 'false') !== 'true') return reply(capReasonResponse('disabled'));

  const to = hookRecipient(payload);
  const otp = hookOtp(payload);
  if (!to || !otp) return reply(capReasonResponse('invalid_phone'));

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const claim = await admin.rpc('claim_auth_sms', { p_phone: to });
  if (claim.error) {
    console.error('[auth-send-sms] claim failed', claim.error.message);
    return reply(capReasonResponse('send_failed'));
  }
  if (claim.data) {
    console.warn('[auth-send-sms] refused', claim.data);
    return reply(capReasonResponse(String(claim.data)));
  }

  const provider = providerFromEnv(env);
  const result = await provider.send(buildAuthOtpRequest(to, otp, env), fetch);
  if (!result.ok) {
    // Never log the code or the full number.
    console.error('[auth-send-sms] send failed', provider.name, result.reason, to.slice(0, 3) + '…' + to.slice(-2));
    await admin.rpc('release_auth_sms', { p_phone: to });
    return reply(capReasonResponse('send_failed'));
  }
  return reply(null);
});
