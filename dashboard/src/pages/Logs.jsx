import {
    Download,
    Pause,
    Play,
    Search,
    Trash2
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

const LOG_LEVELS = ['all', 'info', 'success', 'warning', 'error'];

function LogEntry({ log }) {
  const levelColors = {
    info: 'bg-[#9cdcfe]/20 text-[#9cdcfe]',
    success: 'bg-[#4ec9b0]/20 text-[#4ec9b0]',
    warning: 'bg-[#dcdcaa]/20 text-[#dcdcaa]',
    error: 'bg-[#f14c4c]/20 text-[#f14c4c]',
    debug: 'bg-[#858585]/20 text-[#858585]',
  };

  return (
    <div className="flex items-start gap-3 py-2 px-3 hover:bg-[#2d2d2d] transition-colors font-mono text-xs border-b border-[#3c3c3c]/50 last:border-0">
      <span className="text-[#6e6e6e] shrink-0">{log.timestamp}</span>
      <span className={`uppercase text-[10px] px-1.5 py-0.5 rounded shrink-0 ${levelColors[log.level]}`}>
        {log.level}
      </span>
      <span className="text-[#0078d4] shrink-0">[{log.source}]</span>
      <span className="text-[#cccccc] flex-1 break-all">{log.message}</span>
    </div>
  );
}

export default function Logs() {
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const logsEndRef = useRef(null);

  // Generate mock logs
  useEffect(() => {
    const sources = ['Discord', 'AI', 'Database', 'Agent', 'System', 'API'];
    const levels = ['info', 'success', 'warning', 'error'];
    const messages = [
      'Connected to Discord gateway',
      'AI response generated successfully',
      'Database query completed in 45ms',
      'Agent task completed',
      'User command processed: /jarvis',
      'Rate limit warning: approaching threshold',
      'Memory cleanup triggered',
      'Provider failover: switching to Groq',
      'Captcha detected, solving...',
      'Session created for user',
      'Message cached successfully',
      'Webhook received from external service',
      'Scheduled task executed',
      'Connection pool refreshed',
    ];

    const generateLog = () => ({
      timestamp: new Date().toLocaleTimeString(),
      level: levels[Math.floor(Math.random() * levels.length)],
      source: sources[Math.floor(Math.random() * sources.length)],
      message: messages[Math.floor(Math.random() * messages.length)],
    });

    // Initial logs
    setLogs(Array.from({ length: 50 }, generateLog));

    // Add new logs periodically
    const interval = setInterval(() => {
      if (!paused) {
        setLogs(prev => [...prev.slice(-200), generateLog()]);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [paused]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  // Fetch real logs from backend
  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const res = await fetch('/api/dashboard/logs');
        if (res.ok) {
          const data = await res.json();
          if (data.logs) setLogs(data.logs);
        }
      } catch {
        // Use mock logs
      }
    };
    fetchLogs();
  }, []);

  const filteredLogs = logs.filter(log => {
    if (filter !== 'all' && log.level !== filter) return false;
    if (search && !log.message.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const handleClear = () => setLogs([]);
  const handleExport = () => {
    const content = filteredLogs.map(l => `${l.timestamp} [${l.level}] [${l.source}] ${l.message}`).join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jarvis-logs-${new Date().toISOString().slice(0,10)}.txt`;
    a.click();
  };

  return (
    <div className="h-full flex flex-col p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-[#cccccc]">System Logs</h1>
          <p className="text-sm text-[#858585]">Real-time application logs</p>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setPaused(!paused)}
            className={`flex items-center gap-2 px-3 py-2 rounded text-xs transition-colors ${
              paused ? 'bg-[#4ec9b0] text-black' : 'bg-[#2d2d2d] text-[#cccccc] hover:bg-[#3c3c3c]'
            }`}
          >
            {paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button 
            onClick={handleExport}
            className="flex items-center gap-2 px-3 py-2 rounded text-xs bg-[#2d2d2d] text-[#cccccc] hover:bg-[#3c3c3c] transition-colors"
          >
            <Download className="w-3 h-3" />
            Export
          </button>
          <button 
            onClick={handleClear}
            className="flex items-center gap-2 px-3 py-2 rounded text-xs bg-[#f14c4c] text-white hover:bg-[#d93e3e] transition-colors"
          >
            <Trash2 className="w-3 h-3" />
            Clear
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 mb-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6e6e6e]" />
          <input
            type="text"
            placeholder="Search logs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded bg-[#2d2d2d] border border-[#3c3c3c] text-sm text-[#cccccc] placeholder-[#6e6e6e] focus:border-[#0078d4] focus:outline-none"
          />
        </div>
        <div className="flex gap-1">
          {LOG_LEVELS.map(level => (
            <button
              key={level}
              onClick={() => setFilter(level)}
              className={`px-3 py-2 rounded text-xs capitalize transition-colors ${
                filter === level 
                  ? 'bg-[#0078d4] text-white' 
                  : 'bg-[#2d2d2d] text-[#cccccc] hover:bg-[#3c3c3c]'
              }`}
            >
              {level}
            </button>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="flex gap-4 mb-4">
        <div className="flex items-center gap-2 text-xs text-[#858585]">
          <span className="w-2 h-2 rounded-full bg-[#9cdcfe]" />
          Info: {logs.filter(l => l.level === 'info').length}
        </div>
        <div className="flex items-center gap-2 text-xs text-[#858585]">
          <span className="w-2 h-2 rounded-full bg-[#4ec9b0]" />
          Success: {logs.filter(l => l.level === 'success').length}
        </div>
        <div className="flex items-center gap-2 text-xs text-[#858585]">
          <span className="w-2 h-2 rounded-full bg-[#dcdcaa]" />
          Warning: {logs.filter(l => l.level === 'warning').length}
        </div>
        <div className="flex items-center gap-2 text-xs text-[#858585]">
          <span className="w-2 h-2 rounded-full bg-[#f14c4c]" />
          Error: {logs.filter(l => l.level === 'error').length}
        </div>
        <div className="flex-1" />
        <label className="flex items-center gap-2 text-xs text-[#858585] cursor-pointer">
          <input 
            type="checkbox" 
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="rounded border-[#3c3c3c]"
          />
          Auto-scroll
        </label>
      </div>

      {/* Log Container */}
      <div className="flex-1 bg-[#1e1e1e] border border-[#3c3c3c] rounded-lg overflow-auto">
        {filteredLogs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[#6e6e6e] text-sm">
            {search || filter !== 'all' ? 'No matching logs found' : 'No logs yet'}
          </div>
        ) : (
          <div>
            {filteredLogs.map((log, i) => (
              <LogEntry key={i} log={log} />
            ))}
            <div ref={logsEndRef} />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-2 flex items-center justify-between text-xs text-[#6e6e6e]">
        <span>{filteredLogs.length} of {logs.length} entries shown</span>
        <span>{paused ? 'Paused' : 'Live'}</span>
      </div>
    </div>
  );
}
