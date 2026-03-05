'use client';

import React, { useMemo } from 'react';

// Renders React code string in an iframe using Babel standalone.
export function ReactDesignView({ content }: { content: string }) {
  const html = useMemo(() => {
    const code = content
      .replace(/export\s+default\s+function\s+(\w+)/, 'function $1')
      .replace(/export\s+function\s+(\w+)/, 'function $1')
      .replace(/import\s+React(?:\s*,\s*\{[^}]*\})?\s*from\s+['"]react['"];?\s*/gi, '')
      .replace(/import\s+.*?from\s+['"].*?['"];?\s*/g, '')
      .replace(/<\/script>/gi, '<\\/script>');
    const componentMatch = code.match(/function\s+(\w+)\s*\(/);
    const componentName = componentMatch ? componentMatch[1] : 'App';
    const reactHooks = 'const { useState, useMemo, useEffect, useCallback, useRef } = React;';
    // Build script body with concatenation so template literals (backticks) in code are preserved
    const scriptBody = [
      'try {',
      reactHooks,
      code,
      "const root = document.getElementById('root');",
      'if (typeof ' + componentName + " !== 'undefined') {",
      '  ReactDOM.createRoot(root).render(React.createElement(' + componentName + '));',
      '} else {',
      "  root.innerHTML = '<p>No component found.</p>';",
      '}',
      '} catch (e) {',
      "  const msg = (e && e.message) || String(e);",
      "  const truncated = /unexpected end of input|Unexpected token|Unterminated/i.test(msg);",
      "  const hint = truncated ? '\\n\\n(Response may have been cut off.)' : '';",
      "  document.getElementById('root').innerHTML = '<pre style=\"margin:0;padding:16px;background:#1a1a2e;color:#f87171;white-space:pre-wrap;font-size:12px;min-height:80px;\">' + msg.replace(/</g, '&lt;') + hint + '</pre>';",
      '}',
    ].join('\n');
    return '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin></script>' +
      '<script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin></script>' +
      '<script src="https://unpkg.com/@babel/standalone/babel.min.js" crossorigin></script>' +
      '<style>body{font-family:system-ui;margin:0;padding:16px;}</style></head><body><div id="root"></div>' +
      '<script type="text/babel" data-presets="react">' + scriptBody + '</script></body></html>';
  }, [content]);

  return (
    <div className="react-design-view">
      <iframe
        title="Design preview"
        srcDoc={html}
        sandbox="allow-scripts allow-same-origin"
        className="design-iframe"
      />
    </div>
  );
}
