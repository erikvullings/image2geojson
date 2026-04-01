import type { Feature, FeatureCollection } from 'geojson';

export function downloadGeoJSON(fc: FeatureCollection, filename = 'overlay.geojson'): void {
  const blob = new Blob([JSON.stringify(fc, null, 2)], { type: 'application/geo+json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function parseGeoJSON(text: string): FeatureCollection | null {
  try {
    const parsed = JSON.parse(text) as { type: string };
    if (parsed.type === 'FeatureCollection') return parsed as FeatureCollection;
    if (parsed.type === 'Feature')
      return { type: 'FeatureCollection', features: [parsed as Feature] };
    return null;
  } catch {
    return null;
  }
}
