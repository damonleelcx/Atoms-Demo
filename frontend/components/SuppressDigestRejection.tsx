'use client';

import { useEffect } from 'react';

/**
 * Prevents unhandled promise rejections from Sandpack/Next (e.g. "reading 'digest'")
 * from breaking the app. The error is still logged but not thrown to the top level.
 */
export function SuppressDigestRejection() {
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      const msg = e.reason?.message ?? String(e.reason);
      if (typeof msg === 'string' && msg.includes('digest')) {
        e.preventDefault();
        console.warn('[Sandpack/Next] Suppressed digest-related rejection:', msg);
      }
    };
    window.addEventListener('unhandledrejection', onRejection);
    return () => window.removeEventListener('unhandledrejection', onRejection);
  }, []);
  return null;
}
