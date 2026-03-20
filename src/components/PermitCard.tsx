// ---------------------------------------------------------------------------
// PermitCard.tsx
// Displays a single permit.  Active permits include an "Expand Details"
// toggle to show additional metadata.  Historical permits are summary-only
// (adjustment #2).
// ---------------------------------------------------------------------------

import { useState } from 'react';
import type { Permit } from '../types';
import { track, AnalyticsEvents } from '../services/analytics';

interface PermitCardProps {
  permit: Permit;
  /** When true, the card can expand to show detailed metadata. */
  expandable?: boolean;
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatCurrency(amount: number): string {
  if (!amount) return '—';
  return `$${amount.toLocaleString()}`;
}

export default function PermitCard({ permit, expandable = false }: PermitCardProps) {
  const [expanded, setExpanded] = useState(false);

  const toggleExpand = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) {
      track(AnalyticsEvents.PERMIT_DETAILS_EXPANDED, {
        trackingNumber: permit.trackingNumber,
      });
    }
  };

  return (
    <div className="cuc-permit-card">
      {/* Summary — always visible */}
      <div className="cuc-permit-summary">
        <div className="cuc-permit-header">
          <span className="cuc-permit-category">
            {permit.workType || permit.workPermitText || 'Permit'}
          </span>
          {permit.isActive && <span className="cuc-permit-badge">Active</span>}
        </div>

        <div className="cuc-permit-field">
          <span className="cuc-permit-label">Work Status</span>
          <span className="cuc-permit-value">{permit.permitStatus || '—'}</span>
        </div>
        <div className="cuc-permit-field">
          <span className="cuc-permit-label">Issued</span>
          <span className="cuc-permit-value">{formatDate(permit.issuedDate)}</span>
        </div>
        <div className="cuc-permit-field">
          <span className="cuc-permit-label">Expires</span>
          <span className="cuc-permit-value">{formatDate(permit.expiredDate)}</span>
        </div>
        <div className="cuc-permit-field">
          <span className="cuc-permit-label">Filing Reason</span>
          <span className="cuc-permit-value">{permit.filingReason || '—'}</span>
        </div>
        {permit.jobDescription && (
          <div className="cuc-permit-field cuc-permit-field--column">
            <span className="cuc-permit-label">Job Description</span>
            <span className="cuc-permit-description-text">
              {permit.jobDescription}
            </span>
          </div>
        )}
      </div>

      {/* Expanded metadata — only for active permits */}
      {expandable && expanded && (
        <div className="cuc-permit-details">
          <div className="cuc-permit-field">
            <span className="cuc-permit-label">Approved</span>
            <span className="cuc-permit-value">{formatDate(permit.approvedDate)}</span>
          </div>
          <div className="cuc-permit-field">
            <span className="cuc-permit-label">Work Location</span>
            <span className="cuc-permit-value">{permit.workLocation || '—'}</span>
          </div>
          <div className="cuc-permit-field">
            <span className="cuc-permit-label">Estimated Job Cost</span>
            <span className="cuc-permit-value">{formatCurrency(permit.estimatedJobCost)}</span>
          </div>
          <div className="cuc-permit-field">
            <span className="cuc-permit-label">Tracking Number</span>
            <span className="cuc-permit-value">{permit.trackingNumber || '—'}</span>
          </div>
          <div className="cuc-permit-field">
            <span className="cuc-permit-label">Job Filing Number</span>
            <span className="cuc-permit-value">{permit.jobFilingNumber || '—'}</span>
          </div>
          <div className="cuc-permit-field">
            <span className="cuc-permit-label">Sequence Number</span>
            <span className="cuc-permit-value">{permit.sequenceNumber}</span>
          </div>
        </div>
      )}

      {/* Expand / Collapse toggle — active permits only */}
      {expandable && (
        <button
          className="cuc-permit-toggle"
          onClick={toggleExpand}
          aria-expanded={expanded}
        >
          <span className="cuc-permit-toggle-label">
            {expanded ? 'Collapse Details' : 'Expand Details'}
          </span>
          <span
            className="material-symbols-outlined cuc-permit-toggle-chevron"
            aria-hidden="true"
            style={{
              transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            }}
          >
            expand_more
          </span>
        </button>
      )}
    </div>
  );
}
