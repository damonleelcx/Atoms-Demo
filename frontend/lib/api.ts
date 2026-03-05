const API_BASE = (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_URL) || '';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
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
  /** SSE URL for streaming responses. Use questionId and runId from create() response. */
  streamResponsesUrl: (questionId: string, runId: string) =>
    `${API_BASE || ''}/api/questions/${questionId}/responses/stream?run_id=${encodeURIComponent(runId)}`,
  createAudio: (blob: Blob, sessionId?: string) => {
    const headers: Record<string, string> = {};
    if (sessionId) headers['X-Session-ID'] = sessionId;
    return fetch(`${API_BASE}/api/questions/audio`, {
      method: 'POST',
      body: blob,
      headers,
    }).then((r) => (r.ok ? r.json() : r.text().then((t) => Promise.reject(new Error(t)))));
  },
  getResponses: (questionId: string, runId?: string) =>
    api<{ responses: AgentResponse[] }>(
      `/api/questions/${questionId}/responses${runId ? `?run_id=${runId}` : ''}`
    ),
  getRunIds: (questionId: string) =>
    api<{ run_ids: string[] }>(`/api/questions/${questionId}/runs`),
  submitFeedback: (questionId: string, feedback: string, runId?: string, sessionId?: string) =>
    api<{ status: string }>(`/api/questions/${questionId}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ feedback, run_id: runId, session_id: sessionId }),
    }),
  submitFeedbackAudio: (questionId: string, blob: Blob, runId?: string, sessionId?: string) => {
    const headers: Record<string, string> = {};
    if (runId) headers['X-Run-ID'] = runId;
    if (sessionId) headers['X-Session-ID'] = sessionId;
    return fetch(`${API_BASE}/api/questions/${questionId}/feedback/audio`, {
      method: 'POST',
      body: blob,
      headers,
    }).then((r) => (r.ok ? r.json() : r.text().then((t) => Promise.reject(new Error(t)))));
  },
};
