'use client';

import React, { useState, useEffect } from 'react';
import { ReactAppView } from '@/components/ReactAppView';
import { ReactLiveAppView } from '@/components/ReactLiveAppView';

/**
 * Live preview: Sandpack on HTTPS (reliable), react-live on HTTP (fallback).
 */
export function ImplementationPreview({ content }: { content: string }) {
  const [useSandpack, setUseSandpack] = useState(false);

  useEffect(() => {
    setUseSandpack(window.location.protocol === 'https:');
  }, []);

  if (useSandpack) {
    return <ReactAppView content={content} />;
  }
  return <ReactLiveAppView content={content} />;
}
