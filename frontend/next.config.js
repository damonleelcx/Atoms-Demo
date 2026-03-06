/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // Avoid caching HTML so after deploy browsers get fresh page and new script URLs.
  async headers() {
    return [
      {
        source: '/',
        headers: [{ key: 'Cache-Control', value: 'no-store, must-revalidate' }],
      },
    ];
  },
  // For Docker Compose (same host): frontend uses relative /api, this proxies to backend.
  // Stream must hit the Route Handler so we can proxy SSE with ReadableStream (no buffering).
  async rewrites() {
    return [
      // Fix broken client: request path /$NEXT_PUBLIC_API_URL/api/... → /api/... (then proxied below)
      { source: '/\\$NEXT_PUBLIC_API_URL/api/:path*', destination: '/api/:path*' },
      { source: '/%24NEXT_PUBLIC_API_URL/api/:path*', destination: '/api/:path*' },
      // Keep stream internal so app/api/.../stream/route.ts can proxy SSE without buffering
      { source: '/api/questions/:id/responses/stream', destination: '/api/questions/:id/responses/stream' },
      { source: '/api/:path*', destination: 'http://backend:8080/api/:path*' },
    ];
  },
};

module.exports = nextConfig;
