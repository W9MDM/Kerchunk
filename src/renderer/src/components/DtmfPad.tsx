import { useState } from 'react';
import { FontAwesomeIcon, faPaperPlane, faKeyboard } from '../icons';

interface DtmfPadProps {
  connected: boolean;
  onSend: (digits: string) => void;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

/** DTMF command sender — type or tap a sequence and send it to the linked node. */
export function DtmfPad({ connected, onSend }: DtmfPadProps) {
  const [open, setOpen] = useState(false);
  const [seq, setSeq] = useState('');

  const send = () => {
    const digits = seq.trim();
    if (digits) onSend(digits);
    setSeq('');
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between text-sm font-semibold">
        <span className="flex items-center gap-2">
          <FontAwesomeIcon icon={faKeyboard} className="text-muted-foreground" /> DTMF commands
        </span>
        <span className="text-xs text-muted-foreground">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <div className="mt-3">
          <div className="flex gap-2">
            <input
              value={seq}
              onChange={(e) => setSeq(e.target.value.replace(/[^0-9A-Da-d*#]/g, '').toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') send();
              }}
              placeholder="e.g. *3 1998 to connect"
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
            />
            <button
              onClick={send}
              disabled={!connected || !seq}
              title={connected ? 'Send these DTMF tones to the linked node(s)' : 'Link a node first'}
              aria-label="Send DTMF"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
            >
              <FontAwesomeIcon icon={faPaperPlane} />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            {KEYS.map((k) => (
              <button
                key={k}
                onClick={() => setSeq((s) => s + k)}
                className="rounded-lg border border-border bg-background py-3 text-lg font-medium tabular-nums transition hover:bg-accent"
              >
                {k}
              </button>
            ))}
          </div>

          {!connected && <p className="mt-2 text-xs text-muted-foreground">Link a node to send DTMF commands.</p>}
        </div>
      )}
    </section>
  );
}
