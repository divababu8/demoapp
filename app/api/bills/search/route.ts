import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabaseClient";
import { verifyUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const user = await verifyUser(req);
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized — please log in again." },
      { status: 401 }
    );
  }

  const db = getServiceClient();

  try {
    const { awb_number } = await req.json();
    if (!awb_number) {
      return NextResponse.json({ error: "awb_number is required" }, { status: 400 });
    }

    const raw = String(awb_number).trim();

    const { data, error } = await db.rpc("scan_bill", {
      p_awb: raw,
      p_user_id: user.id,
    });

    if (error) throw error;

    if (!data?.found) {
      // Use the real scanned value in the message, but never claim we
      // matched something we didn't.
      return NextResponse.json(
        {
          found: false,
          scannedRaw: raw,
          message: `Tracking number ${raw} not found in any uploaded manifest.`,
        },
        { status: 404 }
      );
    }

    // scan_bill() already returns the full bill + real searchCount +
    // matchedAwb. Just hand it back to the client untouched.
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}