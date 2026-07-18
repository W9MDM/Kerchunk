import { memo } from 'react';

interface NodeIdentityProps {
  node: string;
  callsign?: string;
  description?: string;
  location?: string;
  operatorName?: string;
  linkedCount: number;
  state: string;
  transmitting: boolean;
  receiving: boolean;
  guest: boolean;
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  );
}

/** The big node-identity card (Transceive-style) — who *you* are on the network. */
export const NodeIdentity = memo(function NodeIdentity({
  node,
  callsign,
  description,
  location,
  operatorName,
  linkedCount,
  state,
  transmitting,
  receiving,
  guest,
}: NodeIdentityProps) {
  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#3d7bf4] to-[#2f5fe0] p-5 text-white shadow-card">
      {/* keyed bar: green when receiving, red when transmitting */}
      <div
        className={`absolute inset-x-0 top-0 h-1 transition-opacity ${
          transmitting ? 'bg-red-400 opacity-100' : receiving ? 'bg-green-400 opacity-100' : 'opacity-0'
        }`}
      />

      <div className="flex items-start justify-between">
        <span
          className={`rounded-md px-2 py-0.5 text-xs font-bold tracking-wide transition ${
            transmitting ? 'bg-white text-red-600' : 'bg-white/15 text-white/70'
          }`}
        >
          PTT
        </span>
        <span className="text-sm font-semibold">{callsign ?? (guest ? 'Guest' : '')}</span>
      </div>

      <div className="mt-1 text-center">
        <div className="text-4xl font-bold tabular-nums tracking-tight">{node || '—'}</div>
        <div className="text-sm text-white/80">{description || (guest ? 'Web Transceiver' : 'Radioless Node')}</div>
      </div>

      <div className="mt-4 space-y-1 text-sm text-white/90">
        {location && (
          <div className="flex items-center gap-2">
            <span className="text-white/60"><PinIcon /></span>
            {location}
          </div>
        )}
        {(callsign || operatorName) && (
          <div className="flex items-center gap-2">
            <span className="text-white/60"><PersonIcon /></span>
            {[callsign, operatorName].filter(Boolean).join(', ')}
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between text-xs">
        <span className="rounded-full bg-white/15 px-2.5 py-1 font-medium">{state}</span>
        <span className="rounded-full bg-white/15 px-2.5 py-1 font-medium">
          {linkedCount === 1 ? '1 link' : `${linkedCount} links`}
        </span>
      </div>
    </section>
  );
});
