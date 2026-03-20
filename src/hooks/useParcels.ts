// ---------------------------------------------------------------------------
// useParcels.ts
// Fetches raw permit data from the NYC API and transforms it into Parcel
// objects using the BBL grouping pipeline.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import type { Parcel } from '../types';
import { fetchPermitRows } from '../services/dataService';
import { groupRowsIntoParcels } from '../services/parcelGrouping';

interface UseParcelsResult {
  parcels: Parcel[];
  /** Parcels with valid lat/lng — safe to place on the map. */
  mappableParcels: Parcel[];
  loading: boolean;
  error: string | null;
}

export function useParcels(): UseParcelsResult {
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const rows = await fetchPermitRows();
        if (cancelled) return;

        const grouped = groupRowsIntoParcels(rows);
        setParcels(grouped);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Map markers: valid coordinates AND at least one active permit.
  // Parcels with only permit history do not appear as markers (Item 5).
  const mappableParcels = parcels.filter(
    (p) => p.latitude !== 0 && p.longitude !== 0 && p.hasActivePermit,
  );

  return { parcels, mappableParcels, loading, error };
}
