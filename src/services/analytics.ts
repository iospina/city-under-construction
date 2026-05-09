// ---------------------------------------------------------------------------
// analytics.ts
// Thin PostHog wrapper.  All analytics calls are fire-and-forget so they
// never block UI rendering.
//
// If VITE_POSTHOG_KEY is not set, all calls are silently no-ops.
// ---------------------------------------------------------------------------

import posthog from 'posthog-js';

let initialised = false;

/**
 * Initialise PostHog.  Safe to call multiple times — subsequent calls are
 * ignored.
 */
export function initAnalytics(): void {
  const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
  const host = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ||
    'https://app.posthog.com';

  if (!key) {
    console.info('[analytics] PostHog key not set — analytics disabled.');
    return;
  }

  if (initialised) return;

  posthog.init(key, {
    api_host: host,
    loaded: () => {
      initialised = true;
    },
  });

  initialised = true;
}

/**
 * Track an event.  Non-blocking.
 */
export function track(
  eventName: string,
  properties?: Record<string, unknown>,
): void {
  if (!initialised) return;

  try {
    posthog.capture(eventName, properties);
  } catch {
    // Swallow — analytics must never crash the app.
  }
}

// ---------------------------------------------------------------------------
// Event name constants
// ---------------------------------------------------------------------------
export const AnalyticsEvents = {
  MAP_VIEW_LOADED: 'map_view_loaded',
  SEARCH_STARTED: 'search_started',
  SEARCH_RESULT_SELECTED: 'search_result_selected',
  /**
   * Fired exactly once per parcel-detail-sheet open. Properties:
   *   - parcelId, bbl
   *   - entry_source ∈ 'search' | 'map' | 'share_link' | 'direct' so the
   *     share-flow audience can be told apart from organic engagement.
   * Canonical replacement for the older parcel_sheet_opened_from_* pair.
   */
  PARCEL_DETAIL_VIEWED: 'parcel_detail_viewed',
  PERMIT_DETAILS_EXPANDED: 'permit_details_expanded',
  PERMIT_HISTORY_EXPANDED: 'permit_history_expanded',
  ABOUT_PARCEL_EXPANDED: 'about_parcel_expanded',
  EMPTY_STATE_VIEWED: 'empty_state_viewed',
  PARCEL_SHEET_CLOSED: 'parcel_sheet_closed',
  PARCEL_BOOKMARKED: 'parcel_bookmarked',
  PARCEL_BOOKMARK_REMOVED: 'parcel_bookmark_removed',

  /**
   * Fired after the share button completes either a Web Share API call
   * (mobile) or a clipboard write (desktop). Properties: parcelId, bbl,
   * outcome ∈ 'native_share' | 'clipboard' | 'failed'.
   */
  SHARE_LINK_COPIED: 'share_link_copied',
  /**
   * Fired exactly once per cold-start session, the first time a parcel
   * detail renders. Properties: ms (since navigation start), entry_source,
   * parcelId, bbl. Gates the brief's sub-5-second Aha moment claim.
   */
  TIME_TO_PARCEL_DETAIL: 'time_to_parcel_detail',
} as const;
