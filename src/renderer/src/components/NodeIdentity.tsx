import { memo } from 'react';
import { FontAwesomeIcon, faLocationDot, faUser, faCircleCheck } from '../icons';

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
  registered: boolean;
  heardMdc?: string | null;
}


/** The compact node-identity card (Transceive-style) — who *you* are on the network. */
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
  registered,
  heardMdc,
}: NodeIdentityProps) {
  // The big line already shows the callsign in guest mode, so only add it to the
  // meta row in node mode — no repeating it three times across the card.
  const who = guest ? operatorName : [callsign, operatorName].filter(Boolean).join(', ');
  return (
    <section className="relative overflow-hidden rounded-2xl bg-primary p-4 text-white shadow-card">
      {/* keyed bar: green when receiving, red when transmitting */}
      <div
        className={`absolute inset-x-0 top-0 h-1 transition-opacity ${
          transmitting ? 'bg-red-400 opacity-100' : receiving ? 'bg-green-400 opacity-100' : 'opacity-0'
        }`}
      />

      <div className="flex items-center justify-between gap-2">
        <span
          className={`rounded-md px-2 py-0.5 text-xs font-bold tracking-wide transition ${
            transmitting ? 'bg-white text-red-600' : 'bg-white/15 text-white/70'
          }`}
        >
          PTT
        </span>
        {guest ? (
          <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-semibold">Guest</span>
        ) : registered ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-semibold" title="Registered with AllStarLink">
            <FontAwesomeIcon icon={faCircleCheck} /> Registered
          </span>
        ) : (
          <span className="rounded-full bg-black/20 px-2.5 py-0.5 text-xs font-medium text-white/70" title="Not registered with AllStarLink">
            Not registered
          </span>
        )}
      </div>

      <div className="mt-1 flex items-baseline justify-center gap-2">
        <span className="text-3xl font-bold leading-none tabular-nums tracking-tight">{node || '—'}</span>
      </div>
      <div className="text-center text-xs text-white/80">
        {description || (guest ? 'Web Transceiver' : 'Radioless Node')}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-0.5 text-xs text-white/90">
        {location && (
          <span className="inline-flex items-center gap-1.5">
            <FontAwesomeIcon icon={faLocationDot} className="text-white/60" />
            {location}
          </span>
        )}
        {who && (
          <span className="inline-flex items-center gap-1.5">
            <FontAwesomeIcon icon={faUser} className="text-white/60" />
            {who}
          </span>
        )}
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2 text-xs">
        <span className="truncate rounded-full bg-white/15 px-2.5 py-1 font-medium">{state}</span>
        <div className="flex shrink-0 items-center gap-2">
          {heardMdc && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-300 px-2.5 py-1 font-semibold text-amber-950">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-700" />
              MDC {heardMdc}
            </span>
          )}
          <span className="rounded-full bg-white/15 px-2.5 py-1 font-medium">
            {linkedCount === 1 ? '1 link' : `${linkedCount} links`}
          </span>
        </div>
      </div>
    </section>
  );
});
