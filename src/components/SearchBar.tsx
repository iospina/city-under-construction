// ---------------------------------------------------------------------------
// SearchBar.tsx
// Address search input with Mapbox Geocoding suggestions dropdown.
//
// panelOpen: when true on desktop, the container slides off-screen left
// so it doesn't overlap the parcel panel. On mobile the class has no effect
// (handled via media query in CSS).
// ---------------------------------------------------------------------------

import { useRef, useEffect } from 'react';
import type { SearchSuggestion } from '../types';
import { track, AnalyticsEvents } from '../services/analytics';

interface SearchBarProps {
  query: string;
  onQueryChange: (q: string) => void;
  suggestions: SearchSuggestion[];
  onSelect: (suggestion: SearchSuggestion) => void;
  onClear: () => void;
  loading: boolean;
}

export default function SearchBar({
  query,
  onQueryChange,
  suggestions,
  onSelect,
  onClear,
  loading,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hasTrackedStart = useRef(false);

  // Track search_started once per search session
  useEffect(() => {
    if (query.length > 0 && !hasTrackedStart.current) {
      track(AnalyticsEvents.SEARCH_STARTED);
      hasTrackedStart.current = true;
    }
    if (query.length === 0) {
      hasTrackedStart.current = false;
    }
  }, [query]);

  const handleClear = () => {
    onClear();
    inputRef.current?.focus();
  };

  return (
    <div className="cp-search-container">
      <div className="cp-search-bar">
        <span className="material-symbols-outlined cp-search-icon">
          search
        </span>
        <input
          ref={inputRef}
          className="cp-search-input"
          type="text"
          placeholder="Search an address in NYC"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
        {query && (
          <button
            className="cp-search-clear"
            onClick={handleClear}
            aria-label="Clear search"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        )}
        {loading && <span className="cp-search-spinner" />}
      </div>

      {suggestions.length > 0 && (
        <ul className="cp-search-results">
          {suggestions.map((s) => {
            // Primary: full first comma-segment of place_name. Mapbox's
            // `text` field strips the house number ("Columbia Street"
            // when the user typed "75 Columbia"); the first segment of
            // place_name preserves it ("75 Columbia Street").
            const primary = s.placeName.split(',')[0].trim() || s.text;
            const secondary = s.placeName
              .replace(/^[^,]+,\s*/, '') // remove leading "75 Columbia Street, "
              .replace(/,?\s*United States$/, '') // strip trailing country
              .trim();

            return (
              <li key={s.id}>
                <button
                  className="cp-search-result-item"
                  onClick={() => {
                    track(AnalyticsEvents.SEARCH_RESULT_SELECTED, {
                      placeName: s.placeName,
                    });
                    onSelect(s);
                  }}
                >
                  <div className="cp-result-text">
                    <span className="cp-result-primary">{primary}</span>
                    {secondary && (
                      <span className="cp-result-secondary">{secondary}</span>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
