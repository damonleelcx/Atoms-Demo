'use client';

import React from 'react';
import { SandpackAppView } from '@/components/SandpackAppView';

/**
 * Implementation-stage live preview. Uses Sandpack (full in-browser bundler).
 * For API compatibility; use ImplementationPreview for protocol-based fallback.
 */
export function ReactAppView({ content }: { content: string }) {
  return <SandpackAppView content={content} />;
}
