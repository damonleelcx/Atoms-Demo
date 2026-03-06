import { NextRequest } from 'next/server';
import http from 'node:http';
import https from 'node:https';

const BACKEND_BASE = process.env.BACKEND_URL || 'http://backend:8080';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Proxy GET /api/questions/:id/responses/list to the backend. Returns JSON from Mongo/cache only (no stream).
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
  const path = runId
    ? `/api/questions/${id}/responses/list?run_id=${encodeURIComponent(runId)}`
    : `/api/questions/${id}/responses/list`;
  const backendUrl = new URL(path, BACKEND_BASE);
  const requestImpl = backendUrl.protocol === 'https:' ? https : http;

  return new Promise<Response>((resolve) => {
    const req = requestImpl.request(backendUrl, (backendRes) => {
      let body = '';
      backendRes.on('data', (chunk) => (body += chunk));
      backendRes.on('end', () => {
        resolve(
          new Response(body, {
            status: backendRes.statusCode ?? 502,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      });
    });
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
