'use strict';

const { SHARED_STYLES, NAV_HTML } = require('./shared-styles');

const STATUS_PAGE = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Status | Jarvis</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Comic+Neue:wght@400;700&display=swap" rel="stylesheet">
    <style>${SHARED_STYLES}

        .status-header {
            text-align: center;
            padding: 2.5rem 2rem;
            background: rgba(255,255,255,0.02);
            border: 1px solid rgba(255,255,255,0.06);
            border-radius: 12px;
            margin-bottom: 2rem;
        }
        .status-indicator {
            display: inline-flex;
            align-items: center;
            gap: 0.75rem;
            font-size: 1.35rem;
            font-weight: 600;
            color: #fff;
        }
        .status-dot {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            animation: pulse 2s infinite;
        }
        .status-dot.operational { background: #fff; box-shadow: 0 0 8px rgba(255,255,255,0.3); }
        .status-dot.degraded { background: #888; box-shadow: 0 0 8px rgba(136,136,136,0.3); }
        .status-dot.down { background: #555; box-shadow: 0 0 8px rgba(85,85,85,0.3); }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }

        .metrics-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 1rem;
            margin-bottom: 2rem;
        }
        .metric-card {
            background: rgba(255,255,255,0.02);
            border: 1px solid rgba(255,255,255,0.06);
            border-radius: 10px;
            padding: 1.25rem;
            text-align: center;
        }
        .metric-value {
            font-size: 1.75rem;
            color: #fff;
            font-weight: 700;
            font-variant-numeric: tabular-nums;
        }
        .metric-label { color: #666; font-size: 0.8rem; margin-top: 0.25rem; }

        /* Uptime section */
        .uptime-section {
            background: rgba(255,255,255,0.02);
            border: 1px solid rgba(255,255,255,0.06);
            border-radius: 10px;
            padding: 1.5rem;
            margin-bottom: 2rem;
        }
        .uptime-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1.5rem;
        }
        .uptime-header h2 { margin: 0; }
        .date-range { color: #555; font-size: 0.85rem; }

        .uptime-component {
            margin-bottom: 1.5rem;
        }
        .uptime-component:last-child { margin-bottom: 0; }
        .uptime-component-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 0.4rem;
        }
        .uptime-component-name {
            font-weight: 600;
            font-size: 0.9rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            color: #ccc;
        }
        .uptime-component-name .status-icon {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #fff;
        }
        .uptime-component-name .status-icon.degraded { background: #888; }
        .uptime-component-name .status-icon.down { background: #555; }
        .uptime-pct { color: #666; font-size: 0.85rem; font-weight: 500; }

        .uptime-bar {
            display: flex;
            gap: 1.5px;
            height: 32px;
            border-radius: 3px;
            overflow: hidden;
        }
        .uptime-bar .day {
            flex: 1;
            min-width: 0;
            border-radius: 2px;
            transition: opacity 0.15s;
            cursor: pointer;
            position: relative;
        }
        .uptime-bar .day:hover { opacity: 0.7; }
        .uptime-bar .day.operational { background: #fff; }
        .uptime-bar .day.degraded { background: #666; }
        .uptime-bar .day.down { background: #333; }
        .uptime-bar .day.unknown { background: #1a1a1a; }
        .uptime-bar .day .tooltip {
            display: none;
            position: absolute;
            bottom: calc(100% + 6px);
            left: 50%;
            transform: translateX(-50%);
            background: #111;
            border: 1px solid rgba(255,255,255,0.15);
            padding: 0.5rem 0.75rem;
            border-radius: 6px;
            font-size: 0.75rem;
            white-space: nowrap;
            z-index: 100;
            color: #ccc;
            pointer-events: none;
        }
        .uptime-bar .day .tooltip::after {
            content: '';
            position: absolute;
            top: 100%;
            left: 50%;
            transform: translateX(-50%);
            border: 5px solid transparent;
            border-top-color: #111;
        }
        .uptime-bar .day:hover .tooltip { display: block; }

        .bar-footer {
            display: flex;
            justify-content: space-between;
            margin-top: 0.3rem;
            font-size: 0.7rem;
            color: #444;
        }

        /* Services */
        .services-grid {
            display: grid;
            gap: 0.5rem;
            margin-bottom: 2rem;
        }
        .service-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0.85rem 1.25rem;
            background: rgba(255,255,255,0.02);
            border: 1px solid rgba(255,255,255,0.06);
            border-radius: 8px;
            transition: border-color 0.2s;
        }
        .service-item:hover { border-color: rgba(255,255,255,0.12); }
        .service-name { font-weight: 500; font-size: 0.9rem; color: #ccc; }
        .service-status {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.8rem;
            font-weight: 500;
        }
        .service-status .dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
        }
        .service-status.operational .dot { background: #fff; }
        .service-status.operational { color: #fff; }
        .service-status.degraded .dot { background: #888; }
        .service-status.degraded { color: #888; }
        .service-status.down .dot { background: #555; }
        .service-status.down { color: #555; }

        /* Cloudflare */
        .cloudflare-section {
            background: rgba(255,255,255,0.02);
            border: 1px solid rgba(255,255,255,0.06);
            border-radius: 10px;
            padding: 1.5rem;
            margin-bottom: 2rem;
        }
        .cloudflare-header {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            margin-bottom: 1rem;
        }
        .cloudflare-header h2 { margin: 0; font-size: 1rem; }
        .cf-badge {
            display: inline-block;
            padding: 0.2rem 0.6rem;
            border-radius: 4px;
            font-size: 0.7rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.03em;
        }
        .cf-badge.ok { background: rgba(255,255,255,0.1); color: #fff; }
        .cf-badge.warn { background: rgba(255,255,255,0.06); color: #888; }
        .cf-badge.error { background: rgba(255,255,255,0.04); color: #555; }
        .cf-incident {
            padding: 0.75rem 1rem;
            border-left: 3px solid #888;
            background: rgba(255,255,255,0.02);
            margin-bottom: 0.75rem;
            border-radius: 0 6px 6px 0;
            font-size: 0.85rem;
        }
        .cf-incident.critical { border-left-color: #555; background: rgba(255,255,255,0.02); }
        .cf-incident-title { font-weight: 600; color: #ccc; margin-bottom: 0.25rem; }
        .cf-incident-time { color: #555; font-size: 0.75rem; margin-bottom: 0.25rem; }
        .cf-incident-desc { color: #888; font-size: 0.8rem; line-height: 1.5; }
        .no-incidents { color: #555; text-align: center; padding: 1.5rem; font-size: 0.85rem; }

        /* Footer */
        .last-updated {
            text-align: center;
            color: #444;
            font-size: 0.8rem;
            margin-top: 2rem;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.75rem;
        }
        .refresh-btn {
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.08);
            color: #888;
            padding: 0.35rem 0.75rem;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.8rem;
            font-family: inherit;
            transition: all 0.2s;
        }
        .refresh-btn:hover { background: rgba(255,255,255,0.08); color: #ccc; }

        @media (max-width: 768px) {
            .metrics-grid { grid-template-columns: repeat(2, 1fr); }
            .metric-value { font-size: 1.35rem; }
        }
    </style>
</head>
<body>
    ${NAV_HTML}
    <div class="container">
        <h1>System Status</h1>
        <p style="color: #555; margin-bottom: 2rem; font-size: 0.9rem;">Real-time health of Jarvis services</p>

        <div class="status-header">
            <div class="status-indicator" id="overallStatus">
                <span class="status-dot operational"></span>
                <span>All Systems Operational</span>
            </div>
            <p style="color: #555; margin-top: 0.75rem; font-size: 0.85rem;" id="statusSubtext">Checking status...</p>
        </div>

        <div class="metrics-grid" id="metricsGrid">
            <div class="metric-card">
                <div class="metric-value" id="uptime">--</div>
                <div class="metric-label">Uptime</div>
            </div>
            <div class="metric-card">
                <div class="metric-value" id="aiCalls">--</div>
                <div class="metric-label">AI Requests</div>
            </div>
            <div class="metric-card">
                <div class="metric-value" id="guilds">--</div>
                <div class="metric-label">Servers</div>
            </div>
            <div class="metric-card">
                <div class="metric-value" id="providers">--</div>
                <div class="metric-label">AI Providers</div>
            </div>
        </div>

        <div class="uptime-section">
            <div class="uptime-header">
                <h2>System Status</h2>
                <span class="date-range" id="dateRange"></span>
            </div>

            <div class="uptime-component">
                <div class="uptime-component-header">
                    <span class="uptime-component-name">
                        <span class="status-icon" id="aiIcon"></span>
                        AI Providers
                    </span>
                    <span class="uptime-pct" id="aiPct">-- %</span>
                </div>
                <div class="uptime-bar" id="aiBar"></div>
                <div class="bar-footer"><span>90 days ago</span><span>Today</span></div>
            </div>

            <div class="uptime-component">
                <div class="uptime-component-header">
                    <span class="uptime-component-name">
                        <span class="status-icon" id="discordIcon"></span>
                        Discord Bot
                    </span>
                    <span class="uptime-pct" id="discordPct">-- %</span>
                </div>
                <div class="uptime-bar" id="discordBar"></div>
                <div class="bar-footer"><span>90 days ago</span><span>Today</span></div>
            </div>

            <div class="uptime-component">
                <div class="uptime-component-header">
                    <span class="uptime-component-name">
                        <span class="status-icon" id="dbIcon"></span>
                        Database
                    </span>
                    <span class="uptime-pct" id="dbPct">-- %</span>
                </div>
                <div class="uptime-bar" id="dbBar"></div>
                <div class="bar-footer"><span>90 days ago</span><span>Today</span></div>
            </div>
        </div>

        <h2>Services</h2>
        <div class="services-grid" id="servicesGrid">
            <div class="service-item">
                <span class="service-name">Discord Bot</span>
                <span class="service-status operational" id="svcDiscord"><span class="dot"></span> Operational</span>
            </div>
            <div class="service-item">
                <span class="service-name">AI Providers</span>
                <span class="service-status operational" id="svcAI"><span class="dot"></span> Operational</span>
            </div>
            <div class="service-item">
                <span class="service-name">Database</span>
                <span class="service-status operational" id="svcDB"><span class="dot"></span> Operational</span>
            </div>
            <div class="service-item">
                <span class="service-name">Website</span>
                <span class="service-status operational" id="svcWeb"><span class="dot"></span> Operational</span>
            </div>
        </div>

        <div class="cloudflare-section">
            <div class="cloudflare-header">
                <svg height="20" viewBox="0 0 65 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M18.5 12c0 3.59-2.91 6.5-6.5 6.5S5.5 15.59 5.5 12 8.41 5.5 12 5.5s6.5 2.91 6.5 6.5z" fill="#F58220"/>
                    <path d="M12 0C5.37 0 0 5.37 0 12s5.37 12 12 12 12-5.37 12-12S18.63 0 12 0zm0 22c-5.52 0-10-4.48-10-10S6.48 2 12 2s10 4.48 10 10-4.48 10-10 10z" fill="#F58220"/>
                </svg>
                <h2>Cloudflare</h2>
            </div>
            <div id="cloudflareUpdates">
                <div class="no-incidents">Loading Cloudflare status...</div>
            </div>
        </div>

        <div class="last-updated">
            <span>Updated <span id="lastUpdate">--</span></span>
            <button class="refresh-btn" onclick="refreshStatus()">Refresh</button>
        </div>
    </div>

    <script>
        let healthData = null;
        let historyData = [];

        async function fetchStatus() {
            try {
                const [healthRes, historyRes] = await Promise.all([
                    fetch('/api/public/health'),
                    fetch('/api/public/uptime-history')
                ]);

                if (healthRes.ok) {
                    healthData = await healthRes.json();
                    updateMetrics(healthData);
                    updateServices(healthData);
                }

                if (historyRes.ok) {
                    const data = await historyRes.json();
                    historyData = data.history || [];
                }

                renderUptimeBars();
            } catch (e) {
                console.error('Failed to fetch status:', e);
            }
        }

        function updateMetrics(data) {
            document.getElementById('uptime').textContent = data.uptime || '--';
            document.getElementById('aiCalls').textContent = (data.aiCalls || 0).toLocaleString();
            document.getElementById('guilds').textContent = data.discord?.guilds || '--';
            document.getElementById('providers').textContent = (data.activeProviders || 0) + '/' + (data.providers || 0);
        }

        function updateServices(data) {
            var discordOk = data.discord?.guilds > 0;
            var aiOk = data.activeProviders > 0;
            var dbOk = data.status === 'healthy';

            setServiceStatus('svcDiscord', discordOk ? 'operational' : 'down');
            setServiceStatus('svcAI', aiOk ? 'operational' : 'down');
            setServiceStatus('svcDB', dbOk ? 'operational' : 'down');
            setServiceStatus('svcWeb', 'operational');

            var allOk = discordOk && aiOk && dbOk;
            var overall = document.getElementById('overallStatus');
            var subtext = document.getElementById('statusSubtext');
            if (allOk) {
                overall.innerHTML = '<span class="status-dot operational"></span><span>All Systems Operational</span>';
                subtext.textContent = 'No issues detected.';
            } else {
                overall.innerHTML = '<span class="status-dot degraded"></span><span>Some Systems Degraded</span>';
                subtext.textContent = 'Some services may be experiencing issues.';
            }
        }

        function setServiceStatus(id, status) {
            var el = document.getElementById(id);
            var label = status === 'operational' ? 'Operational' : status === 'degraded' ? 'Degraded' : 'Down';
            el.className = 'service-status ' + status;
            el.innerHTML = '<span class="dot"></span> ' + label;
        }

        function renderUptimeBars() {
            var now = new Date();
            var days = 90;

            // Build date range label
            var start = new Date(now);
            start.setDate(start.getDate() - days);
            var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            document.getElementById('dateRange').textContent =
                months[start.getMonth()] + ' ' + start.getFullYear() + ' \\u2014 ' +
                months[now.getMonth()] + ' ' + now.getFullYear();

            // Index history by date for fast lookup
            var historyMap = {};
            historyData.forEach(function(d) { historyMap[d.date] = d; });

            // Determine current status from health data
            var currentAi = healthData && healthData.activeProviders > 0 ? 'operational' : 'down';
            var currentDiscord = healthData && healthData.discord?.guilds > 0 ? 'operational' : 'down';
            var currentDb = healthData && healthData.status === 'healthy' ? 'operational' : 'down';

            // Build 90-day arrays
            var aiDays = [], discordDays = [], dbDays = [];
            var aiUpCount = 0, aiTotal = 0;
            var discordUpCount = 0, discordTotal = 0;
            var dbUpCount = 0, dbTotal = 0;

            for (var i = days - 1; i >= 0; i--) {
                var date = new Date(now);
                date.setDate(date.getDate() - i);
                var dateKey = date.toISOString().slice(0, 10);
                var dateLabel = months[date.getMonth()] + ' ' + date.getDate() + ', ' + date.getFullYear();

                var entry = historyMap[dateKey];

                var aiStatus, discordStatus, dbStatus;
                var aiUptime, discordUptime, dbUptime;

                if (i === 0 && !entry) {
                    // Today with no history yet - use live status
                    aiStatus = currentAi;
                    discordStatus = currentDiscord;
                    dbStatus = currentDb;
                    aiUptime = null;
                    discordUptime = null;
                    dbUptime = null;
                } else if (entry) {
                    aiStatus = entry.ai.status;
                    discordStatus = entry.discord.status;
                    dbStatus = entry.database.status;
                    aiUptime = entry.ai.uptime;
                    discordUptime = entry.discord.uptime;
                    dbUptime = entry.database.uptime;
                } else {
                    aiStatus = 'unknown';
                    discordStatus = 'unknown';
                    dbStatus = 'unknown';
                    aiUptime = null;
                    discordUptime = null;
                    dbUptime = null;
                }

                aiDays.push({ date: dateLabel, status: aiStatus, uptime: aiUptime });
                discordDays.push({ date: dateLabel, status: discordStatus, uptime: discordUptime });
                dbDays.push({ date: dateLabel, status: dbStatus, uptime: dbUptime });

                if (aiStatus !== 'unknown') {
                    aiTotal++;
                    if (aiStatus === 'operational') aiUpCount++;
                }
                if (discordStatus !== 'unknown') {
                    discordTotal++;
                    if (discordStatus === 'operational') discordUpCount++;
                }
                if (dbStatus !== 'unknown') {
                    dbTotal++;
                    if (dbStatus === 'operational') dbUpCount++;
                }
            }

            // Render bars
            renderBar('aiBar', aiDays);
            renderBar('discordBar', discordDays);
            renderBar('dbBar', dbDays);

            // Update uptime percentages
            document.getElementById('aiPct').textContent = aiTotal > 0 ? ((aiUpCount / aiTotal) * 100).toFixed(1) + '% uptime' : '-- %';
            document.getElementById('discordPct').textContent = discordTotal > 0 ? ((discordUpCount / discordTotal) * 100).toFixed(1) + '% uptime' : '-- %';
            document.getElementById('dbPct').textContent = dbTotal > 0 ? ((dbUpCount / dbTotal) * 100).toFixed(1) + '% uptime' : '-- %';

            // Update status icons
            updateIcon('aiIcon', currentAi);
            updateIcon('discordIcon', currentDiscord);
            updateIcon('dbIcon', currentDb);
        }

        function renderBar(containerId, dayData) {
            var container = document.getElementById(containerId);
            var html = '';
            for (var i = 0; i < dayData.length; i++) {
                var d = dayData[i];
                var statusLabel = d.status === 'operational' ? 'Operational' :
                    d.status === 'degraded' ? 'Degraded' :
                    d.status === 'down' ? 'Down' : 'No data';
                var uptimeLabel = d.uptime !== null ? ' (' + d.uptime + '%)' : '';
                html += '<div class="day ' + d.status + '">';
                html += '<div class="tooltip">' + d.date + '<br>' + statusLabel + uptimeLabel + '</div>';
                html += '</div>';
            }
            container.innerHTML = html;
        }

        function updateIcon(id, status) {
            var el = document.getElementById(id);
            if (!el) return;
            el.className = 'status-icon';
            if (status === 'degraded') el.className += ' degraded';
            else if (status === 'down') el.className += ' down';
        }

        async function fetchCloudflareStatus() {
            var container = document.getElementById('cloudflareUpdates');
            try {
                var res = await fetch('https://www.cloudflarestatus.com/api/v2/summary.json');
                if (res.ok) {
                    var data = await res.json();
                    var html = '';

                    var status = data.status?.indicator || 'none';
                    var statusDesc = data.status?.description || 'All Systems Operational';
                    var badgeClass = status === 'none' ? 'ok' : (status === 'critical' ? 'error' : 'warn');

                    html += '<div style="margin-bottom: 0.75rem;"><span class="cf-badge ' + badgeClass + '">' + escapeHtml(statusDesc) + '</span></div>';

                    if (data.incidents && data.incidents.length > 0) {
                        data.incidents.slice(0, 3).forEach(function(incident) {
                            html += '<div class="cf-incident critical">';
                            html += '<div class="cf-incident-title">' + escapeHtml(incident.name) + '</div>';
                            html += '<div class="cf-incident-time">' + new Date(incident.updated_at).toLocaleString() + '</div>';
                            if (incident.incident_updates && incident.incident_updates[0]) {
                                html += '<div class="cf-incident-desc">' + escapeHtml(incident.incident_updates[0].body) + '</div>';
                            }
                            html += '</div>';
                        });
                    }

                    if (data.scheduled_maintenances && data.scheduled_maintenances.length > 0) {
                        data.scheduled_maintenances.slice(0, 3).forEach(function(maint) {
                            html += '<div class="cf-incident">';
                            html += '<div class="cf-incident-title"><span class="cf-badge warn">Scheduled</span> ' + escapeHtml(maint.name) + '</div>';
                            html += '<div class="cf-incident-time">' + new Date(maint.scheduled_for).toLocaleString() + '</div>';
                            if (maint.incident_updates && maint.incident_updates[0]) {
                                html += '<div class="cf-incident-desc">' + escapeHtml(maint.incident_updates[0].body) + '</div>';
                            }
                            html += '</div>';
                        });
                    }

                    if (!html || html.indexOf('cf-incident') === -1) {
                        html += '<div class="no-incidents">No active incidents or maintenance</div>';
                    }

                    container.innerHTML = html;
                }
            } catch (e) {
                container.innerHTML = '<div class="no-incidents">Unable to fetch Cloudflare status</div>';
            }
        }

        function escapeHtml(text) {
            var div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function refreshStatus() {
            document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString();
            fetchStatus();
            fetchCloudflareStatus();
        }

        refreshStatus();
        setInterval(refreshStatus, 30000);
    </script>
</body>
</html>
`;

module.exports = STATUS_PAGE;
