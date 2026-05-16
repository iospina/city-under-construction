// ---------------------------------------------------------------------------
// PermitHistorySection.tsx
// Collapsible section showing historical (inactive) permits.
// Historical cards are summary-only — no Expand Details (adjustment #2).
// ---------------------------------------------------------------------------

import { useState } from 'react';
import type { Permit } from '../types';
import PermitCard from './PermitCard';
import { track, AnalyticsEvents } from '../services/analytics';

interface PermitHistorySectionProps {
  permits: Permit[];
  parcelId: string;
}

export default function PermitHistorySection({
  permits,
  parcelId,
}: PermitHistorySectionProps) {
  const [expanded, setExpanded] = useState(false);

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) {
      track(AnalyticsEvents.PERMIT_HISTORY_EXPANDED, { parcelId });
    }
  };

  return (
    <div className="cp-section">
      <button className="cp-section-header" onClick={toggle}>
        <span className="cp-section-title">Permit History</span>
        <span
          className="material-symbols-outlined cp-chevron"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
        >
          expand_more
        </span>
      </button>

      {expanded && (
        <div className="cp-section-body cp-section-animate">
          {permits.length === 0 ? (
            <p className="cp-section-empty">No permit history available.</p>
          ) : (
            permits.map((p, i) => (
              <PermitCard
                key={`${p.trackingNumber}-${i}`}
                permit={p}
                expandable={false}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
