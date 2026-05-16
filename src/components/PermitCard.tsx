// ---------------------------------------------------------------------------
// PermitCard.tsx
// Displays a single permit.  Active permits include an "Expand Details"
// toggle to show additional metadata.  Historical permits are summary-only
// (adjustment #2).
// ---------------------------------------------------------------------------

import { useState } from 'react';
import type { Permit } from '../types';
import { track, AnalyticsEvents } from '../services/analytics';
import {
  cleanJobDescription,
  resolveWorkPermitSuffix,
  formatSuffixTooltip,
} from '../utils/formatters';

interface PermitCardProps {
  permit: Permit;
  /** When true, the card can expand to show detailed metadata. */
  expandable?: boolean;
}

/**
 * Inline info-icon tooltip used to explain the trailing 2-3 letter suffix
 * on a DOB work_permit code (e.g. the "-PMM" in "B01345542-I1-PMM").
 *
 * Behaviour:
 *   - Hover (desktop) reveals the tooltip.
 *   - Tap (mobile) toggles it; tapping again or outside dismisses.
 *   - Keyboard focus (Tab) reveals it; blur hides.
 *
 * Rendered as a positioned <span> sibling to the trigger so it can float
 * above the surrounding row layout without disturbing the flex flow.
 */
function SuffixTooltip({ suffix, label }: { suffix: string; label: string }) {
  const [open, setOpen] = useState(false);
  const text = formatSuffixTooltip({ suffix, label });

  return (
    <span className="cp-suffix-tooltip">
      <button
        type="button"
        className="cp-suffix-tooltip-trigger"
        aria-label={text}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        <span className="material-symbols-outlined" aria-hidden="true">
          info
        </span>
      </button>
      {open && (
        <span className="cp-suffix-tooltip-content" role="tooltip">
          {text}
        </span>
      )}
    </span>
  );
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
    <div className="cp-permit-card">
      {/* Summary — always visible */}
      <div className="cp-permit-summary">
        <div className="cp-permit-header">
          <span className="cp-permit-category">
            {permit.workType || permit.workPermitText || 'Permit'}
          </span>
          {permit.isActive && <span className="cp-permit-badge">Active</span>}
        </div>

        <div className="cp-permit-field">
          <span className="cp-permit-label">Work Status</span>
          <span className="cp-permit-value">{permit.permitStatus || '—'}</span>
        </div>
        <div className="cp-permit-field">
          <span className="cp-permit-label">Issued</span>
          <span className="cp-permit-value">{formatDate(permit.issuedDate)}</span>
        </div>
        <div className="cp-permit-field">
          <span className="cp-permit-label">Expires</span>
          <span className="cp-permit-value">{formatDate(permit.expiredDate)}</span>
        </div>
        <div className="cp-permit-field">
          <span className="cp-permit-label">Filing Reason</span>
          <span className="cp-permit-value">{permit.filingReason || '—'}</span>
        </div>
        {permit.jobDescription && (() => {
          // Legibility sprint (May 2026): strip DOB internal routing prefix
          // and sentence-case ALL CAPS filer text. See formatters.ts.
          const cleaned = cleanJobDescription(permit.jobDescription);
          if (!cleaned) return null;
          return (
            <div className="cp-permit-field cp-permit-field--column">
              <span className="cp-permit-label">Job Description</span>
              <span className="cp-permit-description-text">{cleaned}</span>
            </div>
          );
        })()}
      </div>

      {/* Expanded metadata — only for active permits */}
      {expandable && expanded && (() => {
        // Legibility sprint (May 2026): when the work_permit trailing
        // suffix is one we have a plain-English label for, show an info
        // icon next to the value. Suffixes we don't have a label for
        // (-CX, -EW on their own) show no icon — silence over admitting
        // the gap. See formatters.ts.
        const suffix = resolveWorkPermitSuffix(permit.workPermit, permit.workType);
        return (
        <div className="cp-permit-details">
          <div className="cp-permit-field">
            <span className="cp-permit-label">Work Permit</span>
            <span className="cp-permit-value">
              {permit.workPermit || '—'}
              {suffix && (
                <SuffixTooltip suffix={suffix.suffix} label={suffix.label} />
              )}
            </span>
          </div>
          <div className="cp-permit-field">
            <span className="cp-permit-label">Approved</span>
            <span className="cp-permit-value">{formatDate(permit.approvedDate)}</span>
          </div>
          <div className="cp-permit-field">
            <span className="cp-permit-label">Work Location</span>
            <span className="cp-permit-value">{permit.workLocation || '—'}</span>
          </div>
          <div className="cp-permit-field">
            <span className="cp-permit-label">Estimated Job Cost</span>
            <span className="cp-permit-value">{formatCurrency(permit.estimatedJobCost)}</span>
          </div>
          <div className="cp-permit-field">
            <span className="cp-permit-label">Tracking Number</span>
            <span className="cp-permit-value">{permit.trackingNumber || '—'}</span>
          </div>
          <div className="cp-permit-field">
            <span className="cp-permit-label">Job Filing Number</span>
            <span className="cp-permit-value">{permit.jobFilingNumber || '—'}</span>
          </div>
          <div className="cp-permit-field">
            <span className="cp-permit-label">Sequence Number</span>
            <span className="cp-permit-value">{permit.sequenceNumber}</span>
          </div>
        </div>
        );
      })()}

      {/* Expand / Collapse toggle — active permits only */}
      {expandable && (
        <button
          className="cp-permit-toggle"
          onClick={toggleExpand}
          aria-expanded={expanded}
        >
          <span className="cp-permit-toggle-label">
            {expanded ? 'Collapse Details' : 'Expand Details'}
          </span>
          <span
            className="material-symbols-outlined cp-permit-toggle-chevron"
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
