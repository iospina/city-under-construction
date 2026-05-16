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
    { label: 'Building ID (BIN)', value: parcel.bin },
    { label: 'Census Tract', value: parcel.censusTract },
    { label: 'Community Board', value: parcel.communityBoard },
    { label: 'Council District', value: parcel.councilDistrict },
  ];

  return (
    <div className="cp-section">
      <button className="cp-section-header" onClick={toggle}>
        <span className="cp-section-title">About this Parcel</span>
        <span
          className="material-symbols-outlined cp-chevron"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
        >
          expand_more
        </span>
      </button>

      {expanded && (
        <div className="cp-section-body cp-section-animate">
          {fields.map((f) => (
            <div className="cp-meta-row" key={f.label}>
              <span className="cp-meta-label">{f.label}</span>
              <span className="cp-meta-value">{f.value || '—'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
