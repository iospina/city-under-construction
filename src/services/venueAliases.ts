// ---------------------------------------------------------------------------
// venueAliases.ts
// Hand-curated alias table mapping well-known venue names to NYC BBLs.
//
// Why we need this:
//   Mapbox's geocoder doesn't index venue/business names. Searching
//   "Brooklyn Mirage" returns "Brooklyn, NY" (just the borough);
//   "Pacha New York" returns a Long Island business; "Avant Gardner"
//   returns Gardner Avenue. None of those land at the actual venue.
//
//   For the Brooklyn Mirage launch arc the brief explicitly lists those
//   three names as test searches that should work. Rather than swap
//   geocoders or wait for Mapbox to add venue indexing, we maintain a
//   small alias table: known venue strings → known BBLs. The Search hook
//   prepends a synthetic suggestion whenever the user's query matches an
//   alias, before Mapbox's results.
//
// Maintenance note: this is intentionally hand-curated and short. Each
// entry is a deliberate decision, not a list to grow indefinitely. If
// the table starts approaching ~20 entries, that's a signal to swap the
// geocoder rather than keep adding aliases.
// ---------------------------------------------------------------------------

export interface VenueAlias {
  /** Human-readable name shown in the suggestion list. */
  name: string;
  /** Lower-case substrings to match against the user's typed query. */
  aliases: readonly string[];
  /** NYC BBL (10 digits) — drives the parcel resolution at the BBL level. */
  bbl: string;
  /** Address shown as the secondary line in the suggestion. */
  displayAddress: string;
  borough: string;
  zipCode: string;
  /**
   * Approximate lat/lng for map flyTo. Only used when our parcels list
   * doesn't have stored coords for the BBL — usually superseded by the
   * matched parcel's own coords.
   */
  center: [number, number];
}

export const VENUE_ALIASES: readonly VenueAlias[] = [
  {
    name: 'Brooklyn Mirage / Avant Gardner / Pacha New York',
    aliases: [
      'brooklyn mirage',
      'avant gardner',
      'avant gardener',
      'pacha new york',
      'pacha nyc',
      'pacha ny',
    ],
    bbl: '3029770001',
    displayAddress: '140 Stewart Avenue',
    borough: 'Brooklyn',
    zipCode: '11237',
    center: [-73.926311, 40.710649],
  },
  {
    name: 'Pacific Park / Atlantic Yards',
    aliases: [
      'pacific park',
      'atlantic yards',
      'pacific park brooklyn',
      'atlantic yards brooklyn',
    ],
    bbl: '3020410001',
    displayAddress: '104 Carlton Avenue',
    borough: 'Brooklyn',
    zipCode: '11217',
    // Approximate centroid of the Pacific Park development
    center: [-73.97552, 40.683412],
  },
];

/**
 * Find the first alias entry whose aliases match the user's query string.
 * Match is case-insensitive substring containment in either direction
 * ("brooklyn mirage" matches user-typed "brooklyn mir" and vice versa).
 */
export function findVenueAlias(query: string): VenueAlias | null {
  const q = query.toLowerCase().trim();
  if (!q) return null;
  for (const v of VENUE_ALIASES) {
    for (const a of v.aliases) {
      // Substring containment in either direction so partial typing matches.
      if (q.includes(a) || (a.length >= 4 && q.length >= 4 && a.includes(q))) {
        return v;
      }
    }
  }
  return null;
}

/**
 * Find the alias entry for a specific BBL. Used by the server-rendered OG
 * handler to substitute a recognizable venue name into the share card
 * (e.g., "Pacific Park / Atlantic Yards" rather than "135 Washington Walk"
 * for the Pacific Park megaproject parcel).
 */
export function findVenueAliasByBbl(bbl: string): VenueAlias | null {
  for (const v of VENUE_ALIASES) {
    if (v.bbl === bbl) return v;
  }
  return null;
}
