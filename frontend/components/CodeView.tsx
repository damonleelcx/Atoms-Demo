'use client';

import React from 'react';
import { MarkdownView } from './MarkdownView';

export function CodeView({ content }: { content: string }) {
  const codeBlock = '```tsx\n' + content + '\n```';
  return (
    <div className="code-view">
      <MarkdownView content={codeBlock} />
    </div>
  );
}
