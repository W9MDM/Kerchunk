import { useEffect, useState } from 'react';
import { FontAwesomeIcon, faMicrophone, faXmark, faGripVertical, faVolumeHigh, faVolumeXmark } from '../icons';

/**
 * The floating, always-on-top PTT button. Runs in its own frameless/transparent
 * window; button presses are relayed to the main window (which owns the mic).
 */
export function Overlay() {
  const [transmitting, setTransmitting] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    // Reflect the real transmit + receive + mute state (covers hotkey / main PTT).
    const disposers = [
      window.electronAPI.onOverlayTx((on) => setTransmitting(on)),
      window.electronAPI.onOverlayRx((on) => setReceiving(on)),
      window.electronAPI.onOverlayMuted((on) => setMuted(on)),
    ];
    return () => disposers.forEach((d) => d());
  }, []);

  const press = () => window.electronAPI.overlayPtt(true);
  const release = () => window.electronAPI.overlayPtt(false);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#171719] p-1.5 text-white">
      {/* Drag strip — this whole bar moves the window (marked app-region: drag) */}
      <div
        className="flex items-center justify-between px-1 pb-1"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-white/50">
          <FontAwesomeIcon icon={faGripVertical} /> Kerchunk
          {receiving && (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-500/20 px-1.5 text-green-400" title="Receiving">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" /> RX
            </span>
          )}
        </span>
        <span className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            onClick={() => window.electronAPI.overlayMute()}
            title={muted ? 'Unmute' : 'Mute'}
            aria-label={muted ? 'Unmute' : 'Mute'}
            className={`rounded px-1 transition ${muted ? 'text-red-400' : 'text-white/50 hover:text-white'}`}
          >
            <FontAwesomeIcon icon={muted ? faVolumeXmark : faVolumeHigh} />
          </button>
          <button
            onClick={() => window.electronAPI.setOverlayVisible(false)}
            title="Hide floating PTT"
            aria-label="Hide floating PTT"
            className="rounded px-1 text-white/50 transition hover:text-white"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </span>
      </div>

      <button
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          press();
        }}
        onPointerUp={release}
        onPointerCancel={release}
        title="Push to talk"
        aria-label="Push to talk"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className={`flex flex-1 select-none items-center justify-center gap-2 rounded-xl text-sm font-semibold transition ${
          transmitting ? 'bg-red-500 text-white shadow-lg' : 'bg-white/10 text-white hover:bg-white/20'
        }`}
      >
        <FontAwesomeIcon icon={faMicrophone} />
        {transmitting ? 'On Air' : 'PTT'}
      </button>
    </div>
  );
}
