import { createClient } from 'npm:@supabase/supabase-js@2';

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async request => {
  const secret = Deno.env.get('LOCATION_PURGE_SECRET');
  if (!secret || !timingSafeEqual(request.headers.get('x-schedule-secret') ?? '', secret)) {
    return new Response('Unauthorized', { status: 401 });
  }
  const days = Number(Deno.env.get('LOCATION_RETENTION_DAYS') ?? '7');
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const { data, error } = await admin.rpc('purge_old_location_history', { p_retention_days: days });
  if (error) return new Response(error.message, { status: 500 });
  return Response.json({ deleted: data, retention_days: days });
});
