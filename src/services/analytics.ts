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
// Event name constants (Story 7)
// ---------------------------------------------------------------------------
export const AnalyticsEvents = {
  MAP_VIEW_LOADED: 'map_view_loaded',
  SEARCH_STARTED: 'search_started',
  SEARCH_RESULT_SELECTED: 'search_result_selected',
  PARCEL_SHEET_OPENED_FROM_SEARCH: 'parcel_sheet_opened_from_search',
  PARCEL_SHEET_OPENED_FROM_MAP: 'parcel_sheet_opened_from_map',
  PERMIT_DETAILS_EXPANDED: 'permit_details_expanded',
  PERMIT_HISTORY_EXPANDED: 'permit_history_expanded',
  ABOUT_PARCEL_EXPANDED: 'about_parcel_expanded',
  EMPTY_STATE_VIEWED: 'empty_state_viewed',
  PARCEL_SHEET_CLOSED: 'parcel_sheet_closed',
  PARCEL_BOOKMARKED: 'parcel_bookmarked',
  PARCEL_BOOKMARK_REMOVED: 'parcel_bookmark_removed',
} as const;
