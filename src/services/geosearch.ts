// ---------------------------------------------------------------------------
// geosearch.ts
// Thin wrapper around NYC Department of City Planning's GeoSearch v2 API
// (https://geosearch.planninglabs.nyc/). Free, unauthenticated, NYC-only.
//
// Why we need this in addition to Mapbox:
//   Mapbox's geocoder gives us a lat/lng for any user-typed address, but
//   it doesn't know NYC's parcel boundaries — so when the user types
//   "175 Park Avenue", Mapbox returns the physical location, but our
//   text-token search can't find that parcel because Project Commodore
//   actually files DOB permits at "122 EAST 42 STREET" (cross-street
//   primary address). GeoSearch knows that the point at Mapbox's lat/lng
//   sits inside BBL 1012960014, regardless of how DOB labels the lot.
//
// Strategy: when the user picks a Mapbox suggestion, we hit GeoSearch
// reverse with that point and prefer its BBL whenever we have data for
// it. Pure text-token matching becomes a fallback for cases where
// GeoSearch fails (network error, NJ address, etc.).
// ---------------------------------------------------------------------------

const GEOSEARCH_REVERSE = 'https://geosearch.planninglabs.nyc/v2/reverse';

interface GeoSearchPad {
  bbl?: string;
  bin?: string;
}

interface GeoSearchAddendum {
  pad?: GeoSearchPad;
}

interface GeoSearchProperties {
  addendum?: GeoSearchAddendum;
  pad_bbl?: string;
}

interface GeoSearchFeature {
  properties?: GeoSearchProperties;
}

interface GeoSearchResponse {
  features?: GeoSearchFeature[];
}

/**
 * Look up the NYC BBL covering the given lat/lng using GeoSearch reverse.
 * Returns null if GeoSearch can't resolve the point (off-grid, network
 * error, malformed response). Callers should fall back to text-token
 * matching in that case.
 */
export async function lookupBblByLatLng(
  lat: number,
  lng: number,
): Promise<string | null> {
  try {
    const url = new URL(GEOSEARCH_REVERSE);
    url.searchParams.set('point.lat', String(lat));
    url.searchParams.set('point.lon', String(lng));
    url.searchParams.set('size', '1');

    const response = await fetch(url.toString());
    if (!response.ok) return null;

    const data: GeoSearchResponse = await response.json();
    const feature = data.features?.[0];
    if (!feature) return null;

    // GeoSearch can return BBL in either `addendum.pad.bbl` or `pad_bbl`
    // depending on the result type. Try both.
    const bbl =
      feature.properties?.addendum?.pad?.bbl ??
      feature.properties?.pad_bbl ??
      null;

    if (typeof bbl !== 'string' || bbl.length < 7) return null;
    return bbl;
  } catch {
    return null;
  }
}
