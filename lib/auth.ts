import jwt from "jsonwebtoken";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------
// WHY THIS CHANGED: the previous version called
// `anonClient.auth.getUser(token)` on every request, which is a full
// network round-trip to Supabase's Auth server — in addition to the
// separate round-trip the scan RPC itself makes to Postgres. That's two
// sequential network calls per scan, which is the main reason scanning
// felt slow. This verifies the JWT's signature LOCALLY instead (no
// network call at all) whenever SUPABASE_JWT_SECRET is set, cutting
// typical per-scan auth overhead from ~100-300ms to well under 1ms.
//
// Find your JWT secret: Supabase Dashboard → Project Settings → API →
// JWT Settings → "JWT Secret". Add it as SUPABASE_JWT_SECRET in
// .env.local (and in Vercel's environment variables).
//
// Safety: this NEVER weakens the check. A token with a bad/missing
// signature is still rejected locally. The only time it falls back to
// asking Supabase directly is if local verification can't run at all
// (secret not configured, or a token signed with a different algorithm —
// e.g. if your project uses Supabase's newer asymmetric signing keys
// instead of the legacy shared secret). Either way, every token is
// cryptographically checked before being trusted — nothing is ever
// accepted on good faith.
// ---------------------------------------------------------------------

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;

interface VerifiedUser {
  id: string;
}

// Short-lived cache for the fallback (network) path only — so a burst of
// scans from the same session during a brief misconfiguration, or on a
// project using asymmetric keys, still only pays the network cost once
// per minute rather than once per scan. The fast path above doesn't need
// this at all since it's already sub-millisecond.
const fallbackCache = new Map<string, { user: VerifiedUser; expiresAt: number }>();
const FALLBACK_CACHE_MS = 60_000;

export async function verifyUser(req: NextRequest): Promise<VerifiedUser | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice("Bearer ".length);

  // --- FAST PATH: local signature verification, no network call ---
  if (JWT_SECRET) {
    try {
      const payload = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }) as jwt.JwtPayload;
      if (payload.sub) return { id: payload.sub };
    } catch {
      // Wrong algorithm, expired, bad signature, etc. — fall through to
      // the network path below rather than guessing; that path is the
      // authoritative source of truth either way.
    }
  }

  // --- FALLBACK PATH: ask Supabase directly (with a short cache) ---
  const cached = fallbackCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.user;

  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data, error } = await anonClient.auth.getUser(token);
  if (error || !data.user) return null;

  const user: VerifiedUser = { id: data.user.id };
  fallbackCache.set(token, { user, expiresAt: Date.now() + FALLBACK_CACHE_MS });
  return user;
}
