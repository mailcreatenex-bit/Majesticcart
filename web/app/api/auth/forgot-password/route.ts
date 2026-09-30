import { NextRequest, NextResponse } from 'next/server';
import { backendUrl, forwardedHeaders } from '@/lib/backend';

/**
 * Target of `app/(shop)/forgot-password/page.tsx`'s form. Requests an
 * email-delivered OTP from the backend, then sends the member on to
 * `/reset-password` to enter it — never reporting whether the email was
 * actually registered, since the backend's reply is deliberately identical
 * either way.
 *
 * The email itself never goes into a redirect URL: it is asked for again on
 * `/reset-password` instead, so it never ends up in browser history, server
 * access logs, or a Referer header.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const email = String(form.get('email') ?? '').trim();

  const forgotUrl = new URL('/forgot-password', req.url);
  if (!email) {
    forgotUrl.searchParams.set('error', 'Enter your email address.');
    return NextResponse.redirect(forgotUrl, 303);
  }

  try {
    const apiRes = await fetch(backendUrl('/auth/reset/email'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...forwardedHeaders(req) },
      body: JSON.stringify({ email }),
      cache: 'no-store',
    });
    if (!apiRes.ok) {
      const body = await apiRes.json().catch(() => null);
      const message = (body && typeof body === 'object' && 'message' in body && typeof (body as { message: unknown }).message === 'string')
        ? (body as { message: string }).message
        : 'Could not send the code. Please try again.';
      forgotUrl.searchParams.set('error', message);
      return NextResponse.redirect(forgotUrl, 303);
    }
  } catch {
    forgotUrl.searchParams.set('error', 'Could not reach the server. Please try again.');
    return NextResponse.redirect(forgotUrl, 303);
  }

  return NextResponse.redirect(new URL('/reset-password', req.url), 303);
}
