import m from 'mithril';
import { parseCoordinate, searchNominatim, searchPmtiles, type SearchResult } from '../services/search';
import { getMap } from './MapView';

let query = '';
let results: SearchResult[] = [];
let loading = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function closeResults(): void {
  results = [];
  m.redraw();
}

function handleClickOutside(e: MouseEvent): void {
  if (!(e.target as Element).closest('.search-box')) {
    closeResults();
  }
}

async function handleInput(value: string): Promise<void> {
  query = value;
  if (debounceTimer) clearTimeout(debounceTimer);

  if (!value.trim()) {
    results = [];
    m.redraw();
    return;
  }

  // Coordinate: instant result, no network
  const coord = parseCoordinate(value);
  if (coord) {
    results = [coord];
    m.redraw();
    return;
  }

  debounceTimer = setTimeout(async () => {
    loading = true;
    m.redraw();

    try {
      if (navigator.onLine) {
        results = await searchNominatim(value);
      }
      // Supplement with PMTiles results when offline or Nominatim returned nothing
      const map = getMap();
      if (map && (!navigator.onLine || results.length === 0)) {
        const pmResults = searchPmtiles(map, value);
        results = [...results, ...pmResults].slice(0, 5);
      }
    } catch {
      const map = getMap();
      if (map) results = searchPmtiles(map, value);
      else results = [];
    } finally {
      loading = false;
      m.redraw();
    }
  }, 300);
}

function flyToResult(r: SearchResult): void {
  const map = getMap();
  if (!map) return;

  if (r.bbox) {
    map.fitBounds(r.bbox, { padding: 40, maxZoom: 16 });
  } else {
    map.flyTo({ center: [r.lon, r.lat], zoom: 14 });
  }

  results = [];
  query = r.source === 'coordinate' ? r.label : query;
  m.redraw();
}

export const SearchBox: m.ClosureComponent = () => ({
  oncreate() {
    document.addEventListener('click', handleClickOutside);
  },
  onremove() {
    document.removeEventListener('click', handleClickOutside);
    if (debounceTimer) clearTimeout(debounceTimer);
    query = '';
    results = [];
  },
  view() {
    const truncate = (s: string) => (s.length > 60 ? s.slice(0, 60) + '…' : s);

    return m('div.search-box', [
      m('input', {
        type: 'text',
        placeholder: 'Search place or lat, lon…',
        value: query,
        oninput: (e: InputEvent) => handleInput((e.target as HTMLInputElement).value),
        onkeydown: (e: KeyboardEvent) => {
          if (e.key === 'Escape') { results = []; m.redraw(); }
          if (e.key === 'Enter' && results.length === 1) flyToResult(results[0]);
        },
      }),
      (loading || results.length > 0) && m('div.search-results', [
        loading
          ? m('div.search-result-item', 'Searching…')
          : results.map((r) =>
              m('div.search-result-item', { onclick: () => flyToResult(r) }, [
                truncate(r.label),
                r.sublabel && m('small', r.sublabel),
              ])
            ),
      ]),
    ]);
  },
});
