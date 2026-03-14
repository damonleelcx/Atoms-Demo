'use client';

import React, { useMemo } from 'react';
import { SandpackPreview, SandpackProvider } from '@codesandbox/sandpack-react';

/** Catches Sandpack/Next digest and runtime errors so the rest of the app doesn't crash. */
class SandpackErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch() {
    // Prevent unhandled promise rejections (e.g. digest) from breaking the app
  }
  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: 24,
            textAlign: 'center',
            color: 'var(--muted)',
            fontSize: 14,
            minHeight: 200,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <span>Live preview could not load (timeout or runtime error).</span>
          <span style={{ fontSize: 12 }}>You can still review the code above.</span>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Fix common agent typo: "const handle SomeName" -> "const handleSomeName" (invalid due to space).
 */
function fixAgentTypo(code: string): string {
  let out = code.replace(/\bconst\s+handle\s+([A-Z]\w*)\s*=/g, 'const handle$1 =');
  out = out.replace(/\bfunction\s+handle\s+([A-Z]\w*)\s*\(/g, 'function handle$1(');
  return out;
}

/**
 * Ensures the code has a default export for Sandpack's App.
 * Template "react-ts" expects /App.tsx to export default.
 */
function ensureDefaultExport(code: string): string {
  const trimmed = fixAgentTypo(code).trim();
  if (/export\s+default\s+/m.test(trimmed)) return trimmed;
  const fnMatch = trimmed.match(/\b(?:function|const)\s+(\w+)\s*[=(]/);
  const name = fnMatch ? fnMatch[1] : 'App';
  return trimmed + `\nexport default ${name};`;
}

/**
 * Live preview using Sandpack (in-browser bundler). More reliable than react-live
 * for complex code and npm-style imports.
 * Note: Sandpack live preview requires HTTPS (or localhost); over plain HTTP it may show "Couldn't connect to server".
 * Cross-Origin-Embedder-Policy / Cross-Origin-Opener-Policy can block the iframe—disable them if needed.
 */
export function SandpackAppView({ content }: { content: string }) {
  const appCode = useMemo(() => ensureDefaultExport(content), [content]);
  const files = useMemo(
    () => ({
      '/App.tsx': appCode,
    }),
    [appCode]
  );

  return (
    <div
      className="sandpack-app-view"
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
        Live preview
      </div>
      <SandpackErrorBoundary>
        <SandpackProvider
          template="react-ts"
          files={files}
          options={{
            activeFile: '/App.tsx',
            recompileMode: 'immediate',
          }}
        >
          <SandpackPreview
            style={{ height: 400, minHeight: 400 }}
            showRefreshButton
            showOpenInCodeSandbox={false}
            showSandpackErrorOverlay
          />
        </SandpackProvider>
      </SandpackErrorBoundary>
    </div>
  );
}
