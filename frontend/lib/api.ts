const raw = (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_URL) || '';
// Treat unsubstituted env (e.g. literal "$NEXT_PUBLIC_API_URL" or "http://host/$NEXT_PUBLIC_API_URL") as empty → use relative URLs
const BUILD_TIME_API_BASE =
  !raw ||
  raw.startsWith('$') ||
  raw === '$NEXT_PUBLIC_API_URL' ||
  raw.includes('$NEXT_PUBLIC_API_URL')
    ? ''
    : raw.replace(/\/$/, '');

declare global {
  interface Window {
    __API_BASE__?: string;
  }
}

/** Prefer server-injected base (set in layout from runtime env); fall back to build-time value. */
function getApiBase(): string {
  let base = '';
  if (typeof window !== 'undefined' && window.__API_BASE__ !== undefined) {
    const s = window.__API_BASE__;
    if (!s || s.startsWith('$') || s.includes('$NEXT_PUBLIC_API_URL')) return '';
    base = s.replace(/\/$/, '');
  } else {
    base = BUILD_TIME_API_BASE;
  }
  // Only use relative URLs when the API base is literally the same host (e.g. dev). Do not use substring match:
  // api.your-domain.com must not be treated as same-origin as your-domain.com.
  if (typeof window !== 'undefined' && base && window.location.host) {
    try {
      const u = new URL(base);
      if (u.host === window.location.host) return '';
    } catch {
      /* ignore */
    }
  }
  return base;
}

/** When API_BASE is set (e.g. http://api.your-domain.com), use it for all paths; otherwise same-origin (relative). */
export function apiUrl(path: string): string {
  if (path.startsWith('http')) return path;
  const p = path.startsWith('/') ? path : `/${path}`;
  const base = getApiBase();
  return base ? `${base}${p}` : p;
}

import { getToken } from '@/lib/auth';

function authHeaders(extra?: HeadersInit): HeadersInit {
  const token = getToken();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const url = apiUrl(path);
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders(init?.headers as Record<string, string>) },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export interface Question {
  id: string;
  content: string;
  session_id?: string;
  created_at: string;
}

export interface AgentResponse {
  id: string;
  question_id: string;
  run_id: string;
  stage: number;
  stage_name: string;
  content: string;
  payload?: { type?: string };
  awaiting_feedback?: boolean;
  created_at: string;
}

export const questionsApi = {
  list: () => api<{ questions: Question[] }>('/api/questions'),
  get: (id: string) => api<Question>(`/api/questions/${id}`),
  create: (content: string, sessionId?: string) =>
    api<{ question_id: string; run_id: string; content: string; created_at: string }>('/api/questions', {
      method: 'POST',
      body: JSON.stringify({ content, session_id: sessionId }),
    }),
  /** SSE stream with fetch (event-stream). Calls onMessage for each "data:" line; returns abort function. */
  streamResponses: (
    questionId: string,
    runId: string,
    callbacks: { onMessage: (data: string) => void; onError?: (err: unknown) => void }
  ): (() => void) => {
    const url = apiUrl(`/api/questions/${questionId}/responses?run_id=${encodeURIComponent(runId)}`);
    const ac = new AbortController();
    (async () => {
      try {
        const res = await fetch(url, {
          headers: authHeaders({ Accept: 'text/event-stream' }),
          signal: ac.signal,
        });
        if (!res.ok) {
          callbacks.onError?.(new Error(await res.text()));
          return;
        }
        const reader = res.body?.getReader();
        if (!reader) {
          callbacks.onError?.(new Error('No body'));
          return;
        }
        const dec = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += dec.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';
          for (const block of parts) {
            const m = block.match(/^data: (.+)$/m);
            if (m) callbacks.onMessage(m[1]);
          }
        }
        if (buffer) {
          const m = buffer.match(/^data: (.+)$/m);
          if (m) callbacks.onMessage(m[1]);
        }
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return;
        callbacks.onError?.(err);
      }
    })();
    return () => ac.abort();
  },
  createAudio: (blob: Blob, sessionId?: string) => {
    const headers: Record<string, string> = { ...(authHeaders() as Record<string, string>) };
    if (sessionId) headers['X-Session-ID'] = sessionId;
    return fetch(apiUrl('/api/questions/audio'), {
      method: 'POST',
      body: blob,
      headers,
    }).then((r) => (r.ok ? r.json() : r.text().then((t) => Promise.reject(new Error(t)))));
  },
  /** GET stored responses as JSON (Mongo/cache). Use for previous questions only; do not use stream API. */
  getResponsesList: (questionId: string, runId?: string): Promise<{ responses: AgentResponse[] }> => {
    const url = runId
      ? apiUrl(`/api/questions/${questionId}/responses/list?run_id=${encodeURIComponent(runId)}`)
      : apiUrl(`/api/questions/${questionId}/responses/list`);
    return fetch(url, { headers: authHeaders() }).then((r) =>
      r.ok ? r.json() : r.text().then((t) => Promise.reject(new Error(t)))
    );
  },

  /** GET responses: SSE (live stream or one-shot list). Use only for current/live run; use getResponsesList for previous questions. */
  getResponses: async (questionId: string, runId?: string): Promise<{ responses: AgentResponse[] }> => {
    const url = runId
      ? apiUrl(`/api/questions/${questionId}/responses?run_id=${encodeURIComponent(runId)}&list=1`)
      : apiUrl(`/api/questions/${questionId}/responses`);
    const res = await fetch(url, { headers: authHeaders({ Accept: 'text/event-stream' }) });
    if (!res.ok) throw new Error(await res.text());
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const data = (await res.json()) as { responses: AgentResponse[] };
      return data;
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error('No body');
    const dec = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += dec.decode(value, { stream: true });
      const match = buffer.match(/^data: (.+)$/m);
      if (match) {
        try {
          const data = JSON.parse(match[1]) as { responses: AgentResponse[] };
          return data;
        } catch {
          /* partial chunk, keep reading */
        }
      }
    }
    throw new Error('No data event in SSE stream');
  },
  getRunIds: (questionId: string) =>
    api<{ run_ids: string[] }>(`/api/questions/${questionId}/runs`),
  submitFeedback: (questionId: string, feedback: string, runId?: string, sessionId?: string) =>
    api<{ status: string; run_id: string }>(`/api/questions/${questionId}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ feedback, run_id: runId, session_id: sessionId }),
    }),
  submitFeedbackAudio: (
    questionId: string,
    blob: Blob,
    runId?: string,
    sessionId?: string
  ): Promise<{ status: string; feedback: string; run_id: string }> => {
    const headers: Record<string, string> = { ...(authHeaders() as Record<string, string>) };
    if (runId) headers['X-Run-ID'] = runId;
    if (sessionId) headers['X-Session-ID'] = sessionId;
    return fetch(apiUrl(`/api/questions/${questionId}/feedback/audio`), {
      method: 'POST',
      body: blob,
      headers,
    }).then((r) => (r.ok ? r.json() : r.text().then((t) => Promise.reject(new Error(t)))));
  },
  /** Transcribe only; does not submit feedback or restart pipeline. Use for hold-to-speak to fill the text box. */
  submitFeedbackAudioTranscribeOnly: (
    questionId: string,
    blob: Blob
  ): Promise<{ feedback: string }> => {
    const headers: Record<string, string> = { ...(authHeaders() as Record<string, string>) };
    return fetch(apiUrl(`/api/questions/${questionId}/feedback/audio?transcribe_only=1`), {
      method: 'POST',
      body: blob,
      headers,
    }).then((r) => (r.ok ? r.json() : r.text().then((t) => Promise.reject(new Error(t)))));
  },
};
