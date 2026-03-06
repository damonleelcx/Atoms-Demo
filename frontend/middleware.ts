import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const BAD_PREFIX_1 = '/$NEXT_PUBLIC_API_URL';
const BAD_PREFIX_2 = '/%24NEXT_PUBLIC_API_URL';

/**
 * Strip broken client path prefix so /$NEXT_PUBLIC_API_URL/api/... becomes /api/...
 * (then next.config.js rewrites proxy /api/* to backend).
 */
export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  let newPath = pathname;
  if (pathname.startsWith(BAD_PREFIX_1)) {
    newPath = pathname.slice(BAD_PREFIX_1.length) || '/';
  } else if (pathname.startsWith(BAD_PREFIX_2)) {
    newPath = pathname.slice(BAD_PREFIX_2.length) || '/';
  }
  if (newPath !== pathname) {
    const url = request.nextUrl.clone();
    url.pathname = newPath;
    return NextResponse.rewrite(url);
  }
  return NextResponse.next();
}

// Run on any path; we only rewrite when path starts with the broken prefix.
export const config = {
  matcher: ['/(.*)'],
};
