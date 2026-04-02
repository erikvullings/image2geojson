import type maplibregl from 'maplibre-gl';

export interface SearchResult {
  label: string;
  sublabel?: string;
  lat: number;
  lon: number;
  bbox?: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  source: 'coordinate' | 'nominatim' | 'pmtiles';
}

export function parseCoordinate(query: string): SearchResult | null {
  const num = '-?\\d+(?:\\.\\d+)?';
  const sep = '[,\\s]+';
  const re = new RegExp(`^\\s*(${num})${sep}(${num})\\s*$`);
  const match = query.match(re);
  if (!match) return null;

  let a = parseFloat(match[1]);
  let b = parseFloat(match[2]);

  // Swap if first value looks like a longitude (abs > 90) and second is valid lat
  if (Math.abs(a) > 90 && Math.abs(b) <= 90) {
    [a, b] = [b, a];
  }

  // Validate ranges
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return null;

  return {
    label: `${a.toFixed(5)}, ${b.toFixed(5)}`,
    sublabel: 'Coordinate',
    lat: a,
    lon: b,
    source: 'coordinate',
  };
}

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
  boundingbox: [string, string, string, string]; // [minLat, maxLat, minLon, maxLon]
}

let abortController: AbortController | null = null;

export async function searchNominatim(query: string): Promise<SearchResult[]> {
  abortController?.abort();
  abortController = new AbortController();

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=0`;
    const res = await fetch(url, {
      signal: abortController.signal,
      headers: { 'User-Agent': 'image2geojson/1.0' },
    });
    const data: NominatimResult[] = await res.json();
    return data.map((r) => {
      const [minLat, maxLat, minLon, maxLon] = r.boundingbox;
      return {
        label: r.display_name,
        lat: parseFloat(r.lat),
        lon: parseFloat(r.lon),
        bbox: [parseFloat(minLon), parseFloat(minLat), parseFloat(maxLon), parseFloat(maxLat)],
        source: 'nominatim' as const,
      };
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') return [];
    throw e;
  }
}

export function searchPmtiles(map: maplibregl.Map, query: string): SearchResult[] {
  const q = query.toLowerCase();
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  const style = map.getStyle();
  if (!style?.sources) return results;

  for (const sourceId of Object.keys(style.sources)) {
    const src = style.sources[sourceId];
    if (src.type !== 'vector') continue;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const features = map.querySourceFeatures(sourceId, {
        sourceLayer: 'place',
        filter: ['in', q, ['downcase', ['coalesce', ['get', 'name:latin'], ['get', 'name'], '']]] as any,
      });

      for (const f of features) {
        if (results.length >= 5) break;
        const name = (f.properties?.['name:latin'] ?? f.properties?.['name']) as string | undefined;
        if (!name) continue;
        const key = `${name.toLowerCase()}|${sourceId}`;
        if (seen.has(key)) continue;
        seen.add(key);

        if (f.geometry.type !== 'Point') continue;
        const [lon, lat] = f.geometry.coordinates as [number, number];
        const cls = f.properties?.['class'] as string | undefined;

        results.push({
          label: name,
          sublabel: cls ? `${cls} (PMTiles)` : 'PMTiles',
          lat,
          lon,
          source: 'pmtiles',
        });
      }
    } catch {
      // Source may not have this layer — skip silently
    }
  }

  return results;
}
