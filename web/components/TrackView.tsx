'use client';

import { useEffect } from 'react';
import { track, trackVisit, type EventType } from '@/lib/track';

/** Records one event when it appears (a product page being looked at, the bag being opened). Renders nothing. */
export function TrackView({ type, slug }: { type: EventType; slug?: string }) {
  useEffect(() => { track(type, slug ? { slug } : {}); }, [type, slug]);
  return null;
}

/** Marks the start of a visit, once per tab session. Renders nothing. */
export function VisitBeacon() {
  useEffect(() => { trackVisit(); }, []);
  return null;
}
