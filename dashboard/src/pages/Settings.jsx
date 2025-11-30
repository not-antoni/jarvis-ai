import {
    Bot,
    Database,
    RotateCcw,
    Save,
    Server,
    Shield,
    Terminal
} from 'lucide-react';
import { useState } from 'react';

function SettingSection({ icon: Icon, title, children }) {
  return (
    <div className="bg-[#252526] border border-[#3c3c3c] rounded-lg p-4 mb-4">
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-[#3c3c3c]">
        <Icon className="w-4 h-4 text-[#0078d4]" />
        <h2 className="text-sm font-medium text-[#cccccc]">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Toggle({ label, description, checked, onChange }) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <p className="text-sm text-[#cccccc]">{label}</p>
        {description && <p className="text-xs text-[#6e6e6e]">{description}</p>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative w-10 h-5 rounded-full transition-colors ${
          checked ? 'bg-[#0078d4]' : 'bg-[#3c3c3c]'
        }`}
      >
        <span 
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
            checked ? 'left-5' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  );
}

function Input({ label, description, value, onChange, type = 'text', placeholder }) {
  return (
    <div className="py-2">
      <label className="text-sm text-[#cccccc]">{label}</label>
      {description && <p className="text-xs text-[#6e6e6e] mb-1">{description}</p>}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full mt-1 px-3 py-2 rounded bg-[#2d2d2d] border border-[#3c3c3c] text-sm text-[#cccccc] placeholder-[#6e6e6e] focus:border-[#0078d4] focus:outline-none"
      />
    </div>
  );
}

function Select({ label, description, value, onChange, options }) {
  return (
    <div className="py-2">
      <label className="text-sm text-[#cccccc]">{label}</label>
      {description && <p className="text-xs text-[#6e6e6e] mb-1">{description}</p>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full mt-1 px-3 py-2 rounded bg-[#2d2d2d] border border-[#3c3c3c] text-sm text-[#cccccc] focus:border-[#0078d4] focus:outline-none"
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

export default function Settings() {
  const [settings, setSettings] = useState({
    // Server
    port: '3000',
    dashboardPort: '3001',
    selfhostMode: true,
    
    // AI
    defaultProvider: 'auto',
    fallbackEnabled: true,
    maxTokens: '500',
    temperature: '1.0',
    
    // Database
    mongoUri: 'mongodb://localhost:27017',
    dbName: 'jarvis_ai',
    autoExport: false,
    
    // Bot
    adminUserId: '',
    cooldownMs: '3000',
    maxInputLength: '250',
    
    // Features
    debugMode: false,
    metricsEnabled: true,
    rateLimiting: true,
    
    // Local AI
    ollamaUrl: 'http://localhost:11434',
    preferLocal: false,
    gpuLayers: '35',
  });

  const [saved, setSaved] = useState(false);

  const updateSetting = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = async () => {
    try {
      await fetch('/api/dashboard/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  };

  const handleReset = () => {
    // Reset to defaults
    window.location.reload();
  };

  return (
    <div className="p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#cccccc]">Settings</h1>
          <p className="text-sm text-[#858585]">Configure your Jarvis instance</p>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={handleReset}
            className="flex items-center gap-2 px-3 py-2 rounded text-xs bg-[#2d2d2d] text-[#cccccc] hover:bg-[#3c3c3c] transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            Reset
          </button>
          <button 
            onClick={handleSave}
            className={`flex items-center gap-2 px-4 py-2 rounded text-xs transition-colors ${
              saved ? 'bg-[#4ec9b0] text-black' : 'bg-[#0078d4] text-white hover:bg-[#1e8ad4]'
            }`}
          >
            <Save className="w-3 h-3" />
            {saved ? 'Saved!' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Server Settings */}
      <SettingSection icon={Server} title="Server Configuration">
        <div className="grid grid-cols-2 gap-4">
          <Input 
            label="Bot Port" 
            value={settings.port}
            onChange={(v) => updateSetting('port', v)}
          />
          <Input 
            label="Dashboard Port" 
            value={settings.dashboardPort}
            onChange={(v) => updateSetting('dashboardPort', v)}
          />
        </div>
        <Toggle
          label="Selfhost Mode"
          description="Enable local deployment features"
          checked={settings.selfhostMode}
          onChange={(v) => updateSetting('selfhostMode', v)}
        />
      </SettingSection>

      {/* AI Settings */}
      <SettingSection icon={Bot} title="AI Configuration">
        <Select
          label="Default Provider"
          description="Primary AI provider selection strategy"
          value={settings.defaultProvider}
          onChange={(v) => updateSetting('defaultProvider', v)}
          options={[
            { value: 'auto', label: 'Auto (Random)' },
            { value: 'groq', label: 'Groq' },
            { value: 'openrouter', label: 'OpenRouter' },
            { value: 'google', label: 'Google AI' },
            { value: 'openai', label: 'OpenAI' },
            { value: 'local', label: 'Local (Ollama)' },
          ]}
        />
        <div className="grid grid-cols-2 gap-4">
          <Input 
            label="Max Tokens" 
            type="number"
            value={settings.maxTokens}
            onChange={(v) => updateSetting('maxTokens', v)}
          />
          <Input 
            label="Temperature" 
            type="number"
            value={settings.temperature}
            onChange={(v) => updateSetting('temperature', v)}
          />
        </div>
        <Toggle
          label="Fallback Enabled"
          description="Automatically try other providers on failure"
          checked={settings.fallbackEnabled}
          onChange={(v) => updateSetting('fallbackEnabled', v)}
        />
      </SettingSection>

      {/* Database Settings */}
      <SettingSection icon={Database} title="Database Configuration">
        <Input 
          label="MongoDB URI" 
          value={settings.mongoUri}
          onChange={(v) => updateSetting('mongoUri', v)}
          placeholder="mongodb://localhost:27017"
        />
        <Input 
          label="Database Name" 
          value={settings.dbName}
          onChange={(v) => updateSetting('dbName', v)}
        />
        <Toggle
          label="Auto Export"
          description="Automatically backup database on startup"
          checked={settings.autoExport}
          onChange={(v) => updateSetting('autoExport', v)}
        />
      </SettingSection>

      {/* Local AI Settings */}
      <SettingSection icon={Terminal} title="Local AI (GPU)">
        <Input 
          label="Ollama URL" 
          value={settings.ollamaUrl}
          onChange={(v) => updateSetting('ollamaUrl', v)}
          placeholder="http://localhost:11434"
        />
        <Input 
          label="GPU Layers" 
          type="number"
          value={settings.gpuLayers}
          onChange={(v) => updateSetting('gpuLayers', v)}
        />
        <Toggle
          label="Prefer Local Models"
          description="Use local GPU models before external providers"
          checked={settings.preferLocal}
          onChange={(v) => updateSetting('preferLocal', v)}
        />
      </SettingSection>

      {/* Feature Toggles */}
      <SettingSection icon={Shield} title="Features & Security">
        <Toggle
          label="Debug Mode"
          description="Enable verbose logging"
          checked={settings.debugMode}
          onChange={(v) => updateSetting('debugMode', v)}
        />
        <Toggle
          label="Metrics Collection"
          description="Collect performance metrics"
          checked={settings.metricsEnabled}
          onChange={(v) => updateSetting('metricsEnabled', v)}
        />
        <Toggle
          label="Rate Limiting"
          description="Enable request rate limiting"
          checked={settings.rateLimiting}
          onChange={(v) => updateSetting('rateLimiting', v)}
        />
      </SettingSection>
    </div>
  );
}
