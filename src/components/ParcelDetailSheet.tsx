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
import { findVenueAliasByBbl } from '../services/venueAliases';
import { formatStreetAddress, formatBorough } from '../utils/formatters';

/**
 * Where the user came from when this parcel was opened. Drives the
 * `entry_source` property on `parcel_detail_viewed` so the launch arc's
 * share-flow / search / map / direct-deep-link audiences can be told
 * apart in PostHog.
 */
export type ParcelSheetEntrySource = 'search' | 'map' | 'share_link' | 'direct';

interface ParcelDetailSheetProps {
  parcel: Parcel;
  source: ParcelSheetEntrySource;
  onClose: () => void;
  onBookmarkToggle?: (parcelId: string, saved: boolean) => void;
}

/**
 * Module-level guard so `time_to_parcel_detail` fires at most once per
 * page session. Resets only on a full reload.
 */
let timeToParcelDetailFired = false;

/**
 * True if the current page session was loaded directly (cold start) rather
 * than restored from history or arrived via a back/forward navigation. Used
 * to gate `time_to_parcel_detail` so we only measure the launch-arc-relevant
 * "user landed at a CUC URL and saw a permit" path.
 */
function isColdStartSession(): boolean {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined;
    return !nav || nav.type === 'navigate';
  } catch {
    return true;
  }
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

  // ---- Analytics ---------------------------------------------------------
  // Two events fire on every parcel-detail render:
  //   1. parcel_detail_viewed — canonical funnel event, with entry_source
  //      ∈ search | map | share_link | direct so the share-flow audience
  //      can be told apart from search/map traffic.
  //   2. time_to_parcel_detail — fires ONLY for the first parcel render of
  //      a cold-start page session, with `ms` measured from navigation
  //      start. Gates the brief's sub-5-second Aha moment claim.
  useEffect(() => {
    track(AnalyticsEvents.PARCEL_DETAIL_VIEWED, {
      parcelId: parcel.parcelId,
      bbl: parcel.bbl,
      entry_source: source,
    });

    if (!timeToParcelDetailFired && isColdStartSession()) {
      timeToParcelDetailFired = true;
      track(AnalyticsEvents.TIME_TO_PARCEL_DETAIL, {
        ms: Math.round(performance.now()),
        entry_source: source,
        parcelId: parcel.parcelId,
        bbl: parcel.bbl,
      });
    }
  }, [parcel.parcelId, parcel.bbl, source]);

  // ---- Close ---------------------------------------------------------------
  const handleClose = () => {
    track(AnalyticsEvents.PARCEL_SHEET_CLOSED, { parcelId: parcel.parcelId });
    onClose();
  };

  // ---- Header rendering ----------------------------------------------------
  // For BBLs in the venue alias table (Brooklyn Mirage, Pacific Park,
  // Chinatown jail), surface the recognizable name as the primary header
  // and demote the rep-row address to a secondary line. For all other
  // parcels, the rep-row address stays primary and there is no secondary
  // address line.
  // Legibility sprint (May 2026): the friendly-name override path passes
  // through unchanged (curated titles like "Brooklyn Mirage / Avant Gardner
  // / Pacha New York" are already cased correctly). The H1 fallback and
  // the secondary address subtitle both get Title Case + street-suffix
  // abbreviation so a raw "112 WHITE STREET" renders as "112 White St".
  const venueAlias = findVenueAliasByBbl(parcel.bbl);
  const primaryHeader = venueAlias
    ? venueAlias.name
    : formatStreetAddress(parcel.displayAddress);
  const secondaryAddress = venueAlias
    ? formatStreetAddress(parcel.displayAddress)
    : null;

  // ---- Neighbourhood + borough context line --------------------------------
  // The borough field arrives in ALL CAPS from the NYC API ("BROOKLYN"); the
  // NTA field is already mixed case ("East Williamsburg"). Title-case both
  // for safety (idempotent on already-clean input) so the line reads as
  // "East Williamsburg, Brooklyn".
  const contextParts = [parcel.nta, parcel.borough]
    .filter(Boolean)
    .map((s) => formatBorough(s));
  const contextLine = contextParts.join(', ');

  // ---- Share action --------------------------------------------------------
  // Constructs a shareable URL pointing at this parcel's deep link
  // (`${origin}/parcel/{bbl}`), uses the Web Share API when available
  // (mobile), and falls back to clipboard. Either way we fire
  // `share_link_copied` so we can measure share-flow engagement.
  const handleShare = async () => {
    const shareUrl = `${window.location.origin}/parcel/${parcel.bbl}`;
    const shareTitle = `City Permits — ${parcel.displayAddress}`;
    const shareText = contextLine
      ? `${parcel.displayAddress} — ${contextLine}`
      : parcel.displayAddress;

    let outcome: 'native_share' | 'clipboard' | 'failed' = 'failed';
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: shareTitle,
          text: shareText,
          url: shareUrl,
        });
        outcome = 'native_share';
      } catch {
        // User cancelled the native share sheet — treat as no-op, do not
        // fire the share_link_copied event in that case.
        return;
      }
    } else {
      try {
        await navigator.clipboard.writeText(shareUrl);
        outcome = 'clipboard';
      } catch {
        // Clipboard unavailable (insecure context, storage blocked, etc.)
      }
    }

    track(AnalyticsEvents.SHARE_LINK_COPIED, {
      parcelId: parcel.parcelId,
      bbl: parcel.bbl,
      outcome,
    });
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

          <h2 className="cuc-sheet-address">{primaryHeader}</h2>
          {secondaryAddress && (
            <p className="cuc-sheet-context">{secondaryAddress}</p>
          )}
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

          {/* Section 2: Permit History — only render when there's actual
              history. Our /api/parcels endpoint returns only currently-
              active permits today, so permitHistory is always empty and
              this section was just rendering "No permit history available"
              forever. Kept the component import in case we ever broaden
              the data layer to include expired permits. */}
          {parcel.permitHistory.length > 0 && (
            <PermitHistorySection
              permits={parcel.permitHistory}
              parcelId={parcel.parcelId}
            />
          )}

          {/* Section 3: About this Parcel (collapsed by default) */}
          <AboutParcelSection parcel={parcel} />
        </div>
      </div>
    </div>
  );
}
