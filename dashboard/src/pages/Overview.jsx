import {
  Activity,
  CheckCircle2,
  Clock,
  MessageSquare,
  RefreshCw,
  Server,
  TrendingUp,
  Users,
  Zap
} from 'lucide-react';
import { useEffect, useState } from 'react';

function StatCard({ icon: Icon, label, value, subtext, trend, color = 'accent' }) {
  const colors = {
    accent: 'from-[#0078d4] to-[#00bcf2]',
    success: 'from-[#4ec9b0] to-[#3da88a]',
    warning: 'from-[#dcdcaa] to-[#c4b466]',
    error: 'from-[#f14c4c] to-[#d93e3e]',
  };

  return (
    <div className="bg-[#252526] border border-[#3c3c3c] rounded-lg p-4 card-hover">
      <div className="flex items-start justify-between">
        <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${colors[color]} flex items-center justify-center`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        {trend && (
          <div className={`flex items-center gap-1 text-xs ${trend > 0 ? 'text-[#4ec9b0]' : 'text-[#f14c4c]'}`}>
            <TrendingUp className={`w-3 h-3 ${trend < 0 ? 'rotate-180' : ''}`} />
            {Math.abs(trend)}%
          </div>
        )}
      </div>
      <div className="mt-3">
        <p className="text-2xl font-semibold text-[#cccccc]">{value}</p>
        <p className="text-xs text-[#858585] mt-1">{label}</p>
        {subtext && <p className="text-[10px] text-[#6e6e6e] mt-0.5">{subtext}</p>}
      </div>
    </div>
  );
}

function ProviderStatus({ provider }) {
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded bg-[#2d2d2d] card-hover">
      <div className="flex items-center gap-3">
        <div className={`w-2 h-2 rounded-full ${provider.status === 'online' ? 'bg-[#4ec9b0]' : 'bg-[#f14c4c]'}`} />
        <div>
          <p className="text-sm text-[#cccccc]">{provider.name}</p>
          <p className="text-[10px] text-[#6e6e6e]">{provider.model}</p>
        </div>
      </div>
      <div className="text-right">
        <p className="text-xs text-[#858585]">{provider.latency}ms</p>
        <p className="text-[10px] text-[#6e6e6e]">{provider.requests} req</p>
      </div>
    </div>
  );
}

export default function Overview() {
  const [stats, setStats] = useState({
    uptime: '0h 0m',
    requests: 0,
    aiCalls: 0,
    successRate: 0,
    tokensIn: 0,
    tokensOut: 0,
    totalTokens: 0,
    discord: { guilds: 0, users: 0, channels: 0 },
    providers: 0,
    activeProviders: 0,
    commandsExecuted: 0,
    messagesProcessed: 0,
    deploymentMode: 'render',
  });

  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(new Date());

  const fetchData = async () => {
    try {
      // Fetch from backend API
      const [healthRes, providersRes] = await Promise.all([
        fetch('/api/dashboard/health').catch(() => null),
        fetch('/api/dashboard/providers').catch(() => null),
      ]);

      if (healthRes?.ok) {
        const health = await healthRes.json();
        setStats(prev => ({ ...prev, ...health }));
      }

      if (providersRes?.ok) {
        const data = await providersRes.json();
        setProviders(data.providers || []);
      }

      setLastUpdate(new Date());
    } catch (err) {
      console.error('Failed to fetch data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, []);

  // Transform provider data for display
  const displayProviders = providers.map(p => ({
    name: p.name,
    model: p.model || 'Unknown',
    status: p.isDisabled ? 'offline' : (p.hasError ? 'error' : 'online'),
    latency: p.metrics?.avgLatencyMs ? Math.round(p.metrics.avgLatencyMs) : 0,
    requests: (p.metrics?.successes || 0) + (p.metrics?.failures || 0),
  })).slice(0, 10); // Show top 10 providers

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#cccccc]">Dashboard Overview</h1>
          <p className="text-sm text-[#858585]">Monitor your Jarvis instance</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-[#6e6e6e]">
            <Clock className="w-3 h-3" />
            Last updated: {lastUpdate.toLocaleTimeString()}
          </div>
          <button 
            onClick={fetchData}
            className="p-2 rounded bg-[#2d2d2d] hover:bg-[#3c3c3c] transition-colors"
          >
            <RefreshCw className={`w-4 h-4 text-[#858585] ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          icon={Activity}
          label="Uptime"
          value={stats.uptime || '—'}
          subtext="Since last restart"
          color="success"
        />
        <StatCard
          icon={Zap}
          label="AI Requests"
          value={(stats.aiCalls || 0).toLocaleString()}
          subtext={`${stats.successRate || 0}% success rate`}
          color="success"
        />
        <StatCard
          icon={Hash}
          label="Tokens In"
          value={(stats.tokensIn || 0).toLocaleString()}
          subtext="Prompt tokens"
          color="accent"
        />
        <StatCard
          icon={Hash}
          label="Tokens Out"
          value={(stats.tokensOut || 0).toLocaleString()}
          subtext="Completion tokens"
          color="accent"
        />
      </div>

      {/* Secondary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          icon={MessageSquare}
          label="Commands"
          value={(stats.commandsExecuted || 0).toLocaleString()}
          subtext="Slash commands executed"
          color="accent"
        />
        <StatCard
          icon={MessageSquare}
          label="Messages"
          value={(stats.messagesProcessed || 0).toLocaleString()}
          subtext="Messages processed"
          color="accent"
        />
        <StatCard
          icon={Server}
          label="Guilds"
          value={stats.discord?.guilds || 0}
          subtext={`${(stats.discord?.users || 0).toLocaleString()} users`}
          color="accent"
        />
        <StatCard
          icon={Users}
          label="Providers"
          value={`${stats.activeProviders || 0}/${stats.providers || 0}`}
          subtext="Active AI providers"
          color="success"
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Provider Status */}
        <div className="lg:col-span-2 bg-[#252526] border border-[#3c3c3c] rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-[#cccccc]">AI Provider Status</h2>
            <span className="text-xs text-[#858585]">{displayProviders.filter(p => p.status === 'online').length} online</span>
          </div>
          <div className="space-y-2">
            {displayProviders.map((provider, i) => (
              <ProviderStatus key={i} provider={provider} />
            ))}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-[#252526] border border-[#3c3c3c] rounded-lg p-4">
          <h2 className="text-sm font-medium text-[#cccccc] mb-4">System Status</h2>
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 rounded bg-[#2d2d2d]">
              <CheckCircle2 className={`w-5 h-5 ${stats.discord?.guilds > 0 ? 'text-[#4ec9b0]' : 'text-[#dcdcaa]'}`} />
              <div>
                <p className="text-sm text-[#cccccc]">Discord</p>
                <p className="text-[10px] text-[#6e6e6e]">{stats.discord?.guilds > 0 ? `${stats.discord.guilds} guilds connected` : 'Connecting...'}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded bg-[#2d2d2d]">
              <CheckCircle2 className="w-5 h-5 text-[#4ec9b0]" />
              <div>
                <p className="text-sm text-[#cccccc]">Database</p>
                <p className="text-[10px] text-[#6e6e6e]">MongoDB connected</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded bg-[#2d2d2d]">
              <CheckCircle2 className={`w-5 h-5 ${stats.activeProviders > 0 ? 'text-[#4ec9b0]' : 'text-[#f14c4c]'}`} />
              <div>
                <p className="text-sm text-[#cccccc]">AI Providers</p>
                <p className="text-[10px] text-[#6e6e6e]">{stats.activeProviders}/{stats.providers} active</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded bg-[#2d2d2d]">
              <Server className="w-5 h-5 text-[#9cdcfe]" />
              <div>
                <p className="text-sm text-[#cccccc]">Deployment</p>
                <p className="text-[10px] text-[#6e6e6e]">{stats.deploymentMode === 'selfhost' ? 'Self-hosted' : 'Render Cloud'}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Performance Chart Placeholder */}
      <div className="mt-6 bg-[#252526] border border-[#3c3c3c] rounded-lg p-4">
        <h2 className="text-sm font-medium text-[#cccccc] mb-4">Request Volume (24h)</h2>
        <div className="h-32 flex items-end justify-between gap-1 px-2">
          {Array.from({ length: 24 }, (_, i) => (
            <div 
              key={i} 
              className="flex-1 bg-gradient-to-t from-[#0078d4] to-[#00bcf2] rounded-t opacity-80 hover:opacity-100 transition-opacity"
              style={{ height: `${Math.random() * 80 + 20}%` }}
              title={`${i}:00 - ${Math.floor(Math.random() * 500 + 100)} requests`}
            />
          ))}
        </div>
        <div className="flex justify-between mt-2 text-[10px] text-[#6e6e6e]">
          <span>00:00</span>
          <span>06:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>Now</span>
        </div>
      </div>
    </div>
  );
}
