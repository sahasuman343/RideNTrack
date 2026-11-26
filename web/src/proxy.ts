import { NextResponse, type NextRequest } from 'next/server';

/**
 * Optimistic gate for the signed-in app. It only checks that a Supabase
 * session cookie is present, with no network call; pages still confirm the
 * session in the browser, and the database enforces access with row level
 * security. A stale cookie therefore just lands on /login after one hop.
 */
export function proxy(request: NextRequest) {
  const hasSession = request.cookies.getAll().some(c => /^sb-.+-auth-token(\.\d+)?$/.test(c.name) && c.value);
  if (hasSession) return NextResponse.next();
  const login = new URL('/login', request.url);
  login.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = { matcher: ['/app', '/app/:path*'] };
