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
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
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
        .status-dot.operational { background: #00cc6a; box-shadow: 0 0 8px rgba(0,204,106,0.4); }
        .status-dot.degraded { background: #f59e0b; box-shadow: 0 0 8px rgba(245,158,11,0.4); }
        .status-dot.down { background: #ef4444; box-shadow: 0 0 8px rgba(239,68,68,0.4); }
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
            color: #00d4ff;
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
        .date-range { color: #555; font-size: 0.8rem; }

        .uptime-component {
            margin-bottom: 1.25rem;
        }
        .uptime-component:last-child { margin-bottom: 0; }
        .uptime-component-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 0.5rem;
        }
        .uptime-component-name {
            font-weight: 500;
            font-size: 0.9rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            color: #ccc;
        }
        .uptime-component-name .check { font-size: 0.85rem; }
        .uptime-component-name .check.ok { color: #00cc6a; }
        .uptime-component-name .check.warn { color: #f59e0b; }
        .component-detail { color: #555; font-size: 0.8rem; }

        .uptime-bar {
            display: flex;
            gap: 1px;
            height: 28px;
            border-radius: 3px;
            overflow: hidden;
        }
        .uptime-bar .day {
            flex: 1;
            min-width: 2px;
            background: #00cc6a;
            transition: opacity 0.15s;
            cursor: pointer;
            position: relative;
        }
        .uptime-bar .day:hover { opacity: 0.8; }
        .uptime-bar .day.degraded { background: #f59e0b; }
        .uptime-bar .day.down { background: #ef4444; }
        .uptime-bar .day.unknown { background: #2a2a35; }
        .uptime-bar .day .tooltip {
            display: none;
            position: absolute;
            bottom: 100%;
            left: 50%;
            transform: translateX(-50%);
            background: #1a1a24;
            border: 1px solid rgba(255,255,255,0.12);
            padding: 0.4rem 0.6rem;
            border-radius: 6px;
            font-size: 0.7rem;
            white-space: nowrap;
            z-index: 100;
            margin-bottom: 4px;
            color: #aaa;
        }
        .uptime-bar .day:hover .tooltip { display: block; }

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
        .service-status.operational .dot { background: #00cc6a; }
        .service-status.operational { color: #00cc6a; }
        .service-status.degraded .dot { background: #f59e0b; }
        .service-status.degraded { color: #f59e0b; }
        .service-status.down .dot { background: #ef4444; }
        .service-status.down { color: #ef4444; }

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
        .cf-badge.ok { background: rgba(0,204,106,0.1); color: #00cc6a; }
        .cf-badge.warn { background: rgba(245,158,11,0.1); color: #f59e0b; }
        .cf-badge.error { background: rgba(239,68,68,0.1); color: #ef4444; }
        .cf-incident {
            padding: 0.75rem 1rem;
            border-left: 3px solid #f59e0b;
            background: rgba(245,158,11,0.04);
            margin-bottom: 0.75rem;
            border-radius: 0 6px 6px 0;
            font-size: 0.85rem;
        }
        .cf-incident.critical { border-left-color: #ef4444; background: rgba(239,68,68,0.04); }
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
    \${NAV_HTML}
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
                <h2>Uptime</h2>
                <span class="date-range" id="dateRange"></span>
            </div>

            <div class="uptime-component" id="apiComponent">
                <div class="uptime-component-header">
                    <span class="uptime-component-name"><span class="check ok" id="apiCheck">&#10003;</span> AI Providers</span>
                    <span class="component-detail" id="apiProviderCount">-- active</span>
                </div>
                <div class="uptime-bar" id="apiUptimeBar"></div>
            </div>

            <div class="uptime-component" id="discordComponent">
                <div class="uptime-component-header">
                    <span class="uptime-component-name"><span class="check ok" id="discordCheck">&#10003;</span> Discord Bot</span>
                    <span class="component-detail" id="discordGuildCount">-- servers</span>
                </div>
                <div class="uptime-bar" id="discordUptimeBar"></div>
            </div>

            <div class="uptime-component" id="dbComponent">
                <div class="uptime-component-header">
                    <span class="uptime-component-name"><span class="check ok" id="dbCheck">&#10003;</span> Database</span>
                    <span class="component-detail">MongoDB</span>
                </div>
                <div class="uptime-bar" id="dbUptimeBar"></div>
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

        async function fetchStatus() {
            try {
                const res = await fetch('/api/dashboard/health');
                if (res.ok) {
                    healthData = await res.json();
                    updateMetrics(healthData);
                    updateServices(healthData);
                    updateUptimeBars(healthData);
                }
            } catch (e) {
                console.error('Failed to fetch status:', e);
            }
        }

        function updateMetrics(data) {
            document.getElementById('uptime').textContent = data.uptime || '--';
            document.getElementById('aiCalls').textContent = (data.aiCalls || 0).toLocaleString();
            document.getElementById('guilds').textContent = data.discord?.guilds || '--';
            document.getElementById('providers').textContent = (data.activeProviders || 0) + '/' + (data.providers || 0);

            document.getElementById('apiProviderCount').textContent = (data.activeProviders || 0) + ' active';
            document.getElementById('discordGuildCount').textContent = (data.discord?.guilds || 0) + ' servers';
        }

        function updateServices(data) {
            const discordOk = data.discord?.guilds > 0;
            const aiOk = data.activeProviders > 0;
            const dbOk = data.status === 'healthy';

            updateServiceStatus('svcDiscord', discordOk);
            updateServiceStatus('svcAI', aiOk);
            updateServiceStatus('svcDB', dbOk);
            updateServiceStatus('svcWeb', true);

            updateComponentCheck('apiCheck', aiOk);
            updateComponentCheck('discordCheck', discordOk);
            updateComponentCheck('dbCheck', dbOk);

            const allOk = discordOk && aiOk && dbOk;
            const overall = document.getElementById('overallStatus');
            const subtext = document.getElementById('statusSubtext');
            if (allOk) {
                overall.innerHTML = '<span class="status-dot operational"></span><span>All Systems Operational</span>';
                subtext.textContent = "No issues detected.";
            } else {
                overall.innerHTML = '<span class="status-dot degraded"></span><span>Some Systems Degraded</span>';
                subtext.textContent = "Some services may be experiencing issues.";
            }
        }

        function updateComponentCheck(id, isOk) {
            const el = document.getElementById(id);
            if (el) {
                el.innerHTML = isOk ? '&#10003;' : '!';
                el.className = 'check ' + (isOk ? 'ok' : 'warn');
            }
        }

        function updateServiceStatus(id, isOk) {
            const el = document.getElementById(id);
            if (isOk) {
                el.className = 'service-status operational';
                el.innerHTML = '<span class="dot"></span> Operational';
            } else {
                el.className = 'service-status degraded';
                el.innerHTML = '<span class="dot"></span> Degraded';
            }
        }

        function updateUptimeBars(data) {
            const now = new Date();
            const days = 90;

            const startDate = new Date(now);
            startDate.setDate(startDate.getDate() - days);
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            document.getElementById('dateRange').textContent =
                months[startDate.getMonth()] + ' ' + startDate.getDate() + ' - ' +
                months[now.getMonth()] + ' ' + now.getDate() + ', ' + now.getFullYear();

            const apiOk = data.activeProviders > 0;
            const discordOk = data.discord?.guilds > 0;
            const dbOk = data.status === 'healthy';

            renderUptimeBar('apiUptimeBar', days, apiOk);
            renderUptimeBar('discordUptimeBar', days, discordOk);
            renderUptimeBar('dbUptimeBar', days, dbOk);
        }

        function renderUptimeBar(containerId, days, currentlyOk) {
            const container = document.getElementById(containerId);
            const now = new Date();
            let html = '';

            for (let i = days - 1; i >= 0; i--) {
                const date = new Date(now);
                date.setDate(date.getDate() - i);
                const dateStr = date.toLocaleDateString();

                let status, statusText;
                if (i === 0) {
                    status = currentlyOk ? 'operational' : 'degraded';
                    statusText = currentlyOk ? 'Operational' : 'Degraded';
                } else {
                    status = 'unknown';
                    statusText = 'No data';
                }

                html += '<div class="day ' + status + '">';
                html += '<div class="tooltip">' + dateStr + '<br>' + statusText + '</div>';
                html += '</div>';
            }

            container.innerHTML = html;
        }

        async function fetchCloudflareStatus() {
            const container = document.getElementById('cloudflareUpdates');
            try {
                const res = await fetch('https://www.cloudflarestatus.com/api/v2/summary.json');
                if (res.ok) {
                    const data = await res.json();
                    let html = '';

                    const status = data.status?.indicator || 'none';
                    const statusDesc = data.status?.description || 'All Systems Operational';
                    const badgeClass = status === 'none' ? 'ok' : (status === 'critical' ? 'error' : 'warn');

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
            const div = document.createElement('div');
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
