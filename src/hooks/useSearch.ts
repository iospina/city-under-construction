// ---------------------------------------------------------------------------
// useSearch.ts
// Mapbox Geocoding API integration for address search.
// Returns suggestions as the user types, debounced.
//
// Augmented with a tiny hand-curated venue-alias overlay (see
// services/venueAliases.ts) — Mapbox's geocoder doesn't index venue/
// business names, so a search for "Brooklyn Mirage" or "Avant Gardner"
// otherwise misses the actual parcel. When the user's query matches an
// alias entry, we prepend a synthetic suggestion to the dropdown that
// resolves directly to the right BBL.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SearchSuggestion } from '../types';
import { findVenueAlias } from '../services/venueAliases';

const GEOCODING_BASE = 'https://api.mapbox.com/geocoding/v5/mapbox.places';
const DEBOUNCE_MS = 300;

interface UseSearchResult {
  query: string;
  setQuery: (q: string) => void;
  suggestions: SearchSuggestion[];
  clearSearch: () => void;
  loading: boolean;
}

export function useSearch(): UseSearchResult {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string | undefined;

  // Debounced fetch
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    if (!query.trim() || !token) {
      setSuggestions([]);
      return;
    }

    timerRef.current = setTimeout(async () => {
      setLoading(true);

      // Check the venue-alias table first. If the query matches a known
      // venue, surface a synthetic suggestion at the top of the dropdown
      // so the user gets the right parcel even before Mapbox has had a
      // chance to mismatch it. We still run the Mapbox query in parallel
      // so addresses on the same street as the venue still surface below.
      const alias = findVenueAlias(query);
      const aliasSuggestion: SearchSuggestion | null = alias
        ? {
            id: `alias:${alias.bbl}`,
            placeName: `${alias.displayAddress}, ${alias.borough}, NY ${alias.zipCode}`,
            text: alias.name,
            center: alias.center,
          }
        : null;

      try {
        const encoded = encodeURIComponent(query.trim());
        const url =
          `${GEOCODING_BASE}/${encoded}.json?access_token=${token}` +
          `&country=US&bbox=-74.26,40.49,-73.70,40.92&types=address&limit=5`;

        const res = await fetch(url);
        const mapboxResults: SearchSuggestion[] = res.ok
          ? ((await res.json()).features ?? []).map(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (f: any) => ({
                id: f.id as string,
                placeName: f.place_name as string,
                text: f.text as string,
                center: f.center as [number, number],
              }),
            )
          : [];

        setSuggestions(
          aliasSuggestion ? [aliasSuggestion, ...mapboxResults] : mapboxResults,
        );
      } catch {
        // Network failure on Mapbox shouldn't kill the alias suggestion.
        setSuggestions(aliasSuggestion ? [aliasSuggestion] : []);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, token]);

  const clearSearch = useCallback(() => {
    setQuery('');
    setSuggestions([]);
  }, []);

  return { query, setQuery, suggestions, clearSearch, loading };
}
