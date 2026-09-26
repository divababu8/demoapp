import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

// Verifies the Bearer token sent from the browser against Supabase Auth.
// API routes use the service-role key (which bypasses Row Level Security
// entirely, since it needs to do bulk upserts) — so this check is the ONLY
// thing standing between an anonymous internet request and the database
// once deployed. Every API route MUST call this first.
export async function verifyUser(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice("Bearer ".length);

  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data, error } = await anonClient.auth.getUser(token);
  if (error || !data.user) return null;

  return data.user;
}
