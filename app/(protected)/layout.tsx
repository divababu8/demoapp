"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

// Wraps Dashboard, Shipments, Overages, Upload, Scanning.
// No valid session -> immediately redirected to /login, page content never renders.
// Also listens for logout/session-expiry mid-session and redirects then too.
export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [sessionChecked, setSessionChecked] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace("/login");
      } else {
        setSessionChecked(true);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace("/login");
    });

    return () => listener.subscription.unsubscribe();
  }, [router]);

  // Render nothing until the session check completes — prevents any
  // protected content from flashing on screen before the redirect fires.
  if (!sessionChecked) return null;

  return <>{children}</>;
}
