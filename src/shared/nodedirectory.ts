/**
 * Parse the AllStarLink node database (astdb.txt from allmondb.allstarlink.org)
 * into directory entries grouped by country/state for the node-picker.
 *
 * Each line is: node|callsign|description|location   (location is free text).
 * Country is inferred from the callsign prefix (reliable); US state is parsed
 * from the location string. Anything we can't place lands in "International".
 */

export interface DirectoryNode {
  node: string;
  callsign: string;
  description: string;
  location: string;
  country: string;
  state: string; // full US state name, or ''
}

const US_STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia', PR: 'Puerto Rico', VI: 'US Virgin Islands', GU: 'Guam',
};

/** Country by callsign prefix — enough of the common ham allocations to bucket well. */
function countryFromCallsign(callsign: string): string | null {
  const c = callsign.trim().toUpperCase();
  if (!c) return null;
  // United States: A, K, N, W (AA–AL, K*, N*, W*)
  if (/^(A[A-L]|[KNW])/.test(c)) return 'United States';
  if (/^(VE|VA|VO|VY|VB|VC|VD|VF|VG|CF|CG|CH|CI|CJ|CK|CY|CZ|XJ|XK|XL|XM|XN|XO)/.test(c)) return 'Canada';
  if (/^(VK|AX)/.test(c)) return 'Australia';
  if (/^(G|M|2[A-Z])/.test(c)) return 'United Kingdom';
  if (/^(D[A-R])/.test(c)) return 'Germany';
  if (/^F/.test(c)) return 'France';
  if (/^(I|IZ|IK|IW)/.test(c)) return 'Italy';
  if (/^(EA|EB|EC|ED|EE|EF|EG|EH)/.test(c)) return 'Spain';
  if (/^(PA|PB|PC|PD|PE|PF|PG|PH|PI)/.test(c)) return 'Netherlands';
  if (/^(J[A-S]|7[K-N]|8[J-N])/.test(c)) return 'Japan';
  if (/^(P[P-Y]|Z[V-Z])/.test(c)) return 'Brazil';
  if (/^(XE|XF|4A|4B|4C|6D|6E|6F|6G|6H|6I|6J)/.test(c)) return 'Mexico';
  if (/^(ZL|ZM)/.test(c)) return 'New Zealand';
  if (/^(EI|EJ)/.test(c)) return 'Ireland';
  if (/^(LA|LB|LC|LD|LE|LF|LG|LH|LI|LJ|LK|LL|LM|LN)/.test(c)) return 'Norway';
  if (/^(SM|SA|SB|SC|SD|SE|SF|SG|SH|SI|SJ|SK|SL|SM)/.test(c)) return 'Sweden';
  if (/^(OE)/.test(c)) return 'Austria';
  if (/^(HB)/.test(c)) return 'Switzerland';
  if (/^(ZS|ZR|ZT|ZU)/.test(c)) return 'South Africa';
  return null;
}

/** Pull a US state out of a free-text location string, or ''. */
function stateFromLocation(location: string): string {
  // Tokens between commas, plus trailing token (state may precede ", US"/zip).
  const parts = location
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  for (const part of parts) {
    // "PA", "PA 19422", "Ohio"
    const code = part.slice(0, 2).toUpperCase();
    if (US_STATES[code] && (part.length === 2 || /^[A-Z]{2}\b/.test(part.toUpperCase()))) {
      return US_STATES[code];
    }
    const full = Object.values(US_STATES).find((n) => n.toLowerCase() === part.toLowerCase());
    if (full) return full;
  }
  return '';
}

export function classifyNode(callsign: string, location: string): { country: string; state: string } {
  const state = stateFromLocation(location);
  let country = countryFromCallsign(callsign);
  if (state && !country) country = 'United States';
  if (!country) {
    if (/united states|u\.?s\.?a?\b/i.test(location)) country = 'United States';
    else if (/canada/i.test(location)) country = 'Canada';
    else country = 'International';
  }
  return { country, state: country === 'United States' ? state : '' };
}

/** Parse the whole astdb.txt into directory entries. */
export function parseAstdb(text: string): DirectoryNode[] {
  const out: DirectoryNode[] = [];
  for (const line of text.split('\n')) {
    const parts = line.split('|');
    if (parts.length < 4) continue;
    const node = parts[0].trim();
    if (!/^[0-9]+$/.test(node)) continue;
    const callsign = parts[1].trim();
    const description = parts[2].trim();
    const location = parts[3].trim();
    const { country, state } = classifyNode(callsign, location);
    out.push({ node, callsign, description, location, country, state });
  }
  return out;
}
