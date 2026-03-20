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
    <div className="cuc-search-container">
      <div className="cuc-search-bar">
        <span className="material-symbols-outlined cuc-search-icon">
          search
        </span>
        <input
          ref={inputRef}
          className="cuc-search-input"
          type="text"
          placeholder="Search an address in NYC"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
        {query && (
          <button
            className="cuc-search-clear"
            onClick={handleClear}
            aria-label="Clear search"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        )}
        {loading && <span className="cuc-search-spinner" />}
      </div>

      {suggestions.length > 0 && (
        <ul className="cuc-search-results">
          {suggestions.map((s) => {
            // Split into primary (street name) and secondary (neighbourhood/city)
            const primary = s.text;
            const secondary = s.placeName
              .replace(/^[^,]+,\s*/, '') // remove leading "39 Broadway, "
              .replace(/,?\s*United States$/, '') // strip trailing country
              .trim();

            return (
              <li key={s.id}>
                <button
                  className="cuc-search-result-item"
                  onClick={() => {
                    track(AnalyticsEvents.SEARCH_RESULT_SELECTED, {
                      placeName: s.placeName,
                    });
                    onSelect(s);
                  }}
                >
                  <div className="cuc-result-text">
                    <span className="cuc-result-primary">{primary}</span>
                    {secondary && (
                      <span className="cuc-result-secondary">{secondary}</span>
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
