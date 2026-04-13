import { PMTiles } from 'pmtiles';
import type { CustomTileType } from '../state/types';

type PMTilesHeader = Awaited<ReturnType<PMTiles['getHeader']>>;

const localPmtilesRegistry = new Map<string, PMTiles>();

export type PMTilesBounds = [number, number, number, number];

export function rememberLocalPmtiles(name: string, pmtiles: PMTiles): void {
  localPmtilesRegistry.set(name, pmtiles);
}

function resolvePmtiles(source: string | PMTiles): PMTiles {
  if (typeof source !== 'string') return source;
  return localPmtilesRegistry.get(source) ?? new PMTiles(source);
}

export function getPmtilesBounds(header: PMTilesHeader): PMTilesBounds | null {
  if (header.minLon >= header.maxLon || header.minLat >= header.maxLat) return null;
  return [header.minLon, header.minLat, header.maxLon, header.maxLat];
}

export async function inspectPmtiles(source: string | PMTiles): Promise<{
  bounds: PMTilesBounds | null;
  customType: CustomTileType;
  header: PMTilesHeader;
}> {
  const pmtiles = resolvePmtiles(source);
  const header = await pmtiles.getHeader();
  return {
    header,
    bounds: getPmtilesBounds(header),
    customType: header.tileType === 1 ? 'pmtiles-vector' : 'pmtiles-raster',
  };
}
