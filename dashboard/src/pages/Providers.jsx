import {
  CheckCircle2,
  ChevronDown,
  Clock,
  Cpu,
  RefreshCw,
  TriangleAlert,
  XCircle,
  Zap,
} from 'lucide-react';
import { useEffect, useState } from 'react';

function ProviderCard({ provider, onTest }) {
  const [expanded, setExpanded] = useState(false);

  const familyColors = {
    groq: 'from-orange-500 to-orange-600',
    openrouter: 'from-sky-500 to-cyan-600',
    google: 'from-blue-500 to-blue-600',
    openai: 'from-emerald-500 to-emerald-600',
    deepseek: 'from-cyan-500 to-cyan-600',
    local: 'from-yellow-500 to-yellow-600',
  };

  const state = provider.isDisabled ? 'disabled' : provider.hasError ? 'errored' : 'healthy';

  return (
    <div className="bg-[#252526] border border-[#3c3c3c] rounded-lg overflow-hidden">
      <button
        type="button"
        className="w-full p-4 text-left hover:bg-[#2d2d2d] transition-colors"
        onClick={() => setExpanded(current => !current)}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${familyColors[provider.family] || 'from-gray-500 to-gray-600'} flex items-center justify-center`}>
              <Cpu className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium text-[#cccccc] truncate">{provider.name}</h3>
                {provider.costTier === 'free' ? (
                  <span className="px-1.5 py-0.5 text-[9px] rounded bg-[#4ec9b0]/20 text-[#4ec9b0]">
                    FREE
                  </span>
                ) : null}
              </div>
              <p className="text-xs text-[#858585] truncate">{provider.model || 'Unknown model'}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className={`flex items-center gap-1.5 text-xs ${
              state === 'healthy'
                ? 'text-[#4ec9b0]'
                : state === 'errored'
                  ? 'text-[#dcdcaa]'
                  : 'text-[#f14c4c]'
            }`}>
              {state === 'healthy' ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
              <span>{state === 'healthy' ? 'Healthy' : state === 'errored' ? 'Errored' : 'Disabled'}</span>
            </div>
            <ChevronDown className={`w-4 h-4 text-[#858585] transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </div>
        </div>

        <div className="flex flex-wrap gap-4 mt-3 pt-3 border-t border-[#3c3c3c] text-xs text-[#858585]">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3 h-3" />
            {provider.metrics?.avgLatencyMs?.toFixed(0) || '—'}ms avg
          </div>
          <div className="flex items-center gap-1.5">
            <Zap className="w-3 h-3" />
            {provider.metrics?.totalRequests || 0} calls
          </div>
          <div className="flex items-center gap-1.5">
            <TriangleAlert className="w-3 h-3" />
            {provider.metrics?.successRate?.toFixed(1) || '—'}% success
          </div>
        </div>
      </button>

      {expanded ? (
        <div className="border-t border-[#3c3c3c] bg-[#2d2d2d] px-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-[#6e6e6e] mb-1">Type</p>
              <p className="text-sm text-[#cccccc]">{provider.type || 'Unknown'}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-[#6e6e6e] mb-1">Family</p>
              <p className="text-sm text-[#cccccc] capitalize">{provider.family || 'Unknown'}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-[#6e6e6e] mb-1">Priority</p>
              <p className="text-sm text-[#cccccc]">{provider.priority ?? '—'}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-[#6e6e6e] mb-1">Cost Tier</p>
              <p className="text-sm text-[#cccccc] capitalize">{provider.costTier || 'Unknown'}</p>
            </div>
          </div>

          {provider.lastError ? (
            <div className="mt-4">
              <p className="text-[10px] uppercase tracking-wide text-[#6e6e6e] mb-1">Last Error</p>
              <p className="rounded bg-[#1e1e1e] p-2 text-xs font-mono text-[#f14c4c]">
                {provider.lastError}
              </p>
            </div>
          ) : null}

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onTest(provider);
              }}
              className="flex items-center gap-2 px-3 py-1.5 rounded text-xs bg-[#0078d4] text-white hover:bg-[#1e8ad4] transition-colors"
            >
              <Zap className="w-3 h-3" />
              Test Provider
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function Providers() {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');
  const [testResult, setTestResult] = useState(null);

  const fetchProviders = async ({ quiet = false } = {}) => {
    if (quiet) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const res = await fetch('/api/dashboard/providers');
      if (!res.ok) {
        throw new Error(`Provider request failed (${res.status})`);
      }

      const data = await res.json();
      setProviders(Array.isArray(data.providers) ? data.providers : []);
      setError('');
    } catch (err) {
      setProviders([]);
      setError(err.message || 'Failed to load providers.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchProviders();
  }, []);

  const handleTest = async (provider) => {
    setTestResult({ provider: provider.name, status: 'testing' });

    try {
      const res = await fetch('/api/dashboard/providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: provider.name }),
      });

      if (!res.ok) {
        throw new Error(`Provider test failed (${res.status})`);
      }

      const data = await res.json();

      if (data.success) {
        setTestResult({
          provider: provider.name,
          status: 'success',
          message: `${provider.name} responded in ${data.latency}ms.`,
        });
      } else {
        setTestResult({
          provider: provider.name,
          status: 'error',
          message: data.error || `${provider.name} test failed.`,
        });
      }
    } catch (err) {
      setTestResult({
        provider: provider.name,
        status: 'error',
        message: err.message || `${provider.name} test failed.`,
      });
    }

    setTimeout(() => setTestResult(null), 5000);
  };

  const families = [...new Set(providers.map(provider => provider.family).filter(Boolean))].sort();
  const filteredProviders = filter === 'all'
    ? providers
    : providers.filter(provider => provider.family === filter);
  const activeProviders = providers.filter(provider => !provider.isDisabled).length;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#cccccc]">AI Providers</h1>
          <p className="text-sm text-[#858585]">Provider status without mock fallbacks or no-op controls.</p>
        </div>
        <button
          type="button"
          onClick={() => fetchProviders({ quiet: true })}
          className="flex items-center gap-2 px-3 py-2 rounded bg-[#2d2d2d] hover:bg-[#3c3c3c] transition-colors"
        >
          <RefreshCw className={`w-4 h-4 text-[#858585] ${(loading || refreshing) ? 'animate-spin' : ''}`} />
          <span className="text-sm text-[#cccccc]">Refresh</span>
        </button>
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-[#f14c4c]/40 bg-[#f14c4c]/10 px-4 py-3 text-sm text-[#f5b7b7]">
          {error}
        </div>
      ) : null}

      {testResult ? (
        <div className={`mb-4 flex items-center gap-3 rounded-lg border px-4 py-3 text-sm ${
          testResult.status === 'testing'
            ? 'border-[#0078d4] bg-[#0078d4]/10 text-[#9cdcfe]'
            : testResult.status === 'success'
              ? 'border-[#4ec9b0] bg-[#4ec9b0]/10 text-[#b8f0df]'
              : 'border-[#f14c4c] bg-[#f14c4c]/10 text-[#f5b7b7]'
        }`}>
          <span>{testResult.message || `Testing ${testResult.provider}...`}</span>
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <div className="bg-[#252526] border border-[#3c3c3c] rounded-lg p-4">
          <p className="text-2xl font-semibold text-[#cccccc]">{providers.length}</p>
          <p className="text-xs text-[#858585]">Registered Providers</p>
        </div>
        <div className="bg-[#252526] border border-[#3c3c3c] rounded-lg p-4">
          <p className="text-2xl font-semibold text-[#4ec9b0]">{activeProviders}</p>
          <p className="text-xs text-[#858585]">Active Providers</p>
        </div>
        <div className="bg-[#252526] border border-[#3c3c3c] rounded-lg p-4">
          <p className="text-2xl font-semibold text-[#9cdcfe]">{providers.filter(provider => provider.costTier === 'free').length}</p>
          <p className="text-xs text-[#858585]">Free Tier</p>
        </div>
        <div className="bg-[#252526] border border-[#3c3c3c] rounded-lg p-4">
          <p className="text-2xl font-semibold text-[#dcdcaa]">{families.length}</p>
          <p className="text-xs text-[#858585]">Families</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={`px-3 py-1.5 rounded text-xs transition-colors ${
            filter === 'all' ? 'bg-[#0078d4] text-white' : 'bg-[#2d2d2d] text-[#cccccc] hover:bg-[#3c3c3c]'
          }`}
        >
          All
        </button>
        {families.map(family => (
          <button
            key={family}
            type="button"
            onClick={() => setFilter(family)}
            className={`px-3 py-1.5 rounded text-xs capitalize transition-colors ${
              filter === family ? 'bg-[#0078d4] text-white' : 'bg-[#2d2d2d] text-[#cccccc] hover:bg-[#3c3c3c]'
            }`}
          >
            {family}
          </button>
        ))}
      </div>

      {loading && providers.length === 0 ? (
        <div className="rounded-lg border border-[#3c3c3c] bg-[#252526] px-4 py-6 text-sm text-[#858585]">
          Loading provider list…
        </div>
      ) : filteredProviders.length === 0 ? (
        <div className="rounded-lg border border-[#3c3c3c] bg-[#252526] px-4 py-6 text-sm text-[#858585]">
          No providers match the current filter.
        </div>
      ) : (
        <div className="space-y-3">
          {filteredProviders.map(provider => (
            <ProviderCard
              key={provider.name}
              provider={provider}
              onTest={handleTest}
            />
          ))}
        </div>
      )}
    </div>
  );
}
