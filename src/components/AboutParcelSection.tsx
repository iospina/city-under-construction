// ---------------------------------------------------------------------------
// AboutParcelSection.tsx
// Collapsible section showing parcel-level metadata.
// Fields: BBL, Census Tract, Community Board, Council District.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import type { Parcel } from '../types';
import { track, AnalyticsEvents } from '../services/analytics';

interface AboutParcelSectionProps {
  parcel: Parcel;
}

export default function AboutParcelSection({ parcel }: AboutParcelSectionProps) {
  const [expanded, setExpanded] = useState(false);

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) {
      track(AnalyticsEvents.ABOUT_PARCEL_EXPANDED, {
        parcelId: parcel.parcelId,
      });
    }
  };

  const fields = [
    { label: 'Borough Block Lot (BBL)', value: parcel.bbl },
    { label: 'Census Tract', value: parcel.censusTract },
    { label: 'Community Board', value: parcel.communityBoard },
    { label: 'Council District', value: parcel.councilDistrict },
  ];

  return (
    <div className="cuc-section">
      <button className="cuc-section-header" onClick={toggle}>
        <span className="cuc-section-title">About this Parcel</span>
        <span
          className="material-symbols-outlined cuc-chevron"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
        >
          expand_more
        </span>
      </button>

      {expanded && (
        <div className="cuc-section-body cuc-section-animate">
          {fields.map((f) => (
            <div className="cuc-meta-row" key={f.label}>
              <span className="cuc-meta-label">{f.label}</span>
              <span className="cuc-meta-value">{f.value || '—'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
