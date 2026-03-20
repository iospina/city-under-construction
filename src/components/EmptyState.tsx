// ---------------------------------------------------------------------------
// EmptyState.tsx
// Shown inside "What's Being Built Here" when a parcel has no active permits.
// Figma: plain text only — no icon.
// ---------------------------------------------------------------------------

import { useEffect } from 'react';
import { track, AnalyticsEvents } from '../services/analytics';

interface EmptyStateProps {
  parcelId: string;
}

export default function EmptyState({ parcelId }: EmptyStateProps) {
  useEffect(() => {
    track(AnalyticsEvents.EMPTY_STATE_VIEWED, { parcelId });
  }, [parcelId]);

  return (
    <div className="cuc-empty-state">
      <p className="cuc-empty-text">
        No active construction permits at this address
      </p>
    </div>
  );
}
