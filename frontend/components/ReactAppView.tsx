'use client';

import React from 'react';
import { SandpackProvider, SandpackPreview } from '@codesandbox/sandpack-react';

/**
 * Renders implementation-stage React app code using Sandpack.
 * Sandpack compiles and runs React/TypeScript in the browser, so we no longer
 * need manual TS stripping or createElement patches—it handles TS, JSX, and
 * common edge cases via its built-in bundler.
 */
export function ReactAppView({ content }: { content: string }) {
  // Ensure we have a default export so the template's index can render it.
  const code = content.trim().endsWith(';') ? content.trim() : content;
  const files = {
    '/App.tsx': code,
  };

  return (
    <div
      className="react-app-view"
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
    </div>
  );
}
