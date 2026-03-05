'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { questionsApi, type Question, type AgentResponse } from '@/lib/api';
import { MarkdownView } from '@/components/MarkdownView';
import { ReactDesignView } from '@/components/ReactDesignView';
import { WireframeView } from '@/components/WireframeView';
import { ReactAppView } from '@/components/ReactAppView';
import { CodeView } from '@/components/CodeView';
import { AudioInput } from '@/components/AudioInput';

const POLL_MS = 5000;

export default function Home() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [selectedQuestion, setSelectedQuestion] = useState<Question | null>(null);
  const [responses, setResponses] = useState<AgentResponse[]>([]);
  const [runIds, setRunIds] = useState<string[]>([]);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [feedback, setFeedback] = useState('');
  const [lastSubmittedFeedback, setLastSubmittedFeedback] = useState<{ text: string; runId: string } | null>(null);
  const [streamingContent, setStreamingContent] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [loadingFeedback, setLoadingFeedback] = useState(false);
  const sessionId = useRef<string>(`sess-${Date.now()}`).current;
  const loadQuestionsLastCall = useRef<number>(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const streamRunIdRef = useRef<string | null>(null);
  const QUESTIONS_LIST_MIN_MS = 2000;

  const closeStream = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    streamRunIdRef.current = null;
    setStreamingContent({});
  }, []);

  const loadQuestions = useCallback(async () => {
    const now = Date.now();
    if (now - loadQuestionsLastCall.current < QUESTIONS_LIST_MIN_MS) return;
    loadQuestionsLastCall.current = now;
    try {
      const { questions: q } = await questionsApi.list();
      setQuestions(q || []);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    loadQuestions();
  }, [loadQuestions]);

  const loadResponses = useCallback(
    async (questionId: string, runId?: string) => {
      try {
        const { responses: r } = await questionsApi.getResponses(questionId, runId);
        setResponses(r || []);
        const { run_ids: ids } = await questionsApi.getRunIds(questionId);
        setRunIds(ids || []);
        if (runId) setCurrentRunId(runId);
        else if ((ids || []).length > 0) setCurrentRunId(ids![0]);
        else setCurrentRunId(null);
      } catch (e) {
        console.error(e);
        setResponses([]);
      }
    },
    []
  );

  const openStream = useCallback((questionId: string, runId: string) => {
    closeStream();
    const url = questionsApi.streamResponsesUrl(questionId, runId);
    const es = new EventSource(url);
    eventSourceRef.current = es;
    streamRunIdRef.current = runId;
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data) as { stage: number; chunk?: string; done?: boolean };
        if (d.chunk) {
          setStreamingContent((prev) => ({ ...prev, [d.stage]: (prev[d.stage] || '') + d.chunk }));
        }
        if (d.done) {
          setStreamingContent((prev) => {
            const next = { ...prev };
            delete next[d.stage];
            return next;
          });
          loadResponses(questionId, runId);
        }
      } catch (_) {}
    };
    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;
      streamRunIdRef.current = null;
    };
  }, [closeStream, loadResponses]);

  useEffect(() => {
    if (!selectedQuestion) {
      setResponses([]);
      setRunIds([]);
      setCurrentRunId(null);
      setLastSubmittedFeedback(null);
      closeStream();
      return;
    }
    loadResponses(selectedQuestion.id);
    const t = setInterval(() => loadResponses(selectedQuestion.id, currentRunId || undefined), POLL_MS);
    return () => clearInterval(t);
  }, [selectedQuestion?.id, currentRunId]);

  // When user switches run (e.g. from dropdown), close stream for previous run
  useEffect(() => {
    if (currentRunId && streamRunIdRef.current && currentRunId !== streamRunIdRef.current) {
      closeStream();
    }
  }, [currentRunId, closeStream]);

  // Close stream only on unmount
  useEffect(() => {
    return () => closeStream();
  }, [closeStream]);

  const handleSubmit = async () => {
    const text = input.trim();
    if (!text) return;
    setLoading(true);
    try {
      const res = await questionsApi.create(text, sessionId);
      setInput('');
      await loadQuestions();
      setSelectedQuestion({ id: res.question_id, content: res.content, created_at: res.created_at });
      setResponses([]);
      setCurrentRunId(res.run_id);
      loadResponses(res.question_id, res.run_id);
      openStream(res.question_id, res.run_id);
    } catch (e) {
      console.error(e);
      alert('Failed to submit');
    } finally {
      setLoading(false);
    }
  };

  const handleAudioResult = async (blob: Blob) => {
    setLoading(true);
    try {
      const res = await questionsApi.createAudio(blob, sessionId);
      setInput('');
      await loadQuestions();
      setSelectedQuestion({ id: res.question_id, content: res.content, created_at: res.created_at });
      setResponses([]);
      const runId = (res as { question_id: string; run_id?: string; content: string; created_at: string }).run_id;
      if (runId) {
        setCurrentRunId(runId);
        loadResponses(res.question_id, runId);
        openStream(res.question_id, runId);
      } else {
        loadResponses(res.question_id);
      }
    } catch (e) {
      console.error(e);
      alert('Audio submit failed');
    } finally {
      setLoading(false);
    }
  };

  const handleFeedback = async () => {
    if (!selectedQuestion || !feedback.trim()) return;
    const text = feedback.trim();
    const runId = currentRunId ?? undefined;
    setLoadingFeedback(true);
    try {
      await questionsApi.submitFeedback(
        selectedQuestion.id,
        text,
        runId,
        sessionId
      );
      setLastSubmittedFeedback(runId ? { text, runId } : null);
      setFeedback('');
      loadResponses(selectedQuestion.id, currentRunId || undefined);
    } catch (e) {
      console.error(e);
      alert('Feedback submit failed');
    } finally {
      setLoadingFeedback(false);
    }
  };

  const handleFeedbackAudio = async (blob: Blob) => {
    if (!selectedQuestion) return;
    setLoadingFeedback(true);
    try {
      await questionsApi.submitFeedbackAudio(
        selectedQuestion.id,
        blob,
        currentRunId || undefined,
        sessionId
      );
      loadResponses(selectedQuestion.id, currentRunId || undefined);
    } catch (e) {
      console.error(e);
      alert('Feedback audio failed');
    } finally {
      setLoadingFeedback(false);
    }
  };

  const stageNames: Record<number, string> = { 1: 'requirement', 2: 'design', 3: 'implementation', 4: 'feedback' };
  const displayResponses = React.useMemo(() => {
    const byStage = new Map(responses.map((r) => [r.stage, r]));
    const list: AgentResponse[] = [...responses];
    for (let s = 1; s <= 4; s++) {
      if (byStage.has(s)) continue;
      const content = streamingContent[s];
      if (content)
        list.push({
          id: `stream-${s}`,
          question_id: selectedQuestion?.id ?? '',
          run_id: currentRunId ?? '',
          stage: s,
          stage_name: stageNames[s] ?? '',
          content,
          payload: s === 2 ? { type: 'wireframe' } : s === 3 ? { type: 'code' } : undefined,
          created_at: new Date().toISOString(),
        });
    }
    list.sort((a, b) => a.stage - b.stage);
    return list;
  }, [responses, streamingContent, selectedQuestion?.id, currentRunId]);

  const lastResponse = displayResponses.length > 0 ? displayResponses[displayResponses.length - 1] : null;
  const stage = lastResponse?.stage ?? 0;

  return (
    <div className="app-root" style={{ minHeight: '100vh' }}>
      <header className="app-header">
        <h1>Atoms Demo – Multi-Agent App Builder</h1>
      </header>

      <div className="app-body">
        <aside className="app-aside">
          {questions.length > 0 && (
            <section className="app-section-pad" style={{ padding: 16, borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <h2 style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--muted)', textTransform: 'uppercase' }}>
                Previous questions
              </h2>
              <div className="aside-questions-list" style={{ maxHeight: '40vh', overflowY: 'auto' }}>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {questions.slice(0, 15).map((q) => (
                  <li key={q.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedQuestion(q)}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '10px 12px',
                        marginBottom: 4,
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        background: selectedQuestion?.id === q.id ? 'var(--accent-dim)' : 'transparent',
                        color: 'var(--text)',
                        cursor: 'pointer',
                        fontSize: 13,
                      }}
                    >
                      {q.content.slice(0, 80)}{q.content.length > 80 ? '…' : ''}
                    </button>
                  </li>
                ))}
              </ul>
              </div>
            </section>
          )}

          <section className="app-section-pad" style={{ padding: 16, flex: 1, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
            <h2 style={{ margin: '0 0 8px', fontSize: 14, color: 'var(--muted)', textTransform: 'uppercase' }}>
              What app do you want to build?
            </h2>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Describe the app you want..."
              rows={4}
              style={{
                width: '100%',
                maxWidth: '100%',
                padding: 12,
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--bg)',
                color: 'var(--text)',
                fontFamily: 'inherit',
                resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} className="btn-group-row">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={loading || !input.trim()}
                style={{
                  padding: '10px 20px',
                  borderRadius: 8,
                  border: 'none',
                  background: 'var(--accent)',
                  color: '#fff',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  fontWeight: 600,
                }}
              >
                {loading ? 'Submitting…' : 'Submit'}
              </button>
              <AudioInput onResult={handleAudioResult} disabled={loading} />
            </div>
          </section>
        </aside>

        <main className="app-main">
          {!selectedQuestion ? (
            <div style={{ padding: 'clamp(24px, 5vw, 48px)', textAlign: 'center', color: 'var(--muted)' }}>
              Submit a question or select one from the list to see agent responses.
            </div>
          ) : (
            <>
              <div className="app-section-pad app-main-request" style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', background: 'var(--panel)', flexShrink: 0 }}>
                <p style={{ margin: 0, fontSize: 14, color: 'var(--muted)' }}>Your request</p>
                <p style={{ margin: '4px 0 0', fontSize: 'clamp(14px, 2.5vw, 16px)', wordBreak: 'break-word', overflowWrap: 'break-word' }}>{selectedQuestion.content}</p>
                {runIds.length > 1 && (
                  <select
                    value={currentRunId || ''}
                    onChange={(e) => {
                      setCurrentRunId(e.target.value || null);
                      loadResponses(selectedQuestion.id, e.target.value || undefined);
                    }}
                    style={{ marginTop: 8, padding: 6, borderRadius: 6, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)' }}
                  >
                    {runIds.map((id) => (
                      <option key={id} value={id}>Run: {id.slice(0, 8)}…</option>
                    ))}
                  </select>
                )}
              </div>

              <div className="app-main-inner app-main-pad" style={{ padding: 24 }}>
                {displayResponses.length === 0 && (
                  <p style={{ color: 'var(--muted)' }}>Waiting for agent responses…</p>
                )}
                {displayResponses.map((r) => (
                  <div key={r.id} style={{ marginBottom: 24, minWidth: 0 }}>
                    <h3 style={{ fontSize: 12, color: 'var(--accent)', marginBottom: 8 }}>
                      Stage {r.stage}: {r.stage_name}
                    </h3>
                    {r.stage === 1 && <MarkdownView content={r.content} />}
                    {r.stage === 2 && r.payload?.type === 'wireframe' && (
                      <WireframeView content={r.content} />
                    )}
                    {r.stage === 2 && r.payload?.type === 'react' && (
                      <ReactDesignView content={r.content} />
                    )}
                    {r.stage === 2 && r.payload?.type !== 'wireframe' && r.payload?.type !== 'react' && (
                      <CodeView content={r.content} />
                    )}
                    {r.stage === 3 && (
                      <>
                        <CodeView content={r.content} />
                        <ReactAppView content={r.content} />
                      </>
                    )}
                    {r.stage === 4 && <MarkdownView content={r.content} />}
                  </div>
                ))}
                {lastSubmittedFeedback && currentRunId === lastSubmittedFeedback.runId && (
                  <div
                    style={{
                      marginBottom: 24,
                      padding: 12,
                      borderRadius: 8,
                      background: 'var(--panel)',
                      borderLeft: '4px solid var(--accent)',
                    }}
                  >
                    <h3 style={{ fontSize: 12, color: 'var(--accent)', marginBottom: 8 }}>Your feedback</h3>
                    <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{lastSubmittedFeedback.text}</p>
                  </div>
                )}
              </div>

              {lastResponse?.awaiting_feedback && (
                <div className="app-section-pad" style={{ padding: 16, borderTop: '1px solid var(--border)', background: 'var(--panel)' }}>
                  <label style={{ display: 'block', marginBottom: 8, fontSize: 14 }}>Your feedback</label>
                  <textarea
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder="What would you like to change?"
                    rows={2}
                    style={{
                      width: '100%',
                      padding: 12,
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: 'var(--bg)',
                      color: 'var(--text)',
                      fontFamily: 'inherit',
                    }}
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }} className="btn-group-row">
                    <button
                      type="button"
                      onClick={handleFeedback}
                      disabled={loadingFeedback || !feedback.trim()}
                      style={{
                        padding: '8px 16px',
                        borderRadius: 8,
                        border: 'none',
                        background: 'var(--success)',
                        color: '#fff',
                        cursor: 'pointer',
                      }}
                    >
                      Send feedback
                    </button>
                    <AudioInput onResult={handleFeedbackAudio} disabled={loadingFeedback} />
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
