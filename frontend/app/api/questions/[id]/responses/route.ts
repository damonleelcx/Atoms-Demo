import { NextRequest } from 'next/server';
import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';

const BACKEND_BASE = process.env.BACKEND_URL || 'http://backend:8080';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Proxy GET /api/questions/:id/responses to the backend. Backend always returns SSE (with or without run_id).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const runId = request.nextUrl.searchParams.get('run_id');
  if (!id) {
    return new Response(JSON.stringify({ error: 'question id required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const listOnly = request.nextUrl.searchParams.get('list') === '1';
  const path = runId
    ? `/api/questions/${id}/responses?run_id=${encodeURIComponent(runId)}${listOnly ? '&list=1' : ''}`
    : `/api/questions/${id}/responses`;
  const backendUrl = new URL(path, BACKEND_BASE);
  const requestImpl = backendUrl.protocol === 'https:' ? https : http;

  const auth = request.headers.get('authorization');
  const headers: Record<string, string> = { Accept: 'text/event-stream' };
  if (auth) headers['Authorization'] = auth;

  return new Promise<Response>((resolve) => {
    const req = requestImpl.request(
      backendUrl,
      { headers },
      (backendRes) => {
        if (backendRes.statusCode && backendRes.statusCode >= 400) {
          let body = '';
          backendRes.on('data', (chunk) => (body += chunk));
          backendRes.on('end', () =>
            resolve(
              new Response(body || backendRes.statusMessage, {
                status: backendRes.statusCode ?? 502,
                headers: { 'Content-Type': 'application/json' },
              })
            )
          );
          return;
        }
        const webStream = Readable.toWeb(backendRes) as ReadableStream<Uint8Array>;
        resolve(
          new Response(webStream, {
            status: 200,
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache, no-transform',
              Connection: 'keep-alive',
              'X-Accel-Buffering': 'no',
              'Content-Encoding': 'identity',
            },
          })
        );
      }
    );
    req.on('error', (err) =>
      resolve(
        new Response(JSON.stringify({ error: 'Backend unreachable', detail: String(err) }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    req.end();
  });
}
