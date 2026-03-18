'use client';

import { login, signup } from '@/lib/auth';
import React, { useState } from 'react';

export function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const uname = username.trim();
      const result = mode === 'signup' ? await signup(uname, password) : await login(uname, password);
      if (result.ok) {
        onSuccess();
      } else {
        setError(result.error || 'Login failed');
      }
    } catch (_) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)',
        padding: 24,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 360,
          padding: 32,
          border: '1px solid var(--border)',
          borderRadius: 12,
          background: 'var(--panel)',
        }}
      >
        <h1
          style={{
            margin: '0 0 8px',
            fontSize: 20,
            fontWeight: 700,
            color: 'var(--text)',
          }}
        >
          Atoms Demo
        </h1>
        <p style={{ margin: '0 0 24px', fontSize: 14, color: 'var(--muted)' }}>
          {mode === 'signup' ? 'Create an account to continue' : 'Sign in to continue'}
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setError('');
            }}
            style={{
              flex: 1,
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: mode === 'login' ? 'var(--accent-dim)' : 'transparent',
              color: 'var(--text)',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('signup');
              setError('');
            }}
            style={{
              flex: 1,
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: mode === 'signup' ? 'var(--accent-dim)' : 'transparent',
              color: 'var(--text)',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            Sign up
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <label
            style={{
              display: 'block',
              marginBottom: 6,
              fontSize: 13,
              color: 'var(--muted)',
            }}
          >
            Username
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
            style={{
              width: '100%',
              padding: '10px 12px',
              marginBottom: 16,
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg)',
              color: 'var(--text)',
              fontFamily: 'inherit',
              fontSize: 14,
              boxSizing: 'border-box',
            }}
          />
          <label
            style={{
              display: 'block',
              marginBottom: 6,
              fontSize: 13,
              color: 'var(--muted)',
            }}
          >
            Password
          </label>
          <div
            style={{
              position: 'relative',
              marginBottom: 20,
            }}
          >
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              style={{
                width: '100%',
                padding: '10px 40px 10px 12px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--bg)',
                color: 'var(--text)',
                fontFamily: 'inherit',
                fontSize: 14,
                boxSizing: 'border-box',
              }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              title={showPassword ? 'Hide password' : 'Show password'}
              style={{
                position: 'absolute',
                right: 8,
                top: '50%',
                transform: 'translateY(-50%)',
                padding: 4,
                border: 'none',
                background: 'transparent',
                color: 'var(--muted)',
                cursor: 'pointer',
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {showPassword ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
          {error && (
            <p
              style={{
                margin: '-8px 0 12px',
                fontSize: 13,
                color: 'var(--danger)',
              }}
            >
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '12px 20px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--accent)',
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? (mode === 'signup' ? 'Creating…' : 'Signing in…') : mode === 'signup' ? 'Create account' : 'Sign in'}
          </button>
          {mode === 'signup' && (
            <p style={{ margin: '12px 0 0', fontSize: 12, color: 'var(--muted)', lineHeight: 1.4 }}>
              Password must be at least 8 characters.
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
