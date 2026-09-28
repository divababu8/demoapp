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
    <div className="login-shell" style={{
      background: 'linear-gradient(135deg, #e0e7ff 0%, #f8fafc 100%)', // Soft indigo to slate
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      padding: '20px'
    }}>
      <form 
        onSubmit={handleLogin} 
        className="login-card" 
        style={{
          width: '100%',
          maxWidth: '420px', // Slightly wider for a more premium feel
          background: 'rgba(255, 255, 255, 0.85)', // Glassmorphism
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid rgba(255, 255, 255, 0.5)',
          borderRadius: '24px',
          padding: '40px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.02)',
          position: 'relative',
          overflow: 'hidden'
        }}
      >
        {/* Subtle top accent bar */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '6px',
          background: 'linear-gradient(90deg, #6366f1, #14b8a6, #ec4899)'
        }} />

        {/* Logo Mark */}
        <div className="login-mark" style={{
          width: '48px',
          height: '48px',
          borderRadius: '14px',
          background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
          display: 'grid',
          placeItems: 'center',
          color: '#fff',
          fontWeight: 700,
          fontSize: '1.1rem',
          marginBottom: '24px',
          boxShadow: '0 8px 16px rgba(99, 102, 241, 0.3)'
        }}>
          MF
        </div>

        <h2 className="login-brand" style={{
          fontSize: '1.6rem',
          fontWeight: 700,
          color: 'var(--ink)',
          marginBottom: '8px',
          letterSpacing: '-0.02em'
        }}>
          Manifest Scanning Desk
        </h2>
        <p className="login-sub" style={{
          color: 'var(--ink-muted)',
          fontSize: '0.95rem',
          marginBottom: '32px'
        }}>
          Sign in to view manifests and record scans.
        </p>

        <div className="field" style={{ marginBottom: '20px' }}>
          <label style={{ 
            display: 'block', 
            fontSize: '0.8rem', 
            fontWeight: 600, 
            color: 'var(--ink-muted)', 
            marginBottom: '8px',
            textTransform: 'uppercase',
            letterSpacing: '0.05em'
          }}>
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="you@company.com"
            style={{
              width: '100%',
              height: '48px',
              padding: '0 16px',
              border: '1px solid var(--border)',
              borderRadius: '12px',
              fontSize: '0.95rem',
              background: '#fff',
              color: 'var(--ink)',
              transition: 'border-color 0.2s, box-shadow 0.2s'
            }}
          />
        </div>

        <div className="field" style={{ marginBottom: '24px' }}>
          <label style={{ 
            display: 'block', 
            fontSize: '0.8rem', 
            fontWeight: 600, 
            color: 'var(--ink-muted)', 
            marginBottom: '8px',
            textTransform: 'uppercase',
            letterSpacing: '0.05em'
          }}>
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder="••••••••"
            style={{
              width: '100%',
              height: '48px',
              padding: '0 16px',
              border: '1px solid var(--border)',
              borderRadius: '12px',
              fontSize: '0.95rem',
              background: '#fff',
              color: 'var(--ink)',
              transition: 'border-color 0.2s, box-shadow 0.2s'
            }}
          />
        </div>

        {error && (
          <p className="login-error" style={{
            color: 'var(--danger)',
            fontSize: '0.85rem',
            marginBottom: '16px',
            padding: '10px 14px',
            background: 'var(--danger-soft)',
            borderRadius: '8px',
            border: '1px solid rgba(239, 68, 68, 0.2)'
          }}>
            {error}
          </p>
        )}

        <button 
          type="submit" 
          disabled={loading} 
          className="btn btn-primary"
          style={{
            width: '100%',
            height: '48px',
            background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
            color: '#fff',
            border: 'none',
            borderRadius: '12px',
            fontSize: '1rem',
            fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
            transition: 'transform 0.2s, box-shadow 0.2s',
            boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)',
            opacity: loading ? 0.7 : 1
          }}
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}