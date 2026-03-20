// ---------------------------------------------------------------------------
// mapMarkers.ts
// Helper to create styled DOM elements for Mapbox GL markers.
// Uses SVG teardrop pins and location dot.
// ---------------------------------------------------------------------------

/**
 * Create a marker DOM element styled as a teardrop pin.
 * Three states:
 *   - Default (not selected, not saved): blue pin #1976D2, size 28×37
 *   - Saved (not selected): amber pin #F57C00, size 28×37
 *   - Selected (takes priority): dark blue #0D47A1, size 38×50, stronger drop-shadow
 *
 * Anchor should be set to 'bottom' in the Mapbox Marker constructor so that
 * the tip of the pin sits exactly on the coordinate.
 */
export function createMarkerElement(isSelected = false, isSaved = false): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'cuc-marker';

  // Determine size, color, and shadow based on state.
  // Selected takes priority over saved.
  let size: number;
  let height: number;
  let fill: string;
  let innerR: number;
  let dropShadow: string;

  if (isSelected) {
    size = 38;
    height = 50;
    fill = '#0D47A1';
    innerR = 7;
    dropShadow = 'drop-shadow(0 3px 8px rgba(0,0,0,0.4))';
  } else if (isSaved) {
    size = 28;
    height = 37;
    fill = '#F57C00';
    innerR = 5.5;
    dropShadow = 'drop-shadow(0 1px 3px rgba(0,0,0,0.28))';
  } else {
    size = 28;
    height = 37;
    fill = '#1976D2';
    innerR = 5.5;
    dropShadow = 'drop-shadow(0 1px 3px rgba(0,0,0,0.28))';
  }

  el.style.width = `${size}px`;
  el.style.height = `${height}px`;
  el.style.cursor = 'pointer';
  el.style.filter = dropShadow;
  el.style.transition = 'filter 150ms ease-out';

  // SVG teardrop: rounded top half, pointed bottom
  el.innerHTML = `<svg width="${size}" height="${height}" viewBox="0 0 28 37" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M14 0C6.268 0 0 6.268 0 14C0 23.5 14 37 14 37C14 37 28 23.5 28 14C28 6.268 21.732 0 14 0Z" fill="${fill}"/>
    <circle cx="14" cy="14" r="${innerR}" fill="white"/>
  </svg>`;

  return el;
}

/**
 * Create a location marker DOM element showing user's current location.
 * Returns a 28×28 div with an SVG of a pulsing-style blue dot:
 *   - Outer circle: rgba(25, 118, 210, 0.2) fill with #1976D2 stroke
 *   - Inner filled circle: #1976D2
 *   - Small white center dot
 */
export function createLocationMarkerElement(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'cuc-location-marker';
  el.style.width = '28px';
  el.style.height = '28px';
  el.style.cursor = 'default';

  // SVG with outer pulsing circle, inner circle, and center dot
  el.innerHTML = `<svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
    <!-- Outer circle with fill and stroke -->
    <circle cx="14" cy="14" r="11" fill="rgba(25, 118, 210, 0.2)" stroke="#1976D2" stroke-width="1"/>
    <!-- Inner filled circle -->
    <circle cx="14" cy="14" r="6" fill="#1976D2"/>
    <!-- Center white dot -->
    <circle cx="14" cy="14" r="2" fill="white"/>
  </svg>`;

  return el;
}
