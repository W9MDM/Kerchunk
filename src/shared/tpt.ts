/**
 * Talk-permit tone definitions. Each tone is a sequence of steps; a step with
 * freq 0 is a silent gap. Durations are in milliseconds. Sequences were measured
 * (unbiased frequency sweep) from reference radio clips and rounded.
 */
export interface TptStep {
  /** Tone frequency in Hz; 0 = silent gap. */
  freq: number;
  /** Duration in milliseconds. */
  ms: number;
}

export interface TptDef {
  id: string;
  label: string;
  steps: TptStep[];
}

const s = (freq: number, ms: number): TptStep => ({ freq, ms });

export const TPT_DEFS: TptDef[] = [
  { id: 'apx', label: 'APX / P25', steps: [s(910, 30), s(0, 20), s(910, 30), s(0, 20), s(910, 50)] },
  { id: 'trbo', label: 'MotoTRBO (Normal)', steps: [s(1570, 40), s(1050, 40), s(1570, 40), s(1320, 40)] },
  // The clear + encrypted reference clips measured frequency-identical (±1 Hz);
  // this variant is nudged ~3% lower to match the "slightly deeper" it's reported
  // to sound like on-air.
  { id: 'trbo-enc', label: 'MotoTRBO (Encrypted)', steps: [s(1520, 40), s(1020, 40), s(1520, 40), s(1280, 40)] },
  { id: 'curve', label: 'Curve PTT', steps: [s(1700, 55), s(0, 20), s(1820, 30), s(0, 20), s(1810, 70)] },
  { id: 'dtr600', label: 'Motorola DTR600', steps: [s(290, 20), s(0, 15), s(1700, 50), s(0, 25), s(1800, 25), s(0, 25), s(1800, 55), s(290, 55)] },
  { id: 'dtr', label: 'Motorola DTR', steps: [s(1800, 45), s(0, 40), s(1800, 45), s(0, 40), s(1800, 50), s(0, 40), s(1800, 90)] },
  { id: 'efj-conv', label: 'EF Johnson (Conventional)', steps: [s(700, 50)] },
  { id: 'efj-trunk', label: 'EF Johnson (Trunked)', steps: [s(1000, 50), s(0, 25), s(1000, 50), s(0, 50), s(1000, 45)] },
  { id: 'harris', label: 'Harris (Clear)', steps: [s(1010, 30)] },
  { id: 'harris-enc', label: 'Harris (Encrypted)', steps: [s(1200, 30)] },
  { id: 'kenwood-nx', label: 'Kenwood NX', steps: [s(1000, 25), s(0, 20), s(1000, 20), s(0, 20), s(1000, 20)] },
  { id: 'kenwood', label: 'Kenwood', steps: [s(1000, 25), s(0, 25), s(1000, 25), s(0, 25), s(1000, 50)] },
  { id: 'kenwood-proceed', label: 'Kenwood (PTT Proceed)', steps: [s(1480, 90)] },
  { id: 'kenwood-release', label: 'Kenwood (PTT Release)', steps: [s(1400, 105)] },
  { id: 'smartconnect', label: 'SmartConnect', steps: [s(1100, 25), s(0, 25), s(900, 25), s(1110, 30)] },
  { id: 'xpr-powerup', label: 'XPR Power-up', steps: [s(780, 200), s(660, 195), s(530, 165), s(0, 2110), s(1050, 100), s(0, 80), s(1050, 80), s(0, 280), s(1050, 60), s(1320, 60), s(1570, 60)] },
];

export const DEFAULT_TPT = 'apx';

/** Steps for a tone id (falls back to the default tone if unknown). */
export function tptSteps(id: string): TptStep[] {
  return (TPT_DEFS.find((d) => d.id === id) ?? TPT_DEFS[0]).steps;
}

/** Short human summary of a tone, e.g. "1570·1050·1570·1320 Hz". */
export function tptSummary(id: string): string {
  const freqs = tptSteps(id).filter((st) => st.freq > 0).map((st) => st.freq);
  return `${freqs.join('·')} Hz`;
}
