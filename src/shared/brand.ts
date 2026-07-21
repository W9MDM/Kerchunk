import type { SavedNode } from './ipc';

// Injected by electron-vite `define` at build time (see electron.vite.config.ts).
// Guarded with typeof so non-bundled contexts (e.g. vitest) fall back safely.
declare const __BRAND__: string;

export interface Brand {
  id: string;
  /** Display name (in-app header, window title). Also drives installer productName. */
  name: string;
  tagline: string;
  /** Saved nodes seeded on first run for this brand. */
  defaultSavedNodes: SavedNode[];
}

const BRANDS: Record<string, Brand> = {
  kerchunk: {
    id: 'kerchunk',
    name: 'Kerchunk',
    tagline: 'Self-contained AllStar node',
    defaultSavedNodes: [],
  },
  tnara: {
    id: 'tnara',
    name: 'TNARA TAC',
    tagline: 'Tennessee Amateur Radio Association',
    defaultSavedNodes: [{ number: '610750', note: 'TNARA TAC', description: 'TNARA TAC System', permanent: true }],
  },
};

const brandId = typeof __BRAND__ !== 'undefined' ? __BRAND__ : 'kerchunk';

/** The active brand for this build. */
export const BRAND: Brand = BRANDS[brandId] ?? BRANDS.kerchunk;
