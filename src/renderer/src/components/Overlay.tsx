import { useEffect, useState } from 'react';
import { FontAwesomeIcon, faMicrophone, faXmark, faGripVertical } from '../icons';

/**
 * The floating, always-on-top PTT button. Runs in its own frameless/transparent
 * window; button presses are relayed to the main window (which owns the mic).
 */
export function Overlay() {
  const [transmitting, setTransmitting] = useState(false);

  useEffect(() => {
    // Reflect the real transmit state (also covers hotkey / main-window PTT).
    const dispose = window.electronAPI.onOverlayTx((on) => setTransmitting(on));
    return dispose;
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
        <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-white/50">
          <FontAwesomeIcon icon={faGripVertical} /> Kerchunk
        </span>
        <button
          onClick={() => window.electronAPI.setOverlayVisible(false)}
          title="Hide floating PTT"
          aria-label="Hide floating PTT"
          className="rounded px-1 text-white/50 transition hover:text-white"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <FontAwesomeIcon icon={faXmark} />
        </button>
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
