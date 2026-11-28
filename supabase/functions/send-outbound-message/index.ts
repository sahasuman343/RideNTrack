// Supabase Edge Function: deliver queued outbound messages (server SMS).
// Invoked by a Database Webhook on INSERT into public.outbound_messages, and
// optionally on a schedule ({"sweep": true}) to retry anything left queued.
// Setup, secrets and DLT registration: docs/features/outbound-sms.md
import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildSendRequest, isOutboundTemplate, providerFromEnv, type ProviderEnv } from '../_shared/outbound.ts';

const MAX_ATTEMPTS = 3;

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface OutboundRow {
  id: string;
  channel: 'sms' | 'whatsapp';
  recipient: string;
  template: string;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
}

Deno.serve(async req => {
  const secret = Deno.env.get('OUTBOUND_WEBHOOK_SECRET');
  if (!secret || !timingSafeEqual(req.headers.get('x-webhook-secret') ?? '', secret)) {
    return new Response('Unauthorized', { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  let rows: OutboundRow[] = [];
  if (body?.sweep) {
    const { data, error } = await admin.from('outbound_messages')
      .select('id,channel,recipient,template,payload,status,attempts')
      .eq('status', 'queued')
      .lt('attempts', MAX_ATTEMPTS)
      .order('created_at', { ascending: true })
      .limit(50);
    if (error) return new Response(error.message, { status: 500 });
    rows = (data ?? []) as OutboundRow[];
  } else if (body?.type === 'INSERT' && body?.table === 'outbound_messages' && body.record?.status === 'queued') {
    rows = [body.record as OutboundRow];
  } else {
    return new Response('Ignored', { status: 202 });
  }

  const env = Deno.env.toObject() as ProviderEnv;
  // Decision 2 is behind SERVER_SMS_ENABLED. Until it is true (DLT approved,
  // provider funded) rows are marked failed so the app falls back to the
  // phone's own SMS composer immediately instead of waiting.
  const enabled = (env.SERVER_SMS_ENABLED ?? 'false') === 'true';
  const provider = providerFromEnv(env);

  const usage = await admin.rpc('outbound_usage_today').maybeSingle();
  if ((usage.data as { over_spend_alert?: boolean } | null)?.over_spend_alert) {
    console.warn('[outbound] daily spend alert threshold reached', usage.data);
  }

  const results: Record<string, string> = {};
  for (const row of rows) {
    // Claim the row so a webhook and a sweep never send the same message twice.
    const claim = await admin.from('outbound_messages').update({ status: 'sending', updated_at: new Date().toISOString() })
      .eq('id', row.id).eq('status', 'queued').select('id');
    if (!claim.data?.length) { results[row.id] = 'skipped'; continue; }

    if (!enabled) {
      await admin.rpc('mark_outbound_message', { p_id: row.id, p_status: 'failed', p_provider: provider.name, p_provider_id: null, p_reason: 'server_sms_disabled' });
      results[row.id] = 'disabled';
      continue;
    }
    if (row.channel !== 'sms' || !isOutboundTemplate(row.template)) {
      await admin.rpc('mark_outbound_message', { p_id: row.id, p_status: 'failed', p_provider: provider.name, p_provider_id: null, p_reason: 'channel_or_template_unsupported' });
      results[row.id] = 'unsupported';
      continue;
    }
    const request = buildSendRequest(row.template, row.recipient, row.payload ?? {}, env);
    const sent = await provider.send(request, fetch);
    const retry = !sent.ok && sent.retryable && row.attempts + 1 < MAX_ATTEMPTS;
    await admin.rpc('mark_outbound_message', {
      p_id: row.id,
      p_status: sent.ok ? 'sent' : retry ? 'queued' : 'failed',
      p_provider: provider.name,
      p_provider_id: sent.providerId ?? null,
      p_reason: sent.ok ? null : sent.reason ?? 'unknown',
    });
    results[row.id] = sent.ok ? 'sent' : retry ? 'retry' : 'failed';
  }

  return new Response(JSON.stringify({ processed: rows.length, results }), { headers: { 'content-type': 'application/json' } });
});
