"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function IndexPage() {
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      router.push(data.session ? "/dashboard" : "/login");
    });
  }, [router]);

  return null;
}
