'use client';

import React, { Component, useMemo, useState } from 'react';
import { LiveProvider, LivePreview, LiveError } from 'react-live';

/** Catches runtime errors in the live preview so we show the message instead of blank. Stores message string only to avoid mutating read-only error.message (SyntaxError etc.). */
class PreviewErrorBoundary extends Component<
  { children: React.ReactNode; fallback: (message: string) => React.ReactNode },
  { message: string | null }
> {
  state = { message: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    const msg =
      error instanceof Error ? error.message : typeof error === 'string' ? error : String(error);
    return { message: msg };
  }

  render() {
    if (this.state.message) {
      return this.props.fallback(this.state.message);
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
  // Fix common agent typo: "const handle SomeName" -> "const handleSomeName" (invalid identifier due to space)
  code = code.replace(/\bconst\s+handle\s+([A-Z]\w*)\s*=/g, 'const handle$1 =');
  code = code.replace(/\bfunction\s+handle\s+([A-Z]\w*)\s*\(/g, 'function handle$1(');
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
            fallback={(message) => (
              <div
                style={{
                  color: 'var(--error)',
                  fontSize: 13,
                  padding: '12px',
                  background: 'color-mix(in srgb, var(--error) 12%, transparent)',
                  border: '1px solid var(--error)',
                  borderRadius: 6,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                <strong>Preview error:</strong> {message}
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
