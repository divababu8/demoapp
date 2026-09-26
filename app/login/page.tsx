"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/dashboard");
  }

  return (
    <div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center" }}>
      <form onSubmit={handleLogin} style={{ width: 320, padding: 24, border: "1px solid #ddd", borderRadius: 8 }}>
        <h2 style={{ marginBottom: 16 }}>Manifest Dashboard Login</h2>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={{ width: "100%", padding: 8, marginBottom: 10 }}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={{ width: "100%", padding: 8, marginBottom: 10 }}
        />
        {error && <p style={{ color: "red", fontSize: 13 }}>{error}</p>}
        <button type="submit" disabled={loading} style={{ width: "100%", padding: 10 }}>
          {loading ? "Logging in..." : "Login"}
        </button>
      </form>
    </div>
  );
}
