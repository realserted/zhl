import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Simple in-memory rate limiter for API routes.
 * Tracks requests per IP within a sliding window.
 *
 * Note: In-memory state resets on redeploy. For production at scale,
 * use a Redis-backed solution. This provides baseline DDoS protection.
 */
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

const WINDOW_MS = 60_000; // 1 minute window
const MAX_REQUESTS = 100; // max requests per window per IP

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + WINDOW_MS });
    return false;
  }

  record.count++;
  return record.count > MAX_REQUESTS;
}

// Periodically clean up stale entries to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitMap) {
    if (now > record.resetTime) rateLimitMap.delete(ip);
  }
}, 60_000);

export function middleware(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown';

  // Rate limit API routes and auth-related paths
  if (request.nextUrl.pathname.startsWith('/api') || request.nextUrl.pathname.startsWith('/auth')) {
    if (isRateLimited(ip)) {
      return new NextResponse('Too Many Requests', {
        status: 429,
        headers: {
          'Retry-After': '60',
          'Content-Type': 'text/plain',
        },
      });
    }
  }

  const response = NextResponse.next();

  // Add security headers to all responses
  response.headers.set('X-DNS-Prefetch-Control', 'off');
  response.headers.set('X-Download-Options', 'noopen');
  response.headers.set('X-Permitted-Cross-Domain-Policies', 'none');

  return response;
}

export const config = {
  matcher: [
    // Match all routes except static files and images
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
