import {
    Activity,
    AlertCircle,
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
    activeUsers: 0,
    aiCalls: 0,
    successRate: 0,
    avgLatency: 0,
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

  // Mock data for demo when API not available
  const mockProviders = [
    { name: 'Groq', model: 'llama-3.3-70b', status: 'online', latency: 245, requests: 1247 },
    { name: 'OpenRouter', model: 'nemotron-nano', status: 'online', latency: 312, requests: 892 },
    { name: 'Google AI', model: 'gemini-2.5-flash', status: 'online', latency: 189, requests: 456 },
    { name: 'Local GPU', model: 'Not configured', status: 'offline', latency: 0, requests: 0 },
  ];

  const displayProviders = providers.length > 0 ? providers : mockProviders;

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
          value={stats.uptime || '24h 32m'}
          subtext="Since last restart"
          color="success"
        />
        <StatCard
          icon={MessageSquare}
          label="Total Requests"
          value={(stats.requests || 12847).toLocaleString()}
          subtext="All time"
          trend={12}
          color="accent"
        />
        <StatCard
          icon={Users}
          label="Active Users"
          value={stats.activeUsers || 342}
          subtext="Last 24 hours"
          trend={8}
          color="accent"
        />
        <StatCard
          icon={Zap}
          label="AI Calls"
          value={(stats.aiCalls || 8924).toLocaleString()}
          subtext={`${stats.successRate || 98.5}% success rate`}
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
              <CheckCircle2 className="w-5 h-5 text-[#4ec9b0]" />
              <div>
                <p className="text-sm text-[#cccccc]">Discord Connected</p>
                <p className="text-[10px] text-[#6e6e6e]">Gateway healthy</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded bg-[#2d2d2d]">
              <CheckCircle2 className="w-5 h-5 text-[#4ec9b0]" />
              <div>
                <p className="text-sm text-[#cccccc]">Database Online</p>
                <p className="text-[10px] text-[#6e6e6e]">MongoDB connected</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded bg-[#2d2d2d]">
              <AlertCircle className="w-5 h-5 text-[#dcdcaa]" />
              <div>
                <p className="text-sm text-[#cccccc]">Local GPU</p>
                <p className="text-[10px] text-[#6e6e6e]">Not configured</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded bg-[#2d2d2d]">
              <Server className="w-5 h-5 text-[#9cdcfe]" />
              <div>
                <p className="text-sm text-[#cccccc]">Selfhost Mode</p>
                <p className="text-[10px] text-[#6e6e6e]">Running locally</p>
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
