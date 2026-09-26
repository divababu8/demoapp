import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabaseClient";
import { verifyUser } from "@/lib/auth";

// POST /api/bills/search
// Body: { awb_number: string }
// Called every time the Enter key fires on the Scanning page input.
// - Always logs a "search" event (this is the attempt/search counter).
// - If this is the bill's FIRST successful match, also logs a "scan" event
//   and flips scan_status to "scanned". Repeat lookups of an already-scanned
//   bill only add to the search count, they do not re-fire scan logic.
export async function POST(req: NextRequest) {
  // Same reasoning as /api/upload — service-role key bypasses RLS, so this
  // route must verify the caller is logged in before touching the database.
  const user = await verifyUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized — please log in again." }, { status: 401 });
  }

  const db = getServiceClient();

  try {
    const { awb_number } = await req.json();
    if (!awb_number) {
      return NextResponse.json({ error: "awb_number is required" }, { status: 400 });
    }

    // Single atomic RPC call instead of 4 sequential queries — see
    // scan_bill() in database/schema.sql. This is both faster (1 round-trip
    // instead of up to 4) and race-safe when two scanners hit the same
    // AWB at nearly the same instant.
    const { data, error } = await db.rpc("scan_bill", {
      p_awb: String(awb_number).trim(),
      p_user_id: user.id,
    });

    if (error) throw error;

    if (!data.found) {
      return NextResponse.json(
        { found: false, message: `AWB ${awb_number} not found in any uploaded manifest.` },
        { status: 404 }
      );
    }

    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
