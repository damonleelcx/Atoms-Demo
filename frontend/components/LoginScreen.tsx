'use client';

import { login } from '@/lib/auth';
import React, { useState } from 'react';

export function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(username.trim(), password);
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
          Sign in to continue
        </p>
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
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            style={{
              width: '100%',
              padding: '10px 12px',
              marginBottom: 20,
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg)',
              color: 'var(--text)',
              fontFamily: 'inherit',
              fontSize: 14,
              boxSizing: 'border-box',
            }}
          />
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
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
