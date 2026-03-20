// ---------------------------------------------------------------------------
// MapView.tsx
// Full-screen Mapbox GL map with GeoJSON-based clustering.
//
// Architecture:
//   - All permit parcels are loaded into a single GeoJSON source with
//     cluster: true.  Mapbox handles the spatial aggregation natively in
//     WebGL — fast even at 50 k+ points.
//
//   - Four layers sit on top of that source:
//       clusters-halo   — outer diffuse ring, ~22% opacity
//       clusters-fill   — inner solid-ish circle, ~65% opacity
//       cluster-count   — white count label centred in the fill circle
//       unclustered-point — individual circle, data-driven: blue / dark-blue
//
//   - The user-location dot is kept as an HTML Marker (single point, not
//     part of permit data).
//
//   - Selected state is encoded as a GeoJSON feature property (isSelected: 1)
//     so Mapbox's data-driven paint handles the colour/size change without
//     re-creating any DOM elements.
//
// Deferred (v2 polish pass):
//   - Teardrop SVG sprite to replace circle pins
//   - Amber "saved" state on the map (bookmarks still work in the sheet)
//   - Heatmap layer at city scale (zoom < 11)
// ---------------------------------------------------------------------------

import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import type { Parcel } from '../types';
import { createLocationMarkerElement } from '../utils/mapMarkers';
import { track, AnalyticsEvents } from '../services/analytics';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MapViewProps {
  parcels: Parcel[];
  selectedParcelId: string | null;
  savedParcelIds?: Set<string>; // reserved for v2 amber saved-state
  userLocation?: [number, number] | null; // [lng, lat]
  onMarkerClick: (parcel: Parcel) => void;
  /** Exposed so App.tsx can call map.flyTo from search results. */
  onMapReady?: (map: mapboxgl.Map) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NYC_CENTER: [number, number] = [-74.006, 40.7128];
const NYC_ZOOM = 12;

const SOURCE_ID = 'parcels';
const LAYER_CLUSTER_HALO  = 'clusters-halo';
const LAYER_CLUSTER_FILL  = 'clusters-fill';
const LAYER_CLUSTER_COUNT = 'cluster-count';
const LAYER_POINTS        = 'unclustered-point';

// Brand palette — kept in sync with the rest of the design system
const BLUE_DEFAULT        = '#0062CF'; // unsaved parcel
const BLUE_SELECTED       = '#004BA0'; // selected, unsaved (darker)
const ORANGE_SAVED        = '#EB6800'; // saved parcel
const ORANGE_SAVED_SELECT = '#C45200'; // selected + saved (darker)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive the marker state for a parcel.
 * Four mutually exclusive states drive the data-driven paint expressions:
 *   "selected"       — tapped parcel, not bookmarked
 *   "saved"          — bookmarked, not currently selected
 *   "selected-saved" — tapped AND bookmarked
 *   "default"        — neither
 */
function markerState(
  parcelId: string,
  selectedParcelId: string | null,
  savedParcelIds: Set<string>,
): string {
  const sel   = parcelId === selectedParcelId;
  const saved = savedParcelIds.has(parcelId);
  if (sel && saved) return 'selected-saved';
  if (sel)          return 'selected';
  if (saved)        return 'saved';
  return 'default';
}

/**
 * Build a GeoJSON FeatureCollection from parcels.
 * State is encoded as a string property so Mapbox match expressions
 * can drive colour and size without any DOM manipulation.
 */
function buildGeoJSON(
  parcels: Parcel[],
  selectedParcelId: string | null,
  savedParcelIds: Set<string>,
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: parcels.map((p) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [p.longitude, p.latitude],
      },
      properties: {
        parcelId: p.parcelId,
        state: markerState(p.parcelId, selectedParcelId, savedParcelIds),
      },
    })),
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MapView({
  parcels,
  selectedParcelId,
  savedParcelIds = new Set<string>(),
  userLocation,
  onMarkerClick,
  onMapReady,
}: MapViewProps) {
  const containerRef       = useRef<HTMLDivElement>(null);
  const mapRef             = useRef<mapboxgl.Map | null>(null);
  const locationMarkerRef  = useRef<mapboxgl.Marker | null>(null);

  // Refs so that event handlers registered at load-time always see current props
  const parcelsRef          = useRef<Parcel[]>(parcels);
  const selectedParcelIdRef = useRef<string | null>(selectedParcelId);
  const savedParcelIdsRef   = useRef<Set<string>>(savedParcelIds);
  const onMarkerClickRef    = useRef<(parcel: Parcel) => void>(onMarkerClick);

  // Keep refs in sync on every render
  parcelsRef.current        = parcels;
  selectedParcelIdRef.current = selectedParcelId;
  savedParcelIdsRef.current = savedParcelIds;
  onMarkerClickRef.current  = onMarkerClick;

  // ---- Initialise map + layers --------------------------------------------
  useEffect(() => {
    const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string | undefined;

    if (!containerRef.current) return;
    if (!token) {
      console.warn('[MapView] Mapbox token not set — map will not load.');
      return;
    }

    mapboxgl.accessToken = token;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: NYC_CENTER,
      zoom: NYC_ZOOM,
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    map.on('load', () => {
      track(AnalyticsEvents.MAP_VIEW_LOADED);

      // -- GeoJSON source with native Mapbox clustering ----------------------
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: buildGeoJSON(parcelsRef.current, selectedParcelIdRef.current, savedParcelIdsRef.current),
        cluster: true,
        clusterMaxZoom: 14,  // individual pins appear above zoom 14
        clusterRadius: 50,   // px — controls how aggressively nearby points merge
        // Roll up saved count from individual points to cluster level.
        // Any cluster containing at least one saved parcel gets savedCount > 0,
        // which drives the orange colour expression on both cluster layers.
        clusterProperties: {
          savedCount: [
            ['+', ['accumulated'], ['get', 'savedCount']],
            ['case',
              ['any',
                ['==', ['get', 'state'], 'saved'],
                ['==', ['get', 'state'], 'selected-saved'],
              ],
              1, 0,
            ],
          ],
        },
      });

      // -- Cluster outer halo (diffuse, ~22% opacity) ------------------------
      // Larger than the fill circle to create a soft glow effect.
      // Three size tiers based on point_count so big clusters read as heavier.
      // Colour flips to orange if any saved parcel is inside the cluster.
      map.addLayer({
        id: LAYER_CLUSTER_HALO,
        type: 'circle',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': ['case', ['>', ['get', 'savedCount'], 0], ORANGE_SAVED, BLUE_DEFAULT],
          'circle-opacity': 0.22,
          'circle-radius': [
            'step', ['get', 'point_count'],
            26,          // radius for count < 10
            10,  34,     // radius for count 10–99
            100, 44,     // radius for count 100+
          ],
        },
      });

      // -- Cluster inner fill (~65% opacity) ---------------------------------
      map.addLayer({
        id: LAYER_CLUSTER_FILL,
        type: 'circle',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': ['case', ['>', ['get', 'savedCount'], 0], ORANGE_SAVED, BLUE_DEFAULT],
          'circle-opacity': 0.65,
          'circle-radius': [
            'step', ['get', 'point_count'],
            18,
            10,  24,
            100, 32,
          ],
        },
      });

      // -- Cluster count label -----------------------------------------------
      map.addLayer({
        id: LAYER_CLUSTER_COUNT,
        type: 'symbol',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
          'text-size': 13,
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': '#ffffff',
        },
      });

      // -- Individual unclustered points ------------------------------------
      // Four states via data-driven match expressions:
      //   selected       → larger, darker blue
      //   saved          → orange
      //   selected-saved → larger, darker orange
      //   default        → standard blue
      map.addLayer({
        id: LAYER_POINTS,
        type: 'circle',
        source: SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': [
            'match', ['get', 'state'],
            'selected',       BLUE_SELECTED,
            'saved',          ORANGE_SAVED,
            'selected-saved', ORANGE_SAVED_SELECT,
            BLUE_DEFAULT,
          ],
          'circle-radius': [
            'match', ['get', 'state'],
            'selected',       9,
            'selected-saved', 9,
            6,
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 1,
        },
      });

      // -- Cluster click: zoom in until the cluster breaks apart -------------
      map.on('click', LAYER_CLUSTER_FILL, (e) => {
        const features = map.queryRenderedFeatures(e.point, {
          layers: [LAYER_CLUSTER_FILL],
        });
        if (!features.length) return;

        const clusterId = features[0].properties?.cluster_id as number;
        const source = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource;
        source.getClusterExpansionZoom(clusterId, (err, zoom) => {
          if (err || zoom == null) return;
          const coords = (
            features[0].geometry as GeoJSON.Point
          ).coordinates as [number, number];
          map.easeTo({ center: coords, zoom: zoom + 0.5 });
        });
      });

      // -- Individual point click: open detail sheet ------------------------
      map.on('click', LAYER_POINTS, (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const parcelId = feature.properties?.parcelId as string;
        const parcel = parcelsRef.current.find((p) => p.parcelId === parcelId);
        if (parcel) onMarkerClickRef.current(parcel);
      });

      // -- Pointer cursor on hover ------------------------------------------
      const setCursor = (cursor: string) => () => {
        map.getCanvas().style.cursor = cursor;
      };
      map.on('mouseenter', LAYER_CLUSTER_FILL, setCursor('pointer'));
      map.on('mouseleave', LAYER_CLUSTER_FILL, setCursor(''));
      map.on('mouseenter', LAYER_POINTS,       setCursor('pointer'));
      map.on('mouseleave', LAYER_POINTS,       setCursor(''));
    });

    mapRef.current = map;
    onMapReady?.(map);

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Update GeoJSON source when parcels or selection changes ------------
  // Race-condition safe: if the map style isn't loaded yet the update is
  // queued for the load event (the load handler uses parcelsRef so it will
  // pick up the latest data regardless).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const update = () => {
      const source = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
      if (source) {
        source.setData(buildGeoJSON(parcels, selectedParcelId, savedParcelIds));
      }
    };

    if (map.isStyleLoaded()) {
      update();
    } else {
      map.once('load', update);
    }
  }, [parcels, selectedParcelId, savedParcelIds]);

  // ---- User location marker (HTML Marker — not part of clustering) --------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (locationMarkerRef.current) {
      locationMarkerRef.current.remove();
      locationMarkerRef.current = null;
    }

    if (userLocation) {
      const el = createLocationMarkerElement();
      locationMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat(userLocation)
        .addTo(map);
    }
  }, [userLocation]);

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
    </div>
  );
}
