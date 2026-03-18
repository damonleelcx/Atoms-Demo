'use client';

import { AudioInput } from '@/components/AudioInput';
import { CodeView } from '@/components/CodeView';
import { ImplementationPreview } from '@/components/ImplementationPreview';
import { LoginScreen } from '@/components/LoginScreen';
import { MarkdownView } from '@/components/MarkdownView';
import { ReactDesignView } from '@/components/ReactDesignView';
import { WireframeView } from '@/components/WireframeView';
import { clearToken, isAuthenticated } from '@/lib/auth';
import { questionsApi, type AgentResponse, type Question } from '@/lib/api';
import React, { useCallback, useEffect, useRef, useState } from 'react';

const POLL_MS = 5000;

export default function Home() {
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    if (isAuthenticated()) setAuthenticated(true);
  }, []);

  if (!authenticated) {
    return <LoginScreen onSuccess={() => setAuthenticated(true)} />;
  }

  return (
    <AtomsApp
      onLogout={() => {
        clearToken();
        setAuthenticated(false);
      }}
    />
  );
}

function AtomsApp({ onLogout }: { onLogout: () => void }) {
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
  const streamAbortRef = useRef<(() => void) | null>(null);
  const streamRunIdRef = useRef<string | null>(null);
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const prevQuestionIdRef = useRef<string | null>(null);
  const [collapsedStages, setCollapsedStages] = useState<Record<string, boolean>>({});
  const QUESTIONS_LIST_MIN_MS = 2000;

  const closeStream = useCallback(() => {
    if (streamAbortRef.current) {
      streamAbortRef.current();
      streamAbortRef.current = null;
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
    async (questionId: string, runId?: string, options?: { runsOnly?: boolean }) => {
      const loadingFor = questionId;
      try {
        let idList: string[] = [];
        try {
          const { run_ids: ids } = await questionsApi.getRunIds(questionId);
          if (ids?.length) idList = ids;
        } catch {
          /* continue without run ids */
        }
        if (prevQuestionIdRef.current !== loadingFor) return;
        if (options?.runsOnly && streamRunIdRef.current && !idList.includes(streamRunIdRef.current)) {
          setRunIds([streamRunIdRef.current, ...idList]);
        } else {
          setRunIds((prev) => {
            const fromApi = new Set(idList);
            const prepend = prev.filter((id) => !fromApi.has(id));
            return prepend.length ? [...prepend, ...idList] : idList;
          });
        }
        const runToFetch = runId ?? (idList.length > 0 ? idList[0] : undefined);
        if (!options?.runsOnly) {
          if (runToFetch) setCurrentRunId(runToFetch);
          else setCurrentRunId(null);
        }
        if (!options?.runsOnly) {
          const { responses: r } = await questionsApi.getResponsesList(questionId, runToFetch);
          if (prevQuestionIdRef.current !== loadingFor) return;
          setResponses(r || []);
        }
      } catch (e) {
        console.error(e);
        if (prevQuestionIdRef.current === loadingFor && !options?.runsOnly) setResponses([]);
      }
    },
    []
  );

  const openStream = useCallback((questionId: string, runId: string) => {
    if (!runId) {
      console.warn('[stream] openStream skipped: no run_id');
      return;
    }
    closeStream();
    console.log('[stream] Opening fetch SSE questionId=%s runId=%s', questionId, runId);
    const abort = questionsApi.streamResponses(questionId, runId, {
      onMessage(data) {
        try {
          const d = JSON.parse(data) as { stage: number; chunk?: string; done?: boolean };
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
      },
      onError(err) {
        console.warn('[stream] fetch SSE error', err);
        streamAbortRef.current = null;
        streamRunIdRef.current = null;
      },
    });
    streamAbortRef.current = abort;
    streamRunIdRef.current = runId;
  }, [closeStream, loadResponses]);

  // When question changes: clear content and run selection so we don't show the previous question, then fetch for the new one.
  useEffect(() => {
    if (!selectedQuestion) {
      prevQuestionIdRef.current = null;
      setResponses([]);
      setRunIds([]);
      setCurrentRunId(null);
      setLastSubmittedFeedback(null);
      setStreamingContent({});
      closeStream();
      return;
    }
    const questionJustChanged = prevQuestionIdRef.current !== selectedQuestion.id;
    if (questionJustChanged) {
      prevQuestionIdRef.current = selectedQuestion.id;
      setResponses([]);
      setRunIds([]);
      setCurrentRunId(null);
      setStreamingContent({});
      closeStream();
    }
    const isStreamingThisRun = streamRunIdRef.current === currentRunId;
    // When question just changed, always full load (runs + responses/list). Otherwise preserve user's run selection.
    const runToLoad = questionJustChanged ? undefined : (currentRunId ?? undefined);
    if (questionJustChanged) {
      loadResponses(selectedQuestion.id, undefined);
    } else if (isStreamingThisRun) {
      loadResponses(selectedQuestion.id, undefined, { runsOnly: true });
    } else {
      loadResponses(selectedQuestion.id, runToLoad);
    }
    const t = setInterval(() => {
      const streaming = streamRunIdRef.current === currentRunId;
      if (streaming) {
        loadResponses(selectedQuestion.id, undefined, { runsOnly: true });
      } else {
        loadResponses(selectedQuestion.id, currentRunId ?? undefined);
      }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [selectedQuestion?.id, currentRunId]);

  // Only open stream when run is in progress (no stage 3 yet). Don't open for completed runs when clicking a previous question.
  useEffect(() => {
    if (!selectedQuestion?.id || !currentRunId) return;
    if (streamRunIdRef.current === currentRunId) return;
    const runResponses = responses.filter((r) => r.run_id === currentRunId);
    const hasStage3 = runResponses.some((r) => r.stage === 3);
    if (hasStage3) return; // implementation done, no need to stream
    openStream(selectedQuestion.id, currentRunId);
  }, [selectedQuestion?.id, currentRunId, responses, openStream]);

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
      if (!res.run_id) {
        console.warn('[stream] create() did not return run_id:', res);
      }
      setInput('');
      // So the "question change" effect does not clear currentRunId/runIds for this new question
      prevQuestionIdRef.current = res.question_id;
      setSelectedQuestion({ id: res.question_id, content: res.content, created_at: res.created_at });
      setResponses([]);
      setRunIds(res.run_id ? [res.run_id] : []);
      setCurrentRunId(res.run_id ?? null);
      // Open stream immediately so backend has a subscriber before pipeline sends (broker buffers if we're late)
      if (res.run_id) {
        streamRunIdRef.current = res.run_id;
        openStream(res.question_id, res.run_id);
        setTimeout(() => {
          if (streamRunIdRef.current !== res.run_id) openStream(res.question_id, res.run_id);
        }, 100);
      }
      await loadQuestions();
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
      prevQuestionIdRef.current = res.question_id;
      setSelectedQuestion({ id: res.question_id, content: res.content, created_at: res.created_at });
      setResponses([]);
      const runId = (res as { question_id: string; run_id?: string; content: string; created_at: string }).run_id;
      if (runId) {
        setRunIds([runId]);
        setCurrentRunId(runId);
        streamRunIdRef.current = runId;
        openStream(res.question_id, runId);
        setTimeout(() => {
          if (streamRunIdRef.current !== runId) openStream(res.question_id, runId);
        }, 100);
      } else {
        loadResponses(res.question_id);
      }
      await loadQuestions();
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
      const data = await questionsApi.submitFeedback(
        selectedQuestion.id,
        text,
        runId,
        sessionId
      );
      const newRunId = data.run_id;
      setLastSubmittedFeedback(runId ? { text, runId } : null);
      setFeedback('');
      setRunIds((prev) => (newRunId ? [newRunId, ...prev.filter((id) => id !== newRunId)] : prev));
      setCurrentRunId(newRunId ?? null);
      setResponses([]);
      closeStream();
      if (newRunId) openStream(selectedQuestion.id, newRunId);
    } catch (e) {
      console.error(e);
      alert('Feedback submit failed');
    } finally {
      setLoadingFeedback(false);
    }
  };

  // Hold-to-speak: transcribe only and fill the feedback box; stream restarts only when user clicks "Send feedback".
  const handleFeedbackAudio = async (blob: Blob) => {
    if (!selectedQuestion) return;
    setLoadingFeedback(true);
    try {
      const data = await questionsApi.submitFeedbackAudioTranscribeOnly(selectedQuestion.id, blob);
      if (data.feedback) setFeedback(data.feedback);
    } catch (e) {
      console.error(e);
      alert('Feedback audio failed');
    } finally {
      setLoadingFeedback(false);
    }
  };

  const stageNames: Record<number, string> = { 1: 'requirement', 2: 'design', 3: 'implementation', 4: 'feedback' };
  const displayResponses = React.useMemo(() => {
    const forCurrentRun = currentRunId ? responses.filter((r) => r.run_id === currentRunId) : responses;
    // One response per stage (latest by created_at) so we never show duplicate requirement/design/implementation
    const byStage = new Map<number, AgentResponse>();
    for (const r of forCurrentRun) {
      const existing = byStage.get(r.stage);
      if (!existing || (r.created_at && existing.created_at && r.created_at > existing.created_at)) {
        byStage.set(r.stage, r);
      }
    }
    const list: AgentResponse[] = [];
    for (let s = 1; s <= 4; s++) {
      const stored = byStage.get(s);
      if (stored) {
        list.push(stored);
        continue;
      }
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
  }, [responses, currentRunId, streamingContent, selectedQuestion?.id]);

  const lastResponse = displayResponses.length > 0 ? displayResponses[displayResponses.length - 1] : null;
  const stage = lastResponse?.stage ?? 0;
  const showFeedbackSection = lastResponse != null && lastResponse.stage >= 3;

  // Auto-scroll to bottom when stream or responses update
  useEffect(() => {
    const el = mainScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [displayResponses, streamingContent]);

  const toggleCollapsed = useCallback((id: string) => {
    setCollapsedStages((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const copyStageContent = useCallback(async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
    } catch (_) {}
  }, []);

  return (
    <div className="app-root" style={{ minHeight: '100vh' }}>
      <header className="app-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, width: '100%' }}>
          <h1 data-app-header style={{ margin: 0 }}>
            Atoms Demo – Multi-Agent App Builder {'\u{1F916}'}
          </h1>
          <button
            type="button"
            onClick={onLogout}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg)',
              color: 'var(--text)',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            Log out
          </button>
        </div>
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

              <div ref={mainScrollRef} className="app-main-inner app-main-pad" style={{ padding: 24 }}>
                {displayResponses.length === 0 && (
                  <p style={{ color: 'var(--muted)' }}>Waiting for agent responses…</p>
                )}
                {displayResponses.map((r) => {
                  const isStreamingStage = Boolean(streamingContent[r.stage]);
                  const isCollapsed = isStreamingStage ? false : collapsedStages[r.id] === true;
                  return (
                    <div key={r.id} style={{ marginBottom: 24, minWidth: 0, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                          padding: '10px 12px',
                          background: 'var(--panel)',
                          cursor: 'pointer',
                        }}
                        onClick={() => toggleCollapsed(r.id)}
                      >
                        <h3 style={{ fontSize: 12, color: 'var(--accent)', margin: 0 }}>
                          Stage {r.stage}: {r.stage_name}
                        </h3>
                        <div style={{ display: 'flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => copyStageContent(r.content)}
                            style={{
                              padding: '4px 10px',
                              fontSize: 12,
                              border: '1px solid var(--border)',
                              borderRadius: 6,
                              background: 'var(--bg)',
                              color: 'var(--text)',
                              cursor: 'pointer',
                            }}
                          >
                            Copy
                          </button>
                          <span style={{ color: 'var(--muted)', fontSize: 14 }}>{isCollapsed ? '▼' : '▲'}</span>
                        </div>
                      </div>
                      {!isCollapsed && (
                        <div style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
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
                          {r.stage === 3 && <CodeView content={r.content} />}
                          {r.stage === 4 && <MarkdownView content={r.content} />}
                        </div>
                      )}
                    </div>
                  );
                })}
                {/* Live preview: separate section so it stays visible when implementation stage is collapsed */}
                {(() => {
                  const implementationResponse = displayResponses.find((r) => r.stage === 3);
                  const showLivePreview = implementationResponse != null || Boolean(streamingContent[3]);
                  if (!showLivePreview) return null;
                  return (
                    <div style={{ marginBottom: 24, minWidth: 0, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                      <div
                        style={{
                          padding: '10px 12px',
                          background: 'var(--panel)',
                          borderBottom: '1px solid var(--border)',
                        }}
                      >
                        <h3 style={{ fontSize: 12, color: 'var(--accent)', margin: 0 }}>Live preview</h3>
                      </div>
                      <div style={{ padding: 12 }}>
                        {streamingContent[3] ? (
                          <div
                            style={{
                              padding: 24,
                              background: 'var(--panel)',
                              borderRadius: 8,
                              border: '1px solid var(--border)',
                              minHeight: 200,
                            }}
                          >
                            <div
                              style={{
                                height: 12,
                                width: '40%',
                                background: 'linear-gradient(90deg, var(--border) 25%, var(--muted) 50%, var(--border) 75%)',
                                backgroundSize: '200% 100%',
                                animation: 'shimmer 1.5s ease-in-out infinite',
                                borderRadius: 4,
                                marginBottom: 12,
                              }}
                            />
                            <div
                              style={{
                                height: 12,
                                width: '70%',
                                background: 'linear-gradient(90deg, var(--border) 25%, var(--muted) 50%, var(--border) 75%)',
                                backgroundSize: '200% 100%',
                                animation: 'shimmer 1.5s ease-in-out infinite 0.2s',
                                borderRadius: 4,
                                marginBottom: 12,
                              }}
                            />
                            <div
                              style={{
                                height: 80,
                                width: '100%',
                                background: 'linear-gradient(90deg, var(--border) 25%, var(--muted) 50%, var(--border) 75%)',
                                backgroundSize: '200% 100%',
                                animation: 'shimmer 1.5s ease-in-out infinite 0.4s',
                                borderRadius: 4,
                              }}
                            />
                            <p style={{ margin: '12px 0 0', fontSize: 12, color: 'var(--muted)' }}>Live preview will appear when implementation finishes streaming.</p>
                          </div>
                        ) : implementationResponse ? (
                          <ImplementationPreview content={implementationResponse.content} />
                        ) : null}
                      </div>
                    </div>
                  );
                })()}
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

              {showFeedbackSection && (
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
