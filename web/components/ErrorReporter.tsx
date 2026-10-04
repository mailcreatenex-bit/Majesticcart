'use client';

import { useEffect } from 'react';
import { reportError } from '@/lib/report-error';

/** Reports uncaught errors and unhandled promise rejections from any page. Renders nothing. */
export function ErrorReporter() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => reportError(e.message || 'Unknown error', e.error instanceof Error ? e.error.stack : null);
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      reportError(r instanceof Error ? r.message : String(r ?? 'Unhandled rejection'), r instanceof Error ? r.stack : null);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  return null;
}
