import {
    CheckCircle2,
    ChevronDown,
    Clock,
    Cpu,
    Pause,
    Play,
    RefreshCw,
    TrendingUp,
    XCircle,
    Zap
} from 'lucide-react';
import { useEffect, useState } from 'react';

function ProviderCard({ provider, onToggle, onTest }) {
  const [expanded, setExpanded] = useState(false);
  
  const familyColors = {
    groq: 'from-orange-500 to-orange-600',
    openrouter: 'from-purple-500 to-purple-600',
    google: 'from-blue-500 to-blue-600',
    openai: 'from-green-500 to-green-600',
    deepseek: 'from-cyan-500 to-cyan-600',
    local: 'from-yellow-500 to-yellow-600',
  };

  return (
    <div className="bg-[#252526] border border-[#3c3c3c] rounded-lg overflow-hidden">
      <div 
        className="p-4 cursor-pointer hover:bg-[#2d2d2d] transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${familyColors[provider.family] || 'from-gray-500 to-gray-600'} flex items-center justify-center`}>
              <Cpu className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium text-[#cccccc]">{provider.name}</h3>
                {provider.costTier === 'free' && (
                  <span className="px-1.5 py-0.5 text-[9px] rounded bg-[#4ec9b0]/20 text-[#4ec9b0]">FREE</span>
                )}
              </div>
              <p className="text-xs text-[#858585]">{provider.model}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-1.5 ${provider.isDisabled ? 'text-[#f14c4c]' : 'text-[#4ec9b0]'}`}>
              {provider.isDisabled ? <XCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
              <span className="text-xs">{provider.isDisabled ? 'Disabled' : 'Active'}</span>
            </div>
            <ChevronDown className={`w-4 h-4 text-[#858585] transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </div>
        </div>

        {/* Quick stats */}
        <div className="flex gap-4 mt-3 pt-3 border-t border-[#3c3c3c]">
          <div className="flex items-center gap-1.5 text-xs text-[#858585]">
            <Clock className="w-3 h-3" />
            {provider.metrics?.avgLatencyMs?.toFixed(0) || '—'}ms avg
          </div>
          <div className="flex items-center gap-1.5 text-xs text-[#858585]">
            <TrendingUp className="w-3 h-3" />
            {provider.metrics?.successRate?.toFixed(1) || '—'}% success
          </div>
          <div className="flex items-center gap-1.5 text-xs text-[#858585]">
            <Zap className="w-3 h-3" />
            {provider.metrics?.totalRequests || 0} calls
          </div>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-[#3c3c3c] bg-[#2d2d2d]">
          <div className="grid grid-cols-2 gap-4 py-4">
            <div>
              <p className="text-[10px] text-[#6e6e6e] uppercase tracking-wide mb-1">Type</p>
              <p className="text-sm text-[#cccccc]">{provider.type}</p>
            </div>
            <div>
              <p className="text-[10px] text-[#6e6e6e] uppercase tracking-wide mb-1">Family</p>
              <p className="text-sm text-[#cccccc] capitalize">{provider.family}</p>
            </div>
            <div>
              <p className="text-[10px] text-[#6e6e6e] uppercase tracking-wide mb-1">Priority</p>
              <p className="text-sm text-[#cccccc]">{provider.priority}</p>
            </div>
            <div>
              <p className="text-[10px] text-[#6e6e6e] uppercase tracking-wide mb-1">Cost Tier</p>
              <p className="text-sm text-[#cccccc] capitalize">{provider.costTier}</p>
            </div>
            {provider.lastError && (
              <div className="col-span-2">
                <p className="text-[10px] text-[#6e6e6e] uppercase tracking-wide mb-1">Last Error</p>
                <p className="text-xs text-[#f14c4c] font-mono bg-[#1e1e1e] p-2 rounded">{provider.lastError}</p>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button 
              onClick={(e) => { e.stopPropagation(); onToggle(provider); }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs transition-colors ${
                provider.isDisabled 
                  ? 'bg-[#4ec9b0] text-black hover:bg-[#3da88a]' 
                  : 'bg-[#f14c4c] text-white hover:bg-[#d93e3e]'
              }`}
            >
              {provider.isDisabled ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
              {provider.isDisabled ? 'Enable' : 'Disable'}
            </button>
            <button 
              onClick={(e) => { e.stopPropagation(); onTest(provider); }}
              className="flex items-center gap-2 px-3 py-1.5 rounded text-xs bg-[#0078d4] text-white hover:bg-[#1e8ad4] transition-colors"
            >
              <Zap className="w-3 h-3" />
              Test
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Providers() {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [testResult, setTestResult] = useState(null);

  const fetchProviders = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/dashboard/providers');
      if (res.ok) {
        const data = await res.json();
        setProviders(data.providers || []);
      }
    } catch (err) {
      console.error('Failed to fetch providers:', err);
      // Mock data for demo
      setProviders([
        { name: 'Groq1', model: 'llama-3.3-70b-versatile', type: 'openai-chat', family: 'groq', costTier: 'free', priority: 0, isDisabled: false, metrics: { totalRequests: 1247, successRate: 98.5, avgLatencyMs: 245 } },
        { name: 'OpenRouter3', model: 'nvidia/nemotron-nano-9b-v2:free', type: 'openai-chat', family: 'openrouter', costTier: 'free', priority: 0, isDisabled: false, metrics: { totalRequests: 892, successRate: 97.2, avgLatencyMs: 312 } },
        { name: 'GoogleAI1', model: 'gemini-2.5-flash', type: 'google', family: 'google', costTier: 'free', priority: 0, isDisabled: false, metrics: { totalRequests: 456, successRate: 99.1, avgLatencyMs: 189 } },
        { name: 'GPT5Nano', model: 'gpt-4o-mini', type: 'openai-chat', family: 'openai', costTier: 'paid', priority: 2, isDisabled: false, metrics: { totalRequests: 234, successRate: 99.8, avgLatencyMs: 156 } },
        { name: 'deepseek-gateway-1', model: 'deepseek/deepseek-v3.2-exp', type: 'openai-chat', family: 'deepseek', costTier: 'paid', priority: 2, isDisabled: false, metrics: { totalRequests: 123, successRate: 96.5, avgLatencyMs: 420 } },
      ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProviders();
  }, []);

  const handleToggle = async (provider) => {
    // API call to toggle provider
    console.log('Toggle provider:', provider.name);
  };

  const handleTest = async (provider) => {
    setTestResult({ provider: provider.name, status: 'testing' });
    try {
      const res = await fetch('/api/dashboard/providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: provider.name }),
      });
      const data = await res.json();
      setTestResult({ provider: provider.name, status: 'success', latency: data.latency, response: data.response });
    } catch (err) {
      setTestResult({ provider: provider.name, status: 'error', error: err.message });
    }
    setTimeout(() => setTestResult(null), 5000);
  };

  const families = [...new Set(providers.map(p => p.family))];
  const filteredProviders = filter === 'all' ? providers : providers.filter(p => p.family === filter);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#cccccc]">AI Providers</h1>
          <p className="text-sm text-[#858585]">Manage and monitor AI provider connections</p>
        </div>
        <button 
          onClick={fetchProviders}
          className="flex items-center gap-2 px-3 py-2 rounded bg-[#2d2d2d] hover:bg-[#3c3c3c] transition-colors"
        >
          <RefreshCw className={`w-4 h-4 text-[#858585] ${loading ? 'animate-spin' : ''}`} />
          <span className="text-sm text-[#cccccc]">Refresh</span>
        </button>
      </div>

      {/* Test result toast */}
      {testResult && (
        <div className={`mb-4 p-3 rounded-lg flex items-center gap-3 ${
          testResult.status === 'testing' ? 'bg-[#0078d4]/20 border border-[#0078d4]' :
          testResult.status === 'success' ? 'bg-[#4ec9b0]/20 border border-[#4ec9b0]' :
          'bg-[#f14c4c]/20 border border-[#f14c4c]'
        }`}>
          {testResult.status === 'testing' && <RefreshCw className="w-4 h-4 text-[#0078d4] animate-spin" />}
          {testResult.status === 'success' && <CheckCircle2 className="w-4 h-4 text-[#4ec9b0]" />}
          {testResult.status === 'error' && <XCircle className="w-4 h-4 text-[#f14c4c]" />}
          <span className="text-sm text-[#cccccc]">
            {testResult.status === 'testing' && `Testing ${testResult.provider}...`}
            {testResult.status === 'success' && `${testResult.provider} responded in ${testResult.latency}ms`}
            {testResult.status === 'error' && `${testResult.provider} failed: ${testResult.error}`}
          </span>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-[#252526] border border-[#3c3c3c] rounded-lg p-4">
          <p className="text-2xl font-semibold text-[#cccccc]">{providers.length}</p>
          <p className="text-xs text-[#858585]">Total Providers</p>
        </div>
        <div className="bg-[#252526] border border-[#3c3c3c] rounded-lg p-4">
          <p className="text-2xl font-semibold text-[#4ec9b0]">{providers.filter(p => !p.isDisabled).length}</p>
          <p className="text-xs text-[#858585]">Active</p>
        </div>
        <div className="bg-[#252526] border border-[#3c3c3c] rounded-lg p-4">
          <p className="text-2xl font-semibold text-[#9cdcfe]">{providers.filter(p => p.costTier === 'free').length}</p>
          <p className="text-xs text-[#858585]">Free Tier</p>
        </div>
        <div className="bg-[#252526] border border-[#3c3c3c] rounded-lg p-4">
          <p className="text-2xl font-semibold text-[#dcdcaa]">{families.length}</p>
          <p className="text-xs text-[#858585]">Families</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4">
        <button 
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
            onClick={() => setFilter(family)}
            className={`px-3 py-1.5 rounded text-xs capitalize transition-colors ${
              filter === family ? 'bg-[#0078d4] text-white' : 'bg-[#2d2d2d] text-[#cccccc] hover:bg-[#3c3c3c]'
            }`}
          >
            {family}
          </button>
        ))}
      </div>

      {/* Provider List */}
      <div className="space-y-3">
        {filteredProviders.map((provider, i) => (
          <ProviderCard 
            key={provider.name || i} 
            provider={provider} 
            onToggle={handleToggle}
            onTest={handleTest}
          />
        ))}
      </div>
    </div>
  );
}
