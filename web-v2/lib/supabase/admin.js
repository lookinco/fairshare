// Service-role client — BYPASSES RLS. Server-side ONLY. Never import this into
// a client component or anything that ships to the browser. Used for migrations,
// admin scripts, and trusted server tasks (e.g. writing activity_log as system).
import { createClient } from '@supabase/supabase-js';

export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing (server-only env)');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
