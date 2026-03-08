import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Database,
  MessageSquare,
  RefreshCw,
  Server,
  Sparkles,
  Zap,
} from 'lucide-react';
import { useEffect, useState } from 'react';

function StatCard({ icon, label, value, subtext, color = 'accent' }) {
  const Icon = icon;
  const colors = {
    accent: 'from-[#0078d4] to-[#00bcf2]',
    success: 'from-[#4ec9b0] to-[#3da88a]',
    warning: 'from-[#dcdcaa] to-[#c4b466]',
  };

  return (
    <div className="bg-[#252526] border border-[#3c3c3c] rounded-lg p-4 card-hover">
      <div className="flex items-start justify-between">
        <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${colors[color]} flex items-center justify-center`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
      </div>
      <div className="mt-3">
        <p className="text-2xl font-semibold text-[#cccccc]">{value}</p>
        <p className="text-xs text-[#858585] mt-1">{label}</p>
        {subtext ? <p className="text-[10px] text-[#6e6e6e] mt-0.5">{subtext}</p> : null}
      </div>
    </div>
  );
}

function StatusRow({ icon, label, tone, detail }) {
  const Icon = icon;
  const tones = {
    healthy: {
      icon: 'text-[#4ec9b0]',
      badge: 'text-[#4ec9b0]',
      label: 'Healthy',
    },
    degraded: {
      icon: 'text-[#dcdcaa]',
      badge: 'text-[#dcdcaa]',
      label: 'Degraded',
    },
    offline: {
      icon: 'text-[#f14c4c]',
      badge: 'text-[#f14c4c]',
      label: 'Offline',
    },
    unknown: {
      icon: 'text-[#858585]',
      badge: 'text-[#858585]',
      label: 'Unknown',
    },
  };

  const current = tones[tone] || tones.unknown;

  return (
    <div className="flex items-center gap-3 rounded bg-[#2d2d2d] p-3">
      <Icon className={`w-5 h-5 ${current.icon}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-[#cccccc]">{label}</p>
          <span className={`text-[10px] uppercase tracking-[0.12em] ${current.badge}`}>
            {current.label}
          </span>
        </div>
        <p className="text-[10px] text-[#6e6e6e] mt-1">{detail}</p>
      </div>
    </div>
  );
}

const EMPTY_STATS = {
  status: 'unknown',
  degradedReasons: [],
  uptime: '0h 0m',
  uptimeMs: 0,
  aiCalls: 0,
  successRate: 0,
  tokensIn: 0,
  tokensOut: 0,
  totalTokens: 0,
  commandsExecuted: 0,
  messagesProcessed: 0,
  providers: 0,
  activeProviders: 0,
  deploymentMode: 'unknown',
  discord: {
    ready: false,
    guilds: 0,
    users: 0,
    channels: 0,
  },
  database: {
    connected: false,
  },
};

export default function Overview() {
  const [stats, setStats] = useState(EMPTY_STATS);
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdate, setLastUpdate] = useState(null);

  const fetchData = async ({ quiet = false } = {}) => {
    if (quiet) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const [healthRes, providersRes] = await Promise.all([
        fetch('/api/dashboard/health'),
        fetch('/api/dashboard/providers'),
      ]);

      if (!healthRes.ok) {
        throw new Error(`Health request failed (${healthRes.status})`);
      }
      if (!providersRes.ok) {
        throw new Error(`Provider request failed (${providersRes.status})`);
      }

      const [health, providerData] = await Promise.all([
        healthRes.json(),
        providersRes.json(),
      ]);

      setStats({ ...EMPTY_STATS, ...health });
      setProviders(Array.isArray(providerData.providers) ? providerData.providers : []);
      setError('');
      setLastUpdate(new Date());
    } catch (err) {
      setError(err.message || 'Failed to load dashboard overview.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();

    const interval = setInterval(() => {
      fetchData({ quiet: true });
    }, 15000);

    return () => clearInterval(interval);
  }, []);

  const totalTokens = (stats.tokensIn || 0) + (stats.tokensOut || 0);
  const tokensPerHour = stats.uptimeMs > 0
    ? Math.round(totalTokens / (stats.uptimeMs / 3600000))
    : 0;
  const providerRows = providers.slice(0, 6);
  const providerStatusTone = stats.activeProviders > 0 ? 'healthy' : 'offline';
  const systemTone = stats.status === 'healthy' ? 'healthy' : stats.status === 'degraded' ? 'degraded' : 'unknown';
  const providerDetail = stats.providers > 0
    ? `${stats.activeProviders}/${stats.providers} active providers`
    : 'No providers reported by the backend';

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#cccccc]">Dashboard Overview</h1>
          <p className="text-sm text-[#858585]">Operational state pulled from the live backend.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-[#6e6e6e]">
            <Clock3 className="w-3 h-3" />
            {lastUpdate ? `Updated ${lastUpdate.toLocaleTimeString()}` : 'Waiting for first sync'}
          </div>
          <button
            type="button"
            onClick={() => fetchData({ quiet: true })}
            className="p-2 rounded bg-[#2d2d2d] hover:bg-[#3c3c3c] transition-colors"
            aria-label="Refresh overview"
          >
            <RefreshCw className={`w-4 h-4 text-[#858585] ${(loading || refreshing) ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error ? (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-[#f14c4c]/40 bg-[#f14c4c]/10 px-4 py-3 text-sm text-[#f5b7b7]">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          icon={Sparkles}
          label="System State"
          value={stats.status === 'healthy' ? 'Healthy' : stats.status === 'degraded' ? 'Degraded' : 'Unknown'}
          subtext={
            stats.degradedReasons?.length
              ? `Watch: ${stats.degradedReasons.join(', ')}`
              : 'Discord, database, and providers look healthy'
          }
          color={stats.status === 'healthy' ? 'success' : 'warning'}
        />
        <StatCard
          icon={Zap}
          label="AI Requests"
          value={(stats.aiCalls || 0).toLocaleString()}
          subtext={`${stats.successRate || 0}% success rate`}
          color="success"
        />
        <StatCard
          icon={MessageSquare}
          label="Commands"
          value={(stats.commandsExecuted || 0).toLocaleString()}
          subtext={`${(stats.messagesProcessed || 0).toLocaleString()} messages processed`}
        />
        <StatCard
          icon={Server}
          label="Uptime"
          value={stats.uptime || '0h 0m'}
          subtext={stats.deploymentMode === 'selfhost' ? 'Self-hosted runtime' : 'Render deployment'}
          color="accent"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          icon={Zap}
          label="Tokens In"
          value={(stats.tokensIn || 0).toLocaleString()}
          subtext={tokensPerHour > 0 ? `~${tokensPerHour.toLocaleString()}/hr total throughput` : 'No token throughput yet'}
        />
        <StatCard
          icon={Zap}
          label="Tokens Out"
          value={(stats.tokensOut || 0).toLocaleString()}
          subtext={`${(stats.totalTokens || totalTokens).toLocaleString()} total tokens`}
        />
        <StatCard
          icon={Server}
          label="Guilds"
          value={(stats.discord?.guilds || 0).toLocaleString()}
          subtext={`${(stats.discord?.users || 0).toLocaleString()} members across cached guilds`}
        />
        <StatCard
          icon={Database}
          label="Providers"
          value={`${stats.activeProviders || 0}/${stats.providers || 0}`}
          subtext={providerDetail}
          color={stats.activeProviders > 0 ? 'success' : 'warning'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-[#252526] border border-[#3c3c3c] rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-[#cccccc]">Provider Snapshot</h2>
            <span className="text-xs text-[#858585]">{providerDetail}</span>
          </div>

          {loading && !lastUpdate ? (
            <div className="text-sm text-[#858585]">Loading provider telemetry…</div>
          ) : providerRows.length === 0 ? (
            <div className="rounded bg-[#2d2d2d] px-3 py-4 text-sm text-[#858585]">
              No provider records are available yet.
            </div>
          ) : (
            <div className="space-y-2">
              {providerRows.map(provider => {
                const statusColor = provider.isDisabled
                  ? 'text-[#f14c4c]'
                  : provider.hasError
                    ? 'text-[#dcdcaa]'
                    : 'text-[#4ec9b0]';

                return (
                  <div
                    key={provider.name}
                    className="flex items-center justify-between rounded bg-[#2d2d2d] px-3 py-2 card-hover"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-[#cccccc] truncate">{provider.name}</p>
                      <p className="text-[10px] text-[#6e6e6e] truncate">{provider.model || 'Unknown model'}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-xs ${statusColor}`}>
                        {provider.isDisabled ? 'Disabled' : provider.hasError ? 'Errored' : 'Healthy'}
                      </p>
                      <p className="text-[10px] text-[#6e6e6e]">
                        {provider.metrics?.totalRequests || 0} calls
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-[#252526] border border-[#3c3c3c] rounded-lg p-4">
          <h2 className="text-sm font-medium text-[#cccccc] mb-4">Subsystem Status</h2>
          <div className="space-y-3">
            <StatusRow
              icon={Sparkles}
              label="Jarvis Runtime"
              tone={systemTone}
              detail={
                stats.degradedReasons?.length
                  ? `Degraded because: ${stats.degradedReasons.join(', ')}`
                  : 'No degraded subsystems reported'
              }
            />
            <StatusRow
              icon={CheckCircle2}
              label="Discord"
              tone={stats.discord?.ready ? 'healthy' : 'offline'}
              detail={
                stats.discord?.ready
                  ? `${stats.discord.guilds} guilds and ${stats.discord.channels} channels cached`
                  : 'Discord client is not ready'
              }
            />
            <StatusRow
              icon={Database}
              label="Database"
              tone={stats.database?.connected ? 'healthy' : 'offline'}
              detail={stats.database?.connected ? 'Primary database connection is up' : 'Database connection is not established'}
            />
            <StatusRow
              icon={Zap}
              label="AI Providers"
              tone={providerStatusTone}
              detail={providerDetail}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
