import { NextRequest, NextResponse } from 'next/server';
import { backendUrl, forwardedHeaders } from '@/lib/backend';

/**
 * Target of `app/(shop)/reset-password/page.tsx`'s form. Confirms the
 * emailed code and sets the new password. Nothing identifying goes into the
 * redirect URL on either path — a failure sends the member back to the same
 * form to retype everything, which costs one extra keystroke set and keeps
 * an email address out of browser history and server logs.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const email = String(form.get('email') ?? '').trim();
  const code = String(form.get('code') ?? '').trim();
  const newPassword = String(form.get('newPassword') ?? '');

  const resetUrl = new URL('/reset-password', req.url);
  if (!email || !code || !newPassword) {
    resetUrl.searchParams.set('error', 'Fill in every field.');
    return NextResponse.redirect(resetUrl, 303);
  }

  try {
    const apiRes = await fetch(backendUrl('/auth/reset/email/confirm'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...forwardedHeaders(req) },
      body: JSON.stringify({ email, code, newPassword }),
      cache: 'no-store',
    });
    if (!apiRes.ok) {
      const body = await apiRes.json().catch(() => null);
      const message = (body && typeof body === 'object' && 'message' in body && typeof (body as { message: unknown }).message === 'string')
        ? (body as { message: string }).message
        : 'Could not reset your password. Please try again.';
      resetUrl.searchParams.set('error', message);
      return NextResponse.redirect(resetUrl, 303);
    }
  } catch {
    resetUrl.searchParams.set('error', 'Could not reach the server. Please try again.');
    return NextResponse.redirect(resetUrl, 303);
  }

  const loginUrl = new URL('/login', req.url);
  loginUrl.searchParams.set('notice', 'password-reset');
  return NextResponse.redirect(loginUrl, 303);
}
