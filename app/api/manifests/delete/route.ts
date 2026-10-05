import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabaseClient";
import { verifyUser } from "@/lib/auth";

// POST /api/manifests/delete
// Body: { manifest_id: string }
// Deletes a manifest and (via ON DELETE CASCADE on bills.manifest_id) all
// its bills. This lets the user re-upload the same file — the manifest_number
// no longer exists, so the upload will be treated as a fresh "created".
export async function POST(req: NextRequest) {
  const user = await verifyUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized — please log in again." }, { status: 401 });
  }

  const db = getServiceClient();

  try {
    const { manifest_id } = await req.json();
    if (!manifest_id) {
      return NextResponse.json({ error: "manifest_id is required" }, { status: 400 });
    }

    // Delete the manifest. The bills.manifest_id FK must have
    // ON DELETE CASCADE (it does in the current schema — verify if unsure).
    // If it doesn't, delete bills first, then the manifest.
    const { error: billsErr } = await db
      .from("bills")
      .delete()
      .eq("manifest_id", manifest_id);
    if (billsErr) throw billsErr;

    const { error: manifestErr } = await db
      .from("manifests")
      .delete()
      .eq("id", manifest_id);
    if (manifestErr) throw manifestErr;

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}