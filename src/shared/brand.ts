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
  /** Default accent color (#rrggbb) applied when the operator hasn't set one. */
  accent?: string;
}

const BRANDS: Record<string, Brand> = {
  kerchunk: {
    id: 'kerchunk',
    name: 'Kerchunk',
    tagline: 'Self-contained AllStar node',
    defaultSavedNodes: [],
  },
  tara: {
    id: 'tara',
    name: 'TARA Kerchunk',
    tagline: 'Tennessee Amateur Radio Association',
    defaultSavedNodes: [
      { number: '610750', note: 'TARA TAC', description: 'TARA TAC System', permanent: true },
      { number: '610751', note: 'TARA West', description: 'West TN repeaters & nodes' },
      { number: '610752', note: 'TARA East', description: 'East TN repeaters & nodes' },
    ],
    // TARA logo palette: navy #183048 (primary) with red #a81818 accents.
    accent: '#183048',
  },
};

const brandId = typeof __BRAND__ !== 'undefined' ? __BRAND__ : 'kerchunk';

/** The active brand for this build. */
export const BRAND: Brand = BRANDS[brandId] ?? BRANDS.kerchunk;
