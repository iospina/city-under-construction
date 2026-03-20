// ---------------------------------------------------------------------------
// ParcelDetailSheet.tsx
// Bottom sheet overlay showing parcel details.
//
// Sections:
//   1. "What's Being Built Here" — expanded by default
//   2. "Permit History" — collapsed by default
//   3. "About this Parcel" — collapsed by default
//
// Sections expand and collapse independently.
// Issue 4 fix: Share button uses navigator.share / clipboard fallback.
// Issue 5 fix: Bookmark is a local toggle per opened parcel.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import type { Parcel } from '../types';
import PermitCard from './PermitCard';
import EmptyState from './EmptyState';
import PermitHistorySection from './PermitHistorySection';
import AboutParcelSection from './AboutParcelSection';
import { track, AnalyticsEvents } from '../services/analytics';

interface ParcelDetailSheetProps {
  parcel: Parcel;
  source: 'search' | 'map';
  onClose: () => void;
  onBookmarkToggle?: (parcelId: string, saved: boolean) => void;
}

export default function ParcelDetailSheet({
  parcel,
  source,
  onClose,
  onBookmarkToggle,
}: ParcelDetailSheetProps) {
  // ---- Item 4: localStorage-backed bookmark (persists across opens) --------
  const [activeOpen, setActiveOpen] = useState(true);

  const [bookmarked, setBookmarked] = useState<boolean>(() => {
    try {
      return localStorage.getItem(`cuc_saved_${parcel.parcelId}`) === 'true';
    } catch {
      return false;
    }
  });

  // ---- Analytics: track sheet open ----------------------------------------
  useEffect(() => {
    const event =
      source === 'search'
        ? AnalyticsEvents.PARCEL_SHEET_OPENED_FROM_SEARCH
        : AnalyticsEvents.PARCEL_SHEET_OPENED_FROM_MAP;

    track(event, { parcelId: parcel.parcelId });
  }, [parcel.parcelId, source]);

  // ---- Close ---------------------------------------------------------------
  const handleClose = () => {
    track(AnalyticsEvents.PARCEL_SHEET_CLOSED, { parcelId: parcel.parcelId });
    onClose();
  };

  // ---- Neighbourhood + borough context line --------------------------------
  const contextParts = [parcel.nta, parcel.borough].filter(Boolean);
  const contextLine = contextParts.join(', ');

  // ---- Issue 4: Share action -----------------------------------------------
  const handleShare = async () => {
    const parts = [parcel.displayAddress];
    if (contextLine) parts.push(contextLine);
    const shareText = parts.join(' — ');
    const shareTitle = `CityUnderConstruction — ${parcel.displayAddress}`;

    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: shareTitle,
          text: shareText,
          url: window.location.href,
        });
      } catch {
        // User cancelled or browser blocked — no action needed
      }
    } else {
      try {
        await navigator.clipboard.writeText(`${shareTitle}\n${shareText}`);
      } catch {
        // Clipboard unavailable in this context — silent fail
      }
    }
  };

  // ---- Item 4: Bookmark toggle — writes to localStorage -------------------
  const handleBookmark = () => {
    setBookmarked((prev) => {
      const next = !prev;
      try {
        if (next) {
          localStorage.setItem(`cuc_saved_${parcel.parcelId}`, 'true');
        } else {
          localStorage.removeItem(`cuc_saved_${parcel.parcelId}`);
        }
      } catch {
        // localStorage unavailable (private mode, storage full) — no-op
      }
      track(
        next ? AnalyticsEvents.PARCEL_BOOKMARKED : AnalyticsEvents.PARCEL_BOOKMARK_REMOVED,
        { parcelId: parcel.parcelId },
      );
      onBookmarkToggle?.(parcel.parcelId, next);
      return next;
    });
  };

  return (
    <div className="cuc-sheet-overlay">
      <div className="cuc-sheet">
        {/* ---- Header ---- */}
        <div className="cuc-sheet-header">
          <div className="cuc-sheet-header-actions">
            {/* Bookmark: filled when saved, outlined when not */}
            <button
              className={`cuc-icon-btn${bookmarked ? ' cuc-icon-btn--active' : ''}`}
              aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark this parcel'}
              title={bookmarked ? 'Remove bookmark' : 'Bookmark'}
              onClick={handleBookmark}
            >
              <span
                className="material-symbols-outlined"
                style={{
                  fontVariationSettings: bookmarked
                    ? "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24"
                    : "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24",
                }}
              >
                bookmark
              </span>
            </button>

            {/* Share */}
            <button
              className="cuc-icon-btn"
              aria-label="Share this parcel"
              title="Share"
              onClick={handleShare}
            >
              <span className="material-symbols-outlined">share</span>
            </button>

            {/* Close */}
            <button
              className="cuc-icon-btn"
              aria-label="Close"
              title="Close"
              onClick={handleClose}
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          <h2 className="cuc-sheet-address">{parcel.displayAddress}</h2>
          {contextLine && (
            <p className="cuc-sheet-context">{contextLine}</p>
          )}
        </div>

        {/* ---- Scrollable content ---- */}
        <div className="cuc-sheet-content">
          {/* Section 1: What's Being Built Here (open by default, collapsible) */}
          <div className="cuc-section">
            <button
              className="cuc-section-header"
              onClick={() => setActiveOpen((o) => !o)}
              aria-expanded={activeOpen}
            >
              <span className="cuc-section-title">What's Being Built Here</span>
              <span
                className="material-symbols-outlined cuc-chevron"
                aria-hidden="true"
                style={{ transform: activeOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
              >
                expand_more
              </span>
            </button>

            {activeOpen && (
              <div className="cuc-section-body cuc-section-animate">
                {parcel.activePermits.length > 0 ? (
                  parcel.activePermits.map((p, i) => (
                    <PermitCard
                      key={`${p.trackingNumber}-${i}`}
                      permit={p}
                      expandable
                    />
                  ))
                ) : (
                  <EmptyState parcelId={parcel.parcelId} />
                )}
              </div>
            )}
          </div>

          {/* Section 2: Permit History (collapsed by default) */}
          <PermitHistorySection
            permits={parcel.permitHistory}
            parcelId={parcel.parcelId}
          />

          {/* Section 3: About this Parcel (collapsed by default) */}
          <AboutParcelSection parcel={parcel} />
        </div>
      </div>
    </div>
  );
}
