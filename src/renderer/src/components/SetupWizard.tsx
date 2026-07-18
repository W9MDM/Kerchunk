import { useEffect, useState } from 'react';
import type { NodeSettings } from '../../../shared/ipc';
import {
  FontAwesomeIcon,
  faTowerBroadcast,
  faHeadset,
  faUser,
  faVolumeHigh,
  faCircleCheck,
  faMicrophone,
} from '../icons';

export interface SetupInitial {
  mode: 'node' | 'guest';
  myNode: string;
  secret: string;
  operatorName: string;
  callsign: string;
  wtPassword: string;
  audioInput: string;
  audioOutput: string;
  ttsEnabled: boolean;
}

interface SetupWizardProps {
  open: boolean;
  initial: SetupInitial;
  onFinish: (values: Partial<NodeSettings>) => void;
  onSkip: () => void;
}

const inputClass =
  'w-full min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition ' +
  'placeholder:text-muted-foreground/70 focus:border-ring focus:ring-2 focus:ring-ring/30';
const sectionLabel = 'mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground';

const STEPS = ['Welcome', 'Credentials', 'Audio', 'Done'];

/** First-run onboarding: collect mode, credentials, and audio step by step. */
export function SetupWizard({ open, initial, onFinish, onSkip }: SetupWizardProps) {
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<'node' | 'guest'>(initial.mode);
  const [myNode, setMyNode] = useState(initial.myNode);
  const [secret, setSecret] = useState(initial.secret);
  const [operatorName, setOperatorName] = useState(initial.operatorName);
  const [callsign, setCallsign] = useState(initial.callsign);
  const [wtPassword, setWtPassword] = useState(initial.wtPassword);
  const [audioInput, setAudioInput] = useState(initial.audioInput);
  const [audioOutput, setAudioOutput] = useState(initial.audioOutput);
  const [ttsEnabled, setTtsEnabled] = useState(initial.ttsEnabled);
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);

  // Reset to the first step and re-sync fields whenever the wizard is (re)opened.
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setMode(initial.mode);
    setMyNode(initial.myNode);
    setSecret(initial.secret);
    setOperatorName(initial.operatorName);
    setCallsign(initial.callsign);
    setWtPassword(initial.wtPassword);
    setAudioInput(initial.audioInput);
    setAudioOutput(initial.audioOutput);
    setTtsEnabled(initial.ttsEnabled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Enumerate audio devices when the audio step is reached (needs mic permission,
  // so request it once up front — labels are blank until granted).
  useEffect(() => {
    if (!open || step !== 2 || !navigator.mediaDevices?.enumerateDevices) return;
    let cancelled = false;
    const load = async () => {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        // permission denied — we'll still list what we can
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (cancelled) return;
      setInputs(devices.filter((d) => d.kind === 'audioinput'));
      setOutputs(devices.filter((d) => d.kind === 'audiooutput'));
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, step]);

  if (!open) return null;

  const credsOk = mode === 'node' ? Boolean(myNode.trim() && secret) : Boolean(callsign.trim() && wtPassword);

  const finish = () => {
    onFinish({
      mode,
      myNode: myNode.trim(),
      secret,
      operatorName: operatorName.trim(),
      callsign: callsign.trim(),
      wtPassword,
      audioInput,
      audioOutput,
      ttsEnabled,
    });
  };

  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm">
      <div className="mt-8 flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-border bg-card p-5 shadow-card">
        {/* Progress */}
        <div className="mb-4 flex items-center gap-1.5">
          {STEPS.map((label, i) => (
            <div key={label} className="flex flex-1 items-center gap-1.5">
              <div
                className={`h-1.5 flex-1 rounded-full transition ${i <= step ? 'bg-primary' : 'bg-muted'}`}
                title={label}
              />
            </div>
          ))}
        </div>
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Step {step + 1} of {STEPS.length} · {STEPS[step]}
        </p>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {step === 0 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Welcome to Kerchunk</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  A self-contained AllStarLink node for your desktop. Let's get you on the air — how do you want to operate?
                </p>
              </div>
              <div className="grid gap-2.5">
                <button
                  onClick={() => setMode('node')}
                  className={`flex items-start gap-3 rounded-xl border p-3 text-left transition ${
                    mode === 'node' ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent'
                  }`}
                >
                  <FontAwesomeIcon icon={faTowerBroadcast} className="mt-0.5 text-primary" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">I have a node number</span>
                    <span className="block text-xs text-muted-foreground">Operate as your registered AllStarLink node.</span>
                  </span>
                  {mode === 'node' && <FontAwesomeIcon icon={faCircleCheck} className="ml-auto text-primary" />}
                </button>
                <button
                  onClick={() => setMode('guest')}
                  className={`flex items-start gap-3 rounded-xl border p-3 text-left transition ${
                    mode === 'guest' ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent'
                  }`}
                >
                  <FontAwesomeIcon icon={faHeadset} className="mt-0.5 text-primary" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">I have a callsign (Web Transceiver)</span>
                    <span className="block text-xs text-muted-foreground">No node number needed — use a free allstarlink.org portal account.</span>
                  </span>
                  {mode === 'guest' && <FontAwesomeIcon icon={faCircleCheck} className="ml-auto text-primary" />}
                </button>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              {mode === 'node' ? (
                <div>
                  <h3 className={sectionLabel}>
                    <FontAwesomeIcon icon={faUser} className="mr-1.5" /> Your node
                  </h3>
                  <div className="grid gap-2.5">
                    <input value={myNode} onChange={(e) => setMyNode(e.target.value)} inputMode="numeric" className={inputClass} placeholder="AllStarLink node number" />
                    <input value={secret} onChange={(e) => setSecret(e.target.value)} type="password" className={inputClass} placeholder="Node secret" />
                    <input value={operatorName} onChange={(e) => setOperatorName(e.target.value)} className={inputClass} placeholder="Your name (shown on the node card)" />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">Kerchunk registers this node with AllStarLink so links are accepted.</p>
                </div>
              ) : (
                <div>
                  <h3 className={sectionLabel}>
                    <FontAwesomeIcon icon={faHeadset} className="mr-1.5" /> Web Transceiver
                  </h3>
                  <div className="grid gap-2.5">
                    <input value={callsign} onChange={(e) => setCallsign(e.target.value)} className={inputClass} placeholder="Your callsign (portal login)" />
                    <input value={wtPassword} onChange={(e) => setWtPassword(e.target.value)} type="password" className={inputClass} placeholder="allstarlink.org portal password" />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">Kerchunk fetches a per-node session token from the portal to connect as a guest.</p>
                </div>
              )}
              {!credsOk && <p className="text-xs text-warning">Fill both fields to continue — or skip and add them later in Settings.</p>}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h3 className={sectionLabel}>
                  <FontAwesomeIcon icon={faMicrophone} className="mr-1.5" /> Microphone
                </h3>
                <select value={audioInput} onChange={(e) => setAudioInput(e.target.value)} className={inputClass}>
                  <option value="">System default</option>
                  {inputs.map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>
                  ))}
                </select>
              </div>
              <div>
                <h3 className={sectionLabel}>
                  <FontAwesomeIcon icon={faVolumeHigh} className="mr-1.5" /> Speaker
                </h3>
                <select value={audioOutput} onChange={(e) => setAudioOutput(e.target.value)} className={inputClass}>
                  <option value="">System default</option>
                  {outputs.map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Speaker ${i + 1}`}</option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" checked={ttsEnabled} onChange={(e) => setTtsEnabled(e.target.checked)} />
                Speak connect / disconnect announcements
              </label>
              <p className="text-xs text-muted-foreground">You can change any of this later in Settings → Audio.</p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2 text-base font-semibold">
                <FontAwesomeIcon icon={faCircleCheck} className="text-connected" /> You're all set
              </div>
              <ul className="space-y-1.5 text-muted-foreground">
                <li>Mode: <span className="font-medium text-foreground">{mode === 'node' ? 'Node' : 'Web Transceiver'}</span></li>
                <li>
                  {mode === 'node' ? 'Node number' : 'Callsign'}:{' '}
                  <span className="font-medium text-foreground">{mode === 'node' ? myNode || '—' : callsign || '—'}</span>
                </li>
              </ul>
              <p className="text-xs text-muted-foreground">
                {mode === 'node' && credsOk
                  ? "Finishing will register your node with AllStarLink."
                  : 'Use the node directory (📡) to find a node and press Link.'}
              </p>
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-4">
          <button onClick={onSkip} className="text-xs font-medium text-muted-foreground hover:text-foreground">
            Skip setup
          </button>
          <div className="flex gap-2">
            {step > 0 && (
              <button onClick={back} className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium transition hover:bg-accent">
                Back
              </button>
            )}
            {step < STEPS.length - 1 ? (
              <button
                onClick={next}
                disabled={step === 1 && !credsOk}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-40"
              >
                Next
              </button>
            ) : (
              <button onClick={finish} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90">
                Finish
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
