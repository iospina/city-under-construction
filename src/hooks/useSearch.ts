// ---------------------------------------------------------------------------
// useSearch.ts
// Mapbox Geocoding API integration for address search.
// Returns suggestions as the user types, debounced.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SearchSuggestion } from '../types';

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
      try {
        const encoded = encodeURIComponent(query.trim());
        const url =
          `${GEOCODING_BASE}/${encoded}.json?access_token=${token}` +
          `&country=US&bbox=-74.26,40.49,-73.70,40.92&types=address&limit=5`;

        const res = await fetch(url);
        if (!res.ok) {
          setSuggestions([]);
          return;
        }

        const data = await res.json();
        const mapped: SearchSuggestion[] = (data.features ?? []).map(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (f: any) => ({
            id: f.id as string,
            placeName: f.place_name as string,
            text: f.text as string,
            center: f.center as [number, number],
          }),
        );

        setSuggestions(mapped);
      } catch {
        setSuggestions([]);
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
