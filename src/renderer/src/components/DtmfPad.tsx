import { useState } from 'react';
import type { DtmfCommand } from '../../../shared/ipc';
import { CollapsibleSection } from './CollapsibleSection';
import { FontAwesomeIcon, faPaperPlane, faKeyboard, faFloppyDisk, faTrash } from '../icons';

interface DtmfPadProps {
  connected: boolean;
  onSend: (digits: string) => void;
  commands: DtmfCommand[];
  onAddCommand: (command: DtmfCommand) => void;
  onRemoveCommand: (label: string) => void;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
const clean = (s: string) => s.replace(/[^0-9A-Da-d*#]/g, '').toUpperCase();

/** DTMF command sender — type/tap a sequence, send it, or save it for reuse. */
export function DtmfPad({ connected, onSend, commands, onAddCommand, onRemoveCommand }: DtmfPadProps) {
  const [seq, setSeq] = useState('');
  const [label, setLabel] = useState('');

  const send = (digits: string) => {
    const d = clean(digits);
    if (d) onSend(d);
  };

  const saveCommand = () => {
    const digits = clean(seq);
    const name = label.trim() || digits;
    if (!digits) return;
    onAddCommand({ label: name, digits });
    setLabel('');
  };

  return (
    <CollapsibleSection id="dtmf" title="DTMF commands" icon={faKeyboard} defaultOpen={false}>
      <div className="flex gap-2">
        <input
          value={seq}
          onChange={(e) => setSeq(clean(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              send(seq);
              setSeq('');
            }
          }}
          placeholder="e.g. *3 1998 to connect"
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
        />
        <button
          onClick={() => {
            send(seq);
            setSeq('');
          }}
          disabled={!connected || !seq}
          title={connected ? 'Send these DTMF tones to the linked node(s)' : 'Link a node first'}
          aria-label="Send DTMF"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
        >
          <FontAwesomeIcon icon={faPaperPlane} />
        </button>
      </div>

      {/* Save the current sequence as a reusable command */}
      <div className="mt-2 flex gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Name (e.g. Connect hub) — save this sequence"
          className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
        />
        <button
          onClick={saveCommand}
          disabled={!seq}
          title="Save this sequence as a reusable command"
          aria-label="Save DTMF command"
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-accent disabled:opacity-40"
        >
          <FontAwesomeIcon icon={faFloppyDisk} /> Save
        </button>
      </div>

      {commands.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Saved commands</div>
          <ul className="flex flex-wrap gap-1.5">
            {commands.map((c) => (
              <li key={c.label} className="flex items-center overflow-hidden rounded-full border border-border">
                <button
                  onClick={() => send(c.digits)}
                  disabled={!connected}
                  title={connected ? `Send ${c.digits}` : 'Link a node first'}
                  className="px-3 py-1 text-xs font-medium transition hover:bg-accent disabled:opacity-40"
                >
                  {c.label} <span className="font-mono text-muted-foreground">{c.digits}</span>
                </button>
                <button
                  onClick={() => onRemoveCommand(c.label)}
                  title="Remove command"
                  aria-label={`Remove ${c.label}`}
                  className="border-l border-border px-2 py-1 text-xs text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                >
                  <FontAwesomeIcon icon={faTrash} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

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
    </CollapsibleSection>
  );
}
