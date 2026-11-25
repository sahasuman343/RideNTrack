/*
 * Outbound message templates and SMS provider adapters.
 *
 * Pure TypeScript with no Deno or Node APIs, so it runs in the Edge Function
 * and in the Node unit tests. Every template is fixed text with numbered
 * variables because Indian DLT registration approves exact templates: change
 * the wording here only together with a new DLT template id.
 */

export type OutboundTemplate =
  | 'family_ride_started'
  | 'family_reached_stay'
  | 'family_check_in_missed'
  | 'family_crash'
  | 'sos_alert'
  | 'crash_alert'
  | 'check_in_missed';

export interface TemplateSpec {
  /** Ordered variable names, sent as VAR1..VARn to the provider. */
  vars: string[];
  /** Text used for the dry-run provider and for review against the DLT registration. */
  text: string;
  /** Env var holding the DLT template id for this template. */
  dltEnv: string;
  maxVarLength?: number;
}

export const TEMPLATES: Record<OutboundTemplate, TemplateSpec> = {
  family_ride_started: {
    vars: ['rider', 'ride', 'link'],
    text: '{#rider#} has started riding on {#ride#}. Follow live: {#link#} - RideNTrack',
    dltEnv: 'DLT_TEMPLATE_FAMILY_RIDE_STARTED',
  },
  family_reached_stay: {
    vars: ['rider', 'stay', 'link'],
    text: '{#rider#} has reached {#stay#} for the night. Trip: {#link#} - RideNTrack',
    dltEnv: 'DLT_TEMPLATE_FAMILY_REACHED_STAY',
  },
  family_check_in_missed: {
    vars: ['rider', 'minutes', 'link'],
    text: '{#rider#} stopped and has not answered a safety check for {#minutes#} min. Their group has been alerted. Last location: {#link#} - RideNTrack',
    dltEnv: 'DLT_TEMPLATE_FAMILY_CHECK_IN_MISSED',
  },
  family_crash: {
    vars: ['rider', 'link'],
    text: '{#rider#} may have had a fall and did not answer a safety check. Their group has been alerted and is checking. Live location: {#link#} - RideNTrack',
    dltEnv: 'DLT_TEMPLATE_FAMILY_CRASH',
  },
  sos_alert: {
    vars: ['rider', 'ride', 'maps'],
    text: 'EMERGENCY: {#rider#} on {#ride#} needs help. Location: {#maps#} - RideNTrack',
    dltEnv: 'DLT_TEMPLATE_SOS_ALERT',
  },
  crash_alert: {
    vars: ['rider', 'ride', 'maps'],
    text: 'Possible crash: {#rider#} on {#ride#} did not respond to a crash check. Location: {#maps#} Call 112 if you cannot reach them. - RideNTrack',
    dltEnv: 'DLT_TEMPLATE_CRASH_ALERT',
  },
  check_in_missed: {
    vars: ['rider', 'ride', 'maps'],
    text: '{#rider#} on {#ride#} stopped off-route and did not answer a safety check. Location: {#maps#} - RideNTrack',
    dltEnv: 'DLT_TEMPLATE_CHECK_IN_MISSED',
  },
};

export function isOutboundTemplate(t: string): t is OutboundTemplate {
  return Object.prototype.hasOwnProperty.call(TEMPLATES, t);
}

/** DLT variables are capped at 30 characters by most operators. */
export function clipVar(value: unknown, max = 30): string {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

export function templateVars(template: OutboundTemplate, payload: Record<string, unknown>): string[] {
  const spec = TEMPLATES[template];
  return spec.vars.map(v => clipVar(payload[v], v === 'link' || v === 'maps' ? 80 : spec.maxVarLength ?? 30));
}

export function renderTemplate(template: OutboundTemplate, payload: Record<string, unknown>): string {
  const values = templateVars(template, payload);
  let i = 0;
  return TEMPLATES[template].text.replace(/\{#[a-z]+#\}/g, () => values[i++] ?? '');
}

/**
 * Normalises an Indian or international number to E.164. Ten-digit Indian
 * mobiles get +91; anything ambiguous returns null instead of guessing.
 */
export function normalisePhone(raw: string | null | undefined, defaultCountry = '91'): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  const digits = trimmed.replace(/[^0-9]/g, '');
  if (trimmed.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? '+' + digits : null;
  if (digits.startsWith('00')) return normalisePhone('+' + digits.slice(2));
  if (defaultCountry === '91') {
    if (digits.length === 10 && /^[6-9]/.test(digits)) return '+91' + digits;
    if (digits.length === 11 && digits.startsWith('0') && /^[6-9]/.test(digits.slice(1))) return '+91' + digits.slice(1);
    if (digits.length === 12 && digits.startsWith('91') && /^[6-9]/.test(digits.slice(2))) return '+' + digits;
  }
  return null;
}

export interface SendRequest {
  to: string;
  template: OutboundTemplate;
  vars: string[];
  text: string;
  dltTemplateId: string | null;
}

export interface SendResult {
  ok: boolean;
  providerId?: string | null;
  reason?: string;
  /** True when retrying could help (network, 5xx, rate limit). */
  retryable?: boolean;
}

export interface SmsProvider {
  name: string;
  send(req: SendRequest, fetchImpl: typeof fetch): Promise<SendResult>;
}

export interface ProviderEnv {
  SMS_PROVIDER?: string;
  MSG91_AUTH_KEY?: string;
  MSG91_SENDER_ID?: string;
  GUPSHUP_USER_ID?: string;
  GUPSHUP_PASSWORD?: string;
  DLT_PRINCIPAL_ENTITY_ID?: string;
  [key: string]: string | undefined;
}

/** MSG91 Flow API: one DLT template per flow, variables as VAR1..VARn. */
export function msg91Provider(env: ProviderEnv): SmsProvider {
  return {
    name: 'msg91',
    async send(req, fetchImpl) {
      if (!env.MSG91_AUTH_KEY) return { ok: false, reason: 'provider_not_configured' };
      if (!req.dltTemplateId) return { ok: false, reason: 'dlt_template_missing' };
      const recipient: Record<string, string> = { mobiles: req.to.replace(/^\+/, '') };
      req.vars.forEach((v, i) => { recipient[`VAR${i + 1}`] = v; });
      try {
        const res = await fetchImpl('https://control.msg91.com/api/v5/flow', {
          method: 'POST',
          headers: { authkey: env.MSG91_AUTH_KEY, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ template_id: req.dltTemplateId, short_url: '0', recipients: [recipient] }),
        });
        const body = await res.json().catch(() => null) as { type?: string; message?: string; request_id?: string } | null;
        if (res.ok && body?.type !== 'error') return { ok: true, providerId: body?.request_id ?? body?.message ?? null };
        return { ok: false, reason: `msg91_${res.status}_${(body?.message ?? '').slice(0, 60)}`, retryable: res.status >= 500 || res.status === 429 };
      } catch (e) {
        return { ok: false, reason: 'network_error', retryable: true };
      }
    },
  };
}

/** Gupshup enterprise SMS gateway (alternative DLT-capable provider). */
export function gupshupProvider(env: ProviderEnv): SmsProvider {
  return {
    name: 'gupshup',
    async send(req, fetchImpl) {
      if (!env.GUPSHUP_USER_ID || !env.GUPSHUP_PASSWORD) return { ok: false, reason: 'provider_not_configured' };
      if (!req.dltTemplateId) return { ok: false, reason: 'dlt_template_missing' };
      const params = new URLSearchParams({
        method: 'SendMessage',
        send_to: req.to.replace(/^\+/, ''),
        msg: req.text,
        msg_type: 'TEXT',
        userid: env.GUPSHUP_USER_ID,
        password: env.GUPSHUP_PASSWORD,
        auth_scheme: 'plain',
        v: '1.1',
        format: 'text',
        dltTemplateId: req.dltTemplateId,
        ...(env.DLT_PRINCIPAL_ENTITY_ID ? { principalEntityId: env.DLT_PRINCIPAL_ENTITY_ID } : {}),
      });
      try {
        const res = await fetchImpl('https://enterprise.smsgupshup.com/GatewayAPI/rest', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        });
        const text = await res.text();
        if (res.ok && /^success/i.test(text)) return { ok: true, providerId: text.split('|').pop()?.trim() ?? null };
        return { ok: false, reason: `gupshup_${res.status}_${text.slice(0, 60)}`, retryable: res.status >= 500 };
      } catch {
        return { ok: false, reason: 'network_error', retryable: true };
      }
    },
  };
}

/** Records what would be sent without contacting anyone. Default until DLT is approved. */
export function dryRunProvider(): SmsProvider {
  return {
    name: 'dry_run',
    async send() {
      return { ok: false, reason: 'dry_run_not_sent' };
    },
  };
}

export function providerFromEnv(env: ProviderEnv): SmsProvider {
  switch ((env.SMS_PROVIDER || 'dry_run').toLowerCase()) {
    case 'msg91': return msg91Provider(env);
    case 'gupshup': return gupshupProvider(env);
    default: return dryRunProvider();
  }
}

export function buildSendRequest(template: OutboundTemplate, to: string, payload: Record<string, unknown>, env: ProviderEnv): SendRequest {
  return {
    to,
    template,
    vars: templateVars(template, payload),
    text: renderTemplate(template, payload),
    dltTemplateId: env[TEMPLATES[template].dltEnv] || null,
  };
}
