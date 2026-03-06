'use client';

import React from 'react';

export interface WireframeNode {
  type: 'container' | 'text' | 'box' | 'button' | 'input';
  content?: string;
  variant?: 'h1' | 'h2' | 'body';
  label?: string;
  hint?: string;
  placeholder?: string;
  primary?: boolean;
  layout?: 'row' | 'column';
  children?: WireframeNode[];
}

export interface WireframeSpec {
  title?: string;
  layout?: 'row' | 'column';
  children?: WireframeNode[];
}

const wireframeStyles = {
  root: {
    fontFamily: 'system-ui, sans-serif',
    padding: 16,
    background: 'var(--bg, #0f0f12)',
    color: 'var(--text, #e4e4e7)',
    borderRadius: 8,
    border: '1px dashed var(--border, #3f3f46)',
    minHeight: 120,
  },
  title: {
    fontSize: 11,
    color: 'var(--muted, #71717a)',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  container: (layout: 'row' | 'column') => ({
    display: 'flex' as const,
    flexDirection: layout === 'row' ? ('row' as const) : ('column' as const),
    gap: 12,
    marginBottom: 8,
  }),
  text: (variant: string) => ({
    margin: variant === 'body' ? '4px 0' : '8px 0',
    fontSize: variant === 'h1' ? 20 : variant === 'h2' ? 16 : 14,
    fontWeight: variant === 'h1' ? 700 : variant === 'h2' ? 600 : 400,
    color: 'var(--text, #e4e4e7)',
  }),
  box: {
    border: '1px dashed var(--border, #3f3f46)',
    borderRadius: 6,
    padding: 12,
    background: 'rgba(63, 63, 70, 0.2)',
    minHeight: 48,
  },
  boxLabel: {
    fontSize: 10,
    color: 'var(--accent, #3b82f6)',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  boxHint: {
    fontSize: 12,
    color: 'var(--muted, #71717a)',
    fontStyle: 'italic',
  },
  button: (primary: boolean) => ({
    padding: '8px 16px',
    borderRadius: 6,
    border: '1px dashed var(--border, #3f3f46)',
    background: primary ? 'var(--accent-dim, rgba(59, 130, 246, 0.2))' : 'transparent',
    color: 'var(--text, #e4e4e7)',
    fontSize: 13,
    cursor: 'default',
    alignSelf: 'flex-start',
  }),
  input: {
    border: '1px dashed var(--border, #3f3f46)',
    borderRadius: 6,
    padding: '8px 12px',
    background: 'rgba(63, 63, 70, 0.2)',
    color: 'var(--text, #e4e4e7)',
    fontSize: 13,
    minWidth: 120,
  },
};

function WireframeSkeleton() {
  const shimmer = {
    background: 'linear-gradient(90deg, var(--border, #3f3f46) 25%, var(--muted, #71717a) 50%, var(--border, #3f3f46) 75%)',
    backgroundSize: '200% 100%',
    animation: 'shimmer 1.5s ease-in-out infinite',
    borderRadius: 4,
  };
  return (
    <div className="wireframe-view" style={wireframeStyles.root}>
      <div style={{ ...wireframeStyles.title, ...shimmer, width: 120, height: 12 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
        <div style={{ ...shimmer, height: 24, width: '70%' }} />
        <div style={{ ...shimmer, height: 60, width: '100%' }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ ...shimmer, height: 36, width: 80 }} />
          <div style={{ ...shimmer, height: 36, width: 100 }} />
        </div>
      </div>
      <p style={{ margin: '12px 0 0', fontSize: 12, color: 'var(--muted)' }}>Wireframe loading…</p>
    </div>
  );
}

function WireframeNodeRender({ node }: { node: WireframeNode }) {
  switch (node.type) {
    case 'container':
      return (
        <div style={wireframeStyles.container(node.layout || 'column')}>
          {(node.children || []).map((child, i) => (
            <WireframeNodeRender key={i} node={child} />
          ))}
        </div>
      );
    case 'text':
      return (
        <div style={wireframeStyles.text(node.variant || 'body')}>
          {node.content || '(text)'}
        </div>
      );
    case 'box':
      return (
        <div style={wireframeStyles.box}>
          {node.label && (
            <div style={wireframeStyles.boxLabel}>{node.label}</div>
          )}
          {node.hint && (
            <div style={wireframeStyles.boxHint}>{node.hint}</div>
          )}
          {node.children && node.children.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {node.children.map((child, i) => (
                <WireframeNodeRender key={i} node={child} />
              ))}
            </div>
          )}
        </div>
      );
    case 'button':
      return (
        <div style={wireframeStyles.button(!!node.primary)}>
          {node.label || 'Button'}
        </div>
      );
    case 'input':
      return (
        <div style={{ marginBottom: 8 }}>
          {node.label && (
            <div style={wireframeStyles.boxLabel}>{node.label}</div>
          )}
          <span style={wireframeStyles.input}>
            {node.placeholder ? `"${node.placeholder}"` : '________'}
          </span>
        </div>
      );
    default:
      return null;
  }
}

export function WireframeView({ content }: { content: string }) {
  const [spec, setSpec] = React.useState<WireframeSpec | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setError(null);
    const raw = content.trim();
    if (!raw) {
      setSpec(null);
      return;
    }
    try {
      let json = raw;
      const lastBrace = json.lastIndexOf('}');
      if (lastBrace >= 0) {
        json = json.slice(0, lastBrace + 1);
      }
      const parsed = JSON.parse(json) as WireframeSpec;
      if (!parsed || typeof parsed !== 'object') {
        setSpec(null);
        setError('Invalid wireframe');
        return;
      }
      setSpec(parsed);
    } catch {
      setSpec(null);
      if (raw.length > 10) setError('Invalid or incomplete wireframe JSON');
    }
  }, [content]);

  if (error) {
    return <WireframeSkeleton />;
  }

  if (!spec || !spec.children?.length) {
    return <WireframeSkeleton />;
  }

  const rootLayout = spec.layout || 'column';

  return (
    <div className="wireframe-view" style={wireframeStyles.root}>
      {spec.title && (
        <div style={wireframeStyles.title}>{spec.title}</div>
      )}
      <div style={wireframeStyles.container(rootLayout)}>
        {spec.children.map((node, i) => (
          <WireframeNodeRender key={i} node={node} />
        ))}
      </div>
    </div>
  );
}
