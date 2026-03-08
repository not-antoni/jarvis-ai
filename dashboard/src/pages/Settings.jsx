import {
  Bot,
  RefreshCcw,
  Save,
  Shield,
} from 'lucide-react';
import { useEffect, useState } from 'react';

const DEFAULT_SETTINGS = {
  defaultProvider: 'auto',
  maxTokens: 500,
  temperature: 1,
  debugMode: false,
  notificationsEnabled: true,
};

function SettingSection({ icon, title, description, children }) {
  const Icon = icon;
  return (
    <div className="mb-4 rounded-lg border border-[#3c3c3c] bg-[#252526] p-4">
      <div className="mb-4 border-b border-[#3c3c3c] pb-3">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-[#0078d4]" />
          <h2 className="text-sm font-medium text-[#cccccc]">{title}</h2>
        </div>
        {description ? <p className="mt-1 text-xs text-[#6e6e6e]">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}

function Toggle({ label, description, checked, onChange }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div>
        <p className="text-sm text-[#cccccc]">{label}</p>
        {description ? <p className="text-xs text-[#6e6e6e]">{description}</p> : null}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-10 rounded-full transition-colors ${
          checked ? 'bg-[#0078d4]' : 'bg-[#3c3c3c]'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
            checked ? 'left-5' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  );
}

function Field({ label, description, children }) {
  return (
    <div className="py-2">
      <label className="text-sm text-[#cccccc]">{label}</label>
      {description ? <p className="mb-1 text-xs text-[#6e6e6e]">{description}</p> : null}
      {children}
    </div>
  );
}

function normalizeSettings(input) {
  return {
    defaultProvider: String(input?.defaultProvider || DEFAULT_SETTINGS.defaultProvider),
    maxTokens: Number.isFinite(Number(input?.maxTokens)) ? Number(input.maxTokens) : DEFAULT_SETTINGS.maxTokens,
    temperature: Number.isFinite(Number(input?.temperature)) ? Number(input.temperature) : DEFAULT_SETTINGS.temperature,
    debugMode: Boolean(input?.debugMode),
    notificationsEnabled: Boolean(
      input?.notificationsEnabled ?? DEFAULT_SETTINGS.notificationsEnabled
    ),
  };
}

export default function Settings() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loadedSettings, setLoadedSettings] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const loadSettings = async () => {
    setLoading(true);

    try {
      const res = await fetch('/api/dashboard/settings');
      if (!res.ok) {
        throw new Error(`Settings request failed (${res.status})`);
      }

      const data = await res.json();
      const normalized = normalizeSettings(data);
      setSettings(normalized);
      setLoadedSettings(normalized);
      setError('');
    } catch (err) {
      setError(err.message || 'Failed to load settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const updateSetting = (key, value) => {
    setSettings(current => ({ ...current, [key]: value }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);

    try {
      const res = await fetch('/api/dashboard/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });

      if (!res.ok) {
        throw new Error(`Save failed (${res.status})`);
      }

      const data = await res.json();
      const normalized = normalizeSettings(data.settings);
      setSettings(normalized);
      setLoadedSettings(normalized);
      setSaved(true);
      setError('');
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err.message || 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#cccccc]">Settings</h1>
          <p className="text-sm text-[#858585]">Only persisted dashboard settings are exposed here.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setSettings(loadedSettings);
              setSaved(false);
            }}
            className="flex items-center gap-2 rounded bg-[#2d2d2d] px-3 py-2 text-xs text-[#cccccc] transition-colors hover:bg-[#3c3c3c]"
          >
            <RefreshCcw className="w-3 h-3" />
            Reset
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={loading || saving}
            className={`flex items-center gap-2 rounded px-4 py-2 text-xs transition-colors ${
              saved ? 'bg-[#4ec9b0] text-black' : 'bg-[#0078d4] text-white hover:bg-[#1e8ad4]'
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            <Save className="w-3 h-3" />
            {saving ? 'Saving…' : saved ? 'Saved' : 'Save Changes'}
          </button>
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-[#f14c4c]/40 bg-[#f14c4c]/10 px-4 py-3 text-sm text-[#f5b7b7]">
          {error}
        </div>
      ) : null}

      <SettingSection
        icon={Bot}
        title="AI Routing"
        description="These values are persisted by the dashboard backend today."
      >
        <Field
          label="Default Provider"
          description="The backend stores this value as the preferred provider selector."
        >
          <select
            value={settings.defaultProvider}
            onChange={event => updateSetting('defaultProvider', event.target.value)}
            disabled={loading}
            className="mt-1 w-full rounded border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2 text-sm text-[#cccccc] focus:border-[#0078d4] focus:outline-none"
          >
            <option value="auto">Auto</option>
            <option value="groq">Groq</option>
            <option value="openrouter">OpenRouter</option>
            <option value="google">Google AI</option>
            <option value="openai">OpenAI</option>
            <option value="local">Local / Ollama</option>
          </select>
        </Field>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field
            label="Max Tokens"
            description="Persisted numeric ceiling for dashboard-managed requests."
          >
            <input
              type="number"
              min="1"
              step="1"
              value={settings.maxTokens}
              onChange={event => updateSetting('maxTokens', Number(event.target.value))}
              disabled={loading}
              className="mt-1 w-full rounded border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2 text-sm text-[#cccccc] focus:border-[#0078d4] focus:outline-none"
            />
          </Field>

          <Field
            label="Temperature"
            description="Persisted generation temperature."
          >
            <input
              type="number"
              min="0"
              step="0.1"
              value={settings.temperature}
              onChange={event => updateSetting('temperature', Number(event.target.value))}
              disabled={loading}
              className="mt-1 w-full rounded border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2 text-sm text-[#cccccc] focus:border-[#0078d4] focus:outline-none"
            />
          </Field>
        </div>
      </SettingSection>

      <SettingSection
        icon={Shield}
        title="Operator Flags"
        description="These toggles are real persisted backend settings, not placeholders."
      >
        <Toggle
          label="Debug Mode"
          description="Persist verbose dashboard-side diagnostics."
          checked={settings.debugMode}
          onChange={value => updateSetting('debugMode', value)}
        />
        <Toggle
          label="Notifications Enabled"
          description="Keep dashboard notifications enabled for supported features."
          checked={settings.notificationsEnabled}
          onChange={value => updateSetting('notificationsEnabled', value)}
        />
      </SettingSection>
    </div>
  );
}
