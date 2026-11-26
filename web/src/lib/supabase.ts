import { createBrowserClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

/**
 * Browser client. The session lives in a first-party cookie (not localStorage)
 * so `proxy.ts` can send signed-out visitors to /login before any app page
 * renders. Only the public publishable key is used here; every read and write
 * is still checked by row level security in the database.
 */
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
