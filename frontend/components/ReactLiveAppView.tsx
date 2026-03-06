'use client';

import React, { Component, useMemo, useState } from 'react';
import { LiveProvider, LivePreview, LiveError } from 'react-live';

/** Catches runtime errors in the live preview so we show the message instead of blank. */
class PreviewErrorBoundary extends Component<
  { children: React.ReactNode; fallback: (error: Error) => React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return this.props.fallback(this.state.error);
    }
    return this.props.children;
  }
}

/**
 * Transforms implementation-stage code for react-live: strip imports and export default,
 * return code that defines a component and calls render(<Component />).
 */
function transformForReactLive(raw: string): string {
  let code = raw.trim();
  // Remove import lines (single-line and multi-line)
  code = code.replace(/^import\s+.*?from\s+['"].*?['"]\s*;?\s*/gm, '');
  code = code.replace(/^export\s+default\s+/m, '');
  code = code.trim();
  // Extract component name from "function App(" or "const App ="
  const fnMatch = code.match(/\b(?:function|const)\s+(\w+)\s*[=(]/);
  const name = fnMatch ? fnMatch[1] : 'App';
  // Ensure we end with render(...)
  if (!/render\s*\(/.test(code)) {
    code += `\nrender(<${name} />);`;
  }
  return code;
}

/**
 * Live preview using react-live. Works over HTTP (no HTTPS required).
 * Use this when Sandpack fails (e.g. plain HTTP, or as fallback).
 * Supports simple React components; no full bundler like Sandpack.
 */
const LIVE_SCOPE = {
  React,
  useState: React.useState,
  useEffect: React.useEffect,
  useMemo: React.useMemo,
  useCallback: React.useCallback,
  useRef: React.useRef,
  useReducer: React.useReducer,
  useContext: React.useContext,
  useLayoutEffect: React.useLayoutEffect,
  useImperativeHandle: React.useImperativeHandle,
};

export function ReactLiveAppView({ content }: { content: string }) {
  const [code] = useState(() => transformForReactLive(content));
  const scope = useMemo(() => ({ ...LIVE_SCOPE }), []);

  return (
    <div
      className="react-live-app-view"
      style={{
        marginTop: 12,
        border: '1px solid var(--border)',
        borderRadius: 8,
        overflow: 'hidden',
        minHeight: 360,
      }}
    >
      <div
        style={{
          padding: '8px 12px',
          fontSize: 12,
          color: 'var(--muted)',
          background: 'var(--panel)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        Live preview (react-live, works on HTTP). Simple components only; syntax or unsupported code may show an error below.
      </div>
      <div style={{ padding: 16, minHeight: 360, background: 'var(--bg)' }}>
        <LiveProvider code={code} scope={scope} noInline={true}>
          <LiveError
            style={{
              display: 'block',
              color: 'var(--error)',
              fontSize: 13,
              padding: '10px 12px',
              marginBottom: 12,
              background: 'color-mix(in srgb, var(--error) 12%, transparent)',
              border: '1px solid var(--error)',
              borderRadius: 6,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          />
          <PreviewErrorBoundary
            fallback={(err) => (
              <div
                style={{
                  color: 'var(--error)',
                  fontSize: 13,
                  padding: '12px',
                  background: 'color-mix(in srgb, var(--error) 12%, transparent)',
                  border: '1px solid var(--error)',
                  borderRadius: 6,
                }}
              >
                <strong>Preview error:</strong> {err.message}
              </div>
            )}
          >
            <LivePreview style={{ minHeight: 200 }} />
          </PreviewErrorBoundary>
        </LiveProvider>
      </div>
    </div>
  );
}
