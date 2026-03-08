import {
  Download,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useEffect, useState } from 'react';

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
    <div className="flex items-start gap-3 border-b border-[#3c3c3c]/50 px-3 py-2 font-mono text-xs last:border-0">
      <span className="shrink-0 text-[#6e6e6e]">{log.timestamp}</span>
      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase ${levelColors[log.level] || levelColors.debug}`}>
        {log.level}
      </span>
      <span className="shrink-0 text-[#0078d4]">[{log.source}]</span>
      <span className="flex-1 break-all text-[#cccccc]">{log.message}</span>
    </div>
  );
}

export default function Logs() {
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetchLogs = async ({ quiet = false } = {}) => {
    if (quiet) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const res = await fetch('/api/dashboard/logs?limit=200');
      if (!res.ok) {
        throw new Error(`Log request failed (${res.status})`);
      }

      const data = await res.json();
      setLogs(Array.isArray(data.logs) ? data.logs : []);
      setError('');
      setLastUpdated(new Date());
    } catch (err) {
      setError(err.message || 'Failed to load logs.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchLogs();

    const interval = setInterval(() => {
      fetchLogs({ quiet: true });
    }, 15000);

    return () => clearInterval(interval);
  }, []);

  const filteredLogs = logs.filter(log => {
    if (filter !== 'all' && log.level !== filter) {
      return false;
    }

    if (!search) {
      return true;
    }

    const haystack = `${log.source || ''} ${log.message || ''}`.toLowerCase();
    return haystack.includes(search.toLowerCase());
  });

  const handleExport = () => {
    const content = filteredLogs
      .map(log => `${log.timestamp} [${log.level}] [${log.source}] ${log.message}`)
      .join('\n');

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `jarvis-logs-${new Date().toISOString().slice(0, 10)}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full flex flex-col p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-[#cccccc]">System Logs</h1>
          <p className="text-sm text-[#858585]">Recent runtime logs from the dashboard API.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExport}
            disabled={filteredLogs.length === 0}
            className="flex items-center gap-2 rounded bg-[#2d2d2d] px-3 py-2 text-xs text-[#cccccc] transition-colors hover:bg-[#3c3c3c] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="w-3 h-3" />
            Export
          </button>
          <button
            type="button"
            onClick={() => fetchLogs({ quiet: true })}
            className="flex items-center gap-2 rounded bg-[#2d2d2d] px-3 py-2 text-xs text-[#cccccc] transition-colors hover:bg-[#3c3c3c]"
          >
            <RefreshCw className={`w-3 h-3 ${(loading || refreshing) ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-[#f14c4c]/40 bg-[#f14c4c]/10 px-4 py-3 text-sm text-[#f5b7b7]">
          {error}
        </div>
      ) : null}

      <div className="flex items-center gap-4 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6e6e6e]" />
          <input
            type="text"
            placeholder="Search messages or sources..."
            value={search}
            onChange={event => setSearch(event.target.value)}
            className="w-full rounded border border-[#3c3c3c] bg-[#2d2d2d] py-2 pl-10 pr-4 text-sm text-[#cccccc] placeholder-[#6e6e6e] focus:border-[#0078d4] focus:outline-none"
          />
        </div>

        <div className="flex gap-1">
          {LOG_LEVELS.map(level => (
            <button
              key={level}
              type="button"
              onClick={() => setFilter(level)}
              className={`rounded px-3 py-2 text-xs capitalize transition-colors ${
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

      <div className="mb-4 flex items-center justify-between text-xs text-[#6e6e6e]">
        <span>{filteredLogs.length} visible entries</span>
        <span>{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : 'Waiting for first sync'}</span>
      </div>

      <div className="flex-1 overflow-auto rounded-lg border border-[#3c3c3c] bg-[#1e1e1e]">
        {loading && logs.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-[#6e6e6e]">
            Loading logs…
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-[#6e6e6e]">
            {search || filter !== 'all' ? 'No matching log entries.' : 'No log entries recorded yet.'}
          </div>
        ) : (
          <div>
            {filteredLogs.map((log, index) => (
              <LogEntry key={`${log.timestamp}-${log.source}-${index}`} log={log} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
