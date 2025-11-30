import {
    Activity,
    AlertTriangle,
    Bot,
    Cpu,
    Eye,
    MemoryStick,
    RefreshCw,
    Settings
} from 'lucide-react';
import { useEffect, useState } from 'react';

function AgentCard({ agent }) {
  const statusColors = {
    running: 'bg-[#4ec9b0]',
    idle: 'bg-[#dcdcaa]',
    error: 'bg-[#f14c4c]',
    stopped: 'bg-[#858585]',
  };

  return (
    <div className="bg-[#252526] border border-[#3c3c3c] rounded-lg p-4 card-hover">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#0078d4] to-[#00bcf2] flex items-center justify-center">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-[#cccccc]">{agent.name}</h3>
            <p className="text-xs text-[#858585]">{agent.type}</p>
          </div>
        </div>
        <div className={`status-dot ${statusColors[agent.status]}`}></div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="bg-[#2d2d2d] rounded p-2">
          <p className="text-[10px] text-[#6e6e6e]">Sessions</p>
          <p className="text-sm text-[#cccccc]">{agent.sessions}</p>
        </div>
        <div className="bg-[#2d2d2d] rounded p-2">
          <p className="text-[10px] text-[#6e6e6e]">Tasks</p>
          <p className="text-sm text-[#cccccc]">{agent.tasks}</p>
        </div>
        <div className="bg-[#2d2d2d] rounded p-2">
          <p className="text-[10px] text-[#6e6e6e]">Uptime</p>
          <p className="text-sm text-[#cccccc]">{agent.uptime}</p>
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <button className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs bg-[#2d2d2d] text-[#cccccc] hover:bg-[#3c3c3c] transition-colors">
          <Eye className="w-3 h-3" />
          Monitor
        </button>
        <button className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs bg-[#2d2d2d] text-[#cccccc] hover:bg-[#3c3c3c] transition-colors">
          <Settings className="w-3 h-3" />
          Config
        </button>
      </div>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, status, details }) {
  const statusColors = {
    good: 'text-[#4ec9b0]',
    warning: 'text-[#dcdcaa]',
    critical: 'text-[#f14c4c]',
  };

  return (
    <div className="bg-[#252526] border border-[#3c3c3c] rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <Icon className={`w-5 h-5 ${statusColors[status]}`} />
        <span className={`text-xs ${statusColors[status]}`}>{status}</span>
      </div>
      <p className="text-2xl font-semibold text-[#cccccc]">{value}</p>
      <p className="text-xs text-[#858585]">{label}</p>
      {details && <p className="text-[10px] text-[#6e6e6e] mt-1">{details}</p>}
    </div>
  );
}

export default function Agents() {
  const [agents, setAgents] = useState([
    { name: 'BrowserAgent', type: 'Web Automation', status: 'running', sessions: 3, tasks: 127, uptime: '4h 32m' },
    { name: 'ProductionAgent', type: 'Task Orchestration', status: 'running', sessions: 1, tasks: 892, uptime: '24h 15m' },
    { name: 'ScraperAgent', type: 'Data Collection', status: 'idle', sessions: 0, tasks: 45, uptime: '2h 10m' },
  ]);

  const [metrics, setMetrics] = useState({
    memory: { value: '2.4GB', status: 'good', details: '45% of 5.3GB limit' },
    cpu: { value: '23%', status: 'good', details: '4 cores available' },
    activeTasks: { value: 12, status: 'good', details: '3 queued' },
    errors: { value: 2, status: 'warning', details: 'Last 24 hours' },
  });

  const [loading, setLoading] = useState(false);

  const fetchAgentStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/dashboard/agents');
      if (res.ok) {
        const data = await res.json();
        if (data.agents) setAgents(data.agents);
        if (data.metrics) setMetrics(data.metrics);
      }
    } catch (err) {
      console.error('Failed to fetch agent status:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAgentStatus();
    const interval = setInterval(fetchAgentStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#cccccc]">Agent Monitor</h1>
          <p className="text-sm text-[#858585]">Real-time agent status and performance</p>
        </div>
        <button 
          onClick={fetchAgentStatus}
          className="flex items-center gap-2 px-3 py-2 rounded bg-[#2d2d2d] hover:bg-[#3c3c3c] transition-colors"
        >
          <RefreshCw className={`w-4 h-4 text-[#858585] ${loading ? 'animate-spin' : ''}`} />
          <span className="text-sm text-[#cccccc]">Refresh</span>
        </button>
      </div>

      {/* System Metrics */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <MetricCard icon={MemoryStick} label="Memory Usage" {...metrics.memory} />
        <MetricCard icon={Cpu} label="CPU Usage" {...metrics.cpu} />
        <MetricCard icon={Activity} label="Active Tasks" {...metrics.activeTasks} />
        <MetricCard icon={AlertTriangle} label="Errors" {...metrics.errors} />
      </div>

      {/* Agent Grid */}
      <h2 className="text-sm font-medium text-[#cccccc] mb-4">Active Agents</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {agents.map((agent, i) => (
          <AgentCard key={i} agent={agent} />
        ))}
      </div>

      {/* Event Log */}
      <div className="bg-[#252526] border border-[#3c3c3c] rounded-lg p-4">
        <h2 className="text-sm font-medium text-[#cccccc] mb-4">Recent Events</h2>
        <div className="space-y-2 font-mono text-xs">
          {[
            { time: '12:34:56', level: 'info', msg: 'BrowserAgent completed task #127: scrape_page' },
            { time: '12:34:45', level: 'success', msg: 'ProductionAgent connected to Discord gateway' },
            { time: '12:34:12', level: 'warning', msg: 'ScraperAgent rate limited, backing off 30s' },
            { time: '12:33:58', level: 'info', msg: 'Memory cleanup completed, freed 234MB' },
            { time: '12:33:42', level: 'error', msg: 'BrowserAgent captcha detected, retrying with solver' },
          ].map((event, i) => (
            <div key={i} className="flex items-start gap-3 py-1.5 px-2 rounded bg-[#2d2d2d]">
              <span className="text-[#6e6e6e]">{event.time}</span>
              <span className={`uppercase text-[10px] px-1.5 py-0.5 rounded ${
                event.level === 'info' ? 'bg-[#9cdcfe]/20 text-[#9cdcfe]' :
                event.level === 'success' ? 'bg-[#4ec9b0]/20 text-[#4ec9b0]' :
                event.level === 'warning' ? 'bg-[#dcdcaa]/20 text-[#dcdcaa]' :
                'bg-[#f14c4c]/20 text-[#f14c4c]'
              }`}>
                {event.level}
              </span>
              <span className="text-[#cccccc] flex-1">{event.msg}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
