import { useEffect, useState } from 'react';
import { baseVoice } from '../../kino.ts';
import { api, errorText, type Provider, type ProjectSettings, type Settings } from '../api.ts';
import { narration, rebuild } from '../engine.ts';
import { useStore } from '../store.ts';

const PROVIDERS: { id: Provider; name: string; hint: string }[] = [
  { id: 'local', name: 'Local server (Kitten TTS)', hint: 'AI voices on this machine: npm run tts' },
  { id: 'elevenlabs', name: 'ElevenLabs', hint: 'Hosted AI voices (API key)' },
  { id: 'openai', name: 'OpenAI', hint: 'Hosted AI voices (API key), or any OpenAI-compatible server' },
  { id: 'espeak', name: 'eSpeak NG', hint: 'Classic robotic synthesizer, offline and instant' },
  { id: 'festival', name: 'Festival', hint: 'Classic synthesizer, offline' },
];
const providerName = (id: string) => PROVIDERS.find((p) => p.id === id)?.name ?? id;

/** suggestions per provider; any value can be typed */
const MODELS: Partial<Record<Provider, string[]>> = {
  local: ['KittenML/kitten-tts-2', 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice'],
  elevenlabs: ['eleven_multilingual_v2', 'eleven_v3', 'eleven_flash_v2_5', 'eleven_turbo_v2_5'],
  openai: ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'],
};
const LANGUAGES = ['Auto', 'English', 'Spanish', 'German', 'French', 'Italian', 'Portuguese', 'Russian', 'Chinese', 'Japanese', 'Arabic', 'Hindi'];

/** Which voice settings mean something for each provider. */
const FIELDS: Record<Provider, { model?: boolean; language?: boolean; instruct?: string; speed?: boolean }> = {
  local: { model: true, language: true, instruct: 'Emotion (joyful, tender, stern…)' },
  elevenlabs: { model: true, instruct: 'Emotion tag (eleven_v3 only)', speed: true },
  openai: { model: true, instruct: 'Style direction (“calm, warm narrator”)', speed: true },
  espeak: { language: true, speed: true },
  festival: { speed: true },
};

const SPEAKER_HINT: Record<Provider, string> = {
  local: 'Jasper, Bella, Luna, Victoria…',
  elevenlabs: 'A voice name from your account, or a voice id',
  openai: 'alloy, coral, nova…',
  espeak: 'en-us, es, en+f3… (empty: from the language)',
  festival: 'kal_diphone, cmu_us_slt_arctic_hts… (empty: default)',
};

export function SettingsDialog() {
  const tab = useStore((s) => s.settingsOpen);
  const project = useStore((s) => s.project);
  if (!tab) return null;
  const close = () => useStore.setState({ settingsOpen: null });
  const show = (t: 'project' | 'global') => useStore.setState({ settingsOpen: t });
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal settings" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && close()}>
        <div className="settings-tabs">
          <button className={tab === 'project' ? 'on' : ''} onClick={() => show('project')} disabled={!project}>
            This project
          </button>
          <button className={tab === 'global' ? 'on' : ''} onClick={() => show('global')}>
            Kino (all projects)
          </button>
        </div>
        {tab === 'project' && project ? <ProjectTab key={project.path} close={close} /> : <GlobalTab close={close} />}
      </div>
    </div>
  );
}

// ---- per project: kino.json ---------------------------------------------------

function ProjectTab({ close }: { close: () => void }) {
  const project = useStore((s) => s.project)!;
  const globalProvider = useStore((s) => s.settings?.settings.tts.provider) || 'local';
  const [provider, setProvider] = useState<Provider | ''>(project.settings?.tts?.provider ?? '');
  const [voice, setVoice] = useState<Record<string, string>>(project.settings?.tts?.voice ?? {});
  const [sample, setSample] = useState('Hello! This is how the narration of this project will sound.');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const effective = (provider || globalProvider) as Provider;
  const fields = FIELDS[effective];
  const voices = useVoices(effective);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setVoice((v) => ({ ...v, [k]: e.target.value }));

  // only the settings that apply to the provider are kept
  const relevant = () => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(voice)) {
      const applies = k === 'speaker' || (k === 'instruct' ? !!fields.instruct : !!fields[k as 'model' | 'language' | 'speed']);
      if (applies && v.trim()) out[k] = v.trim();
    }
    return out;
  };

  const save = async () => {
    try {
      const settings: ProjectSettings = { tts: { provider, voice: relevant() } };
      const p = await api.saveProjectSettings(settings);
      useStore.getState().setProject(p);
      rebuild();
      close();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const test = async () => {
    setBusy('Generating a sample…');
    setError(null);
    try {
      await narration.testVoice(baseVoice({ ...relevant(), provider: effective }), sample);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <p className="muted small">
        Narration for <b>{project.name}</b>, saved in <code>kino.json</code> in the project folder. These win over the script's{' '}
        <code>video {'{ voice }'}</code>; later <code>voice {'{ }'}</code> blocks and <code>say "…" (…)</code> options still apply over them.
      </p>
      <label className="field">
        Narration provider
        <select value={provider} onChange={(e) => setProvider(e.target.value as Provider | '')}>
          <option value="">Kino's default ({providerName(globalProvider)})</option>
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <span className="hint">{PROVIDERS.find((p) => p.id === effective)?.hint}</span>
      </label>
      <div className="settings-grid">
        <label className="field">
          Voice
          <input value={voice.speaker ?? ''} list="kino-voices" placeholder={SPEAKER_HINT[effective]} onChange={set('speaker')} />
          <datalist id="kino-voices">
            {voices.list.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <span className={voices.error ? 'hint danger-text' : 'hint'} title={voices.error ?? ''}>
            {voices.error ? `Couldn't list voices: ${voices.error}` : voices.list.length ? `${voices.list.length} voices available` : 'Loading voices…'}
          </span>
        </label>
        {fields.model && (
          <label className="field">
            Model
            <input value={voice.model ?? ''} list="kino-models" placeholder={MODELS[effective]?.[0]} onChange={set('model')} />
            <datalist id="kino-models">
              {MODELS[effective]?.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>
        )}
        {fields.language && (
          <label className="field">
            Language
            <input value={voice.language ?? ''} list="kino-languages" placeholder="Auto" onChange={set('language')} />
            <datalist id="kino-languages">
              {LANGUAGES.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>
        )}
        {fields.instruct && (
          <label className="field">
            {fields.instruct}
            <input value={voice.instruct ?? ''} onChange={set('instruct')} />
          </label>
        )}
        {fields.speed && (
          <label className="field">
            Speed
            <input type="number" min={0.25} max={4} step={0.05} value={voice.speed ?? ''} placeholder="1" onChange={set('speed')} />
          </label>
        )}
      </div>
      <div className="row">
        <input className="grow" value={sample} onChange={(e) => setSample(e.target.value)} title="Sample text" />
        <button onClick={test} disabled={!!busy}>
          ▶ Try voice
        </button>
      </div>
      {busy && <div className="muted small">{busy}</div>}
      {error && <div className="danger-text small">{error}</div>}
      <div className="row">
        <span className="muted small">Clips already generated with another voice stay cached; changed lines are generated again.</span>
        <span className="spacer" />
        <button onClick={close}>Cancel</button>
        <button className="primary" onClick={save}>
          Save
        </button>
      </div>
    </>
  );
}

/** A provider's voices (also tells whether it is reachable). */
function useVoices(provider: Provider) {
  const [state, setState] = useState<{ list: string[]; error: string | null }>({ list: [], error: null });
  useEffect(() => {
    let live = true;
    setState({ list: [], error: null });
    api.ttsVoices(provider).then(
      (list) => live && setState({ list: list ?? [], error: list?.length ? null : 'none found' }),
      (e) => live && setState({ list: [], error: errorText(e) }),
    );
    return () => {
      live = false;
    };
  }, [provider]);
  return state;
}

// ---- global: <config dir>/kino/config.json ----------------------------------------

function GlobalTab({ close }: { close: () => void }) {
  const view = useStore((s) => s.settings);
  const [s, setS] = useState<Settings | null>(view ? structuredClone(view.settings) : null);
  const [checks, setChecks] = useState<Partial<Record<Provider, { ok: boolean; text: string }>>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (view) return;
    api.settings().then((v) => {
      useStore.setState({ settings: v });
      setS(structuredClone(v.settings));
    }, (e) => setError(errorText(e)));
  }, [view]);
  if (!s || !view) return <div className="muted">{error ?? 'Loading…'}</div>;

  const env = view.env ?? {};
  const setProvider = (p: Provider, k: keyof Settings['tts'][Provider], v: string) =>
    setS((cur) => cur && { ...cur, tts: { ...cur.tts, [p]: { ...cur.tts[p], [k]: v } } });
  const setExport = (k: keyof Settings['export'], v: string) =>
    setS((cur) => cur && { ...cur, export: { ...cur.export, [k]: v === '' ? undefined : Number(v) } });

  const persist = async (): Promise<boolean> => {
    try {
      await api.saveSettings(s);
      useStore.setState({ settings: await api.settings() });
      setError(null);
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    }
  };
  const save = async () => {
    if (await persist()) {
      rebuild();
      close();
    }
  };
  /** saves, then asks the provider for its voices */
  const check = async (p: Provider) => {
    if (!(await persist())) return;
    setChecks((c) => ({ ...c, [p]: { ok: true, text: 'Checking…' } }));
    try {
      const list = (await api.ttsVoices(p)) ?? [];
      setChecks((c) => ({ ...c, [p]: { ok: list.length > 0, text: list.length ? `Works: ${list.length} voices` : 'Reachable, but no voices found' } }));
    } catch (e) {
      setChecks((c) => ({ ...c, [p]: { ok: false, text: errorText(e) } }));
    }
  };

  const field = (p: Provider, k: 'apiKey' | 'url' | 'command', label: string, placeholder: string) => {
    const envVar = env[`${p}.${k}`];
    return (
      <label className="field">
        {label}
        <input
          type={k === 'apiKey' ? 'password' : 'text'}
          autoComplete="off"
          spellCheck={false}
          value={s.tts[p]?.[k] ?? ''}
          placeholder={placeholder}
          disabled={!!envVar}
          onChange={(e) => setProvider(p, k, e.target.value)}
        />
        {envVar && <span className="hint">Set by the {envVar} environment variable</span>}
      </label>
    );
  };

  return (
    <>
      <div className="settings-scroll">
        <h3>Narration</h3>
        <label className="field">
          Default provider (for projects that don't choose one)
          <select value={s.tts.provider || 'local'} onChange={(e) => setS({ ...s, tts: { ...s.tts, provider: e.target.value as Provider } })}>
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {PROVIDERS.map((p) => (
          <fieldset key={p.id} className="provider">
            <legend>
              {p.name} <span className="muted small">{p.hint}</span>
            </legend>
            {p.id === 'local' && field('local', 'url', 'Server URL', 'http://127.0.0.1:8808')}
            {p.id === 'elevenlabs' && (
              <>
                {field('elevenlabs', 'apiKey', 'API key', 'sk_…')}
                {field('elevenlabs', 'url', 'API URL', 'https://api.elevenlabs.io')}
              </>
            )}
            {p.id === 'openai' && (
              <>
                {field('openai', 'apiKey', 'API key', 'sk-…')}
                {field('openai', 'url', 'API URL (any OpenAI-compatible server)', 'https://api.openai.com/v1')}
              </>
            )}
            {p.id === 'espeak' && field('espeak', 'command', 'Program', 'espeak-ng (from PATH)')}
            {p.id === 'festival' && field('festival', 'command', 'Program', 'text2wave (from PATH)')}
            <div className="row">
              <button className="small" onClick={() => check(p.id)} title="Saves the settings and asks the provider for its voices">
                Check
              </button>
              {checks[p.id] && (
                <span className={`small ellipsis ${checks[p.id]!.ok ? 'muted' : 'danger-text'}`} title={checks[p.id]!.text}>
                  {checks[p.id]!.text}
                </span>
              )}
            </div>
          </fieldset>
        ))}
        <label className="field">
          Narration cache folder
          <input value={s.cacheDir ?? ''} placeholder="Each project's .kino-cache folder" disabled={!!env.cacheDir} onChange={(e) => setS({ ...s, cacheDir: e.target.value })} />
          {env.cacheDir && <span className="hint">Set by the {env.cacheDir} environment variable</span>}
        </label>

        <h3>Export</h3>
        <div className="settings-grid">
          <label className="field">
            MP4 video bitrate (Mbit/s)
            <input type="number" min={1} max={100} step={1} value={s.export.videoBitrate ?? ''} placeholder="8" onChange={(e) => setExport('videoBitrate', e.target.value)} />
          </label>
          <label className="field">
            PDF resolution (× the video size)
            <input type="number" min={1} max={4} step={0.5} value={s.export.pdfScale ?? ''} placeholder="2" onChange={(e) => setExport('pdfScale', e.target.value)} />
          </label>
        </div>
      </div>
      {error && <div className="danger-text small">{error}</div>}
      <div className="row">
        <span className="muted small ellipsis" title={view.file}>
          {view.file}
        </span>
        <span className="spacer" />
        <button onClick={close}>Cancel</button>
        <button className="primary" onClick={save}>
          Save
        </button>
      </div>
    </>
  );
}
