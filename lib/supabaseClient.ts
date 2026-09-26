import { createClient } from "@supabase/supabase-js";

// Browser client — used in React components (login, dashboard realtime, scanning page)
// Uses the public anon key; safe to expose, RLS policies protect the data.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Server client — used ONLY inside app/api/* route handlers.
// Uses the service role key which bypasses RLS, needed for bulk upsert on upload.
// Never import this file into a component that runs in the browser.
export function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

// Helper used by every protected-page fetch() call to attach the logged-in
// user's token, so API routes can verify the request via lib/auth.ts.
export async function getAuthHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
