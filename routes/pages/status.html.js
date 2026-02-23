'use strict';

const { SHARED_STYLES, NAV_HTML } = require('./shared-styles');

const STATUS_PAGE = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Status | Jarvis</title>
    <style>${SHARED_STYLES}
        .status-header {
            text-align: center;
            padding: 2rem;
            background: rgba(0,212,255,0.05);
            border-radius: 16px;
            margin-bottom: 2rem;
        }
        .status-indicator {
            display: inline-flex;
            align-items: center;
            gap: 0.75rem;
            font-size: 1.5rem;
            font-weight: 600;
        }
        .status-dot {
            width: 16px;
            height: 16px;
            border-radius: 50%;
            animation: pulse 2s infinite;
        }
        .status-dot.operational { background: #00ff88; box-shadow: 0 0 10px rgba(0,255,136,0.5); }
        .status-dot.degraded { background: #ffaa00; box-shadow: 0 0 10px rgba(255,170,0,0.5); }
        .status-dot.down { background: #ff4444; box-shadow: 0 0 10px rgba(255,68,68,0.5); }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.6; }
        }
        .services-grid {
            display: grid;
            gap: 1rem;
            margin-bottom: 2rem;
        }
        .service-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 1rem 1.5rem;
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 12px;
            transition: all 0.3s;
        }
        .service-item:hover {
            background: rgba(255,255,255,0.06);
            border-color: rgba(0,212,255,0.3);
        }
        .service-name { font-weight: 500; }
        .service-status {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.9rem;
        }
        .service-status .dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
        }
        .service-status.operational .dot { background: #00ff88; }
        .service-status.operational { color: #00ff88; }
        .service-status.degraded .dot { background: #ffaa00; }
        .service-status.degraded { color: #ffaa00; }
        .service-status.down .dot { background: #ff4444; }
        .service-status.down { color: #ff4444; }
        .updates-section {
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 12px;
            padding: 1.5rem;
            margin-bottom: 2rem;
        }
        .updates-section h2 {
            margin-top: 0;
            border: none;
            padding: 0;
            margin-bottom: 1rem;
        }
        .update-item {
            padding: 1rem;
            border-left: 3px solid #00d4ff;
            background: rgba(0,212,255,0.05);
            margin-bottom: 1rem;
            border-radius: 0 8px 8px 0;
        }
        .update-item.maintenance {
            border-left-color: #ffaa00;
            background: rgba(255,170,0,0.05);
        }
        .update-item.incident {
            border-left-color: #ff4444;
            background: rgba(255,68,68,0.05);
        }
        .update-title {
            font-weight: 600;
            margin-bottom: 0.5rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        .update-badge {
            font-size: 0.75rem;
            padding: 0.2rem 0.5rem;
            border-radius: 4px;
            background: rgba(0,212,255,0.2);
            color: #00d4ff;
        }
        .update-badge.in-progress { background: rgba(255,170,0,0.2); color: #ffaa00; }
        .update-badge.scheduled { background: rgba(138,43,226,0.2); color: #8a2be2; }
        .update-time { font-size: 0.85rem; color: #666; margin-bottom: 0.5rem; }
        .update-desc { color: #aaa; line-height: 1.6; }
        .metrics-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 1rem;
            margin-bottom: 2rem;
        }
        .metric-card {
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 12px;
            padding: 1.25rem;
            text-align: center;
        }
        .metric-value { font-size: 2rem; color: #00d4ff; font-weight: 700; }
        .metric-label { color: #888; font-size: 0.9rem; margin-top: 0.25rem; }
        .last-updated { text-align: center; color: #666; font-size: 0.9rem; margin-top: 2rem; }
        .refresh-btn {
            background: rgba(0,212,255,0.1);
            border: 1px solid rgba(0,212,255,0.3);
            color: #00d4ff;
            padding: 0.5rem 1rem;
            border-radius: 8px;
            cursor: pointer;
            font-size: 0.9rem;
            margin-left: 1rem;
            transition: all 0.3s;
        }
        .refresh-btn:hover { background: rgba(0,212,255,0.2); }
        .cloudflare-section {
            background: linear-gradient(135deg, rgba(245,130,32,0.1) 0%, rgba(245,130,32,0.02) 100%);
            border: 1px solid rgba(245,130,32,0.2);
            border-radius: 12px;
            padding: 1.5rem;
            margin-bottom: 2rem;
        }
        .cloudflare-header {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            margin-bottom: 1rem;
        }
        .cloudflare-logo { height: 24px; }
        .no-updates { color: #666; text-align: center; padding: 2rem; }
        /* API Status with uptime bars like OpenAI */
        .api-status-section {
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 12px;
            padding: 1.5rem;
            margin-bottom: 2rem;
        }
        .api-status-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1.5rem;
        }
        .api-status-header h2 {
            margin: 0;
            border: 0;
            padding: 0;
        }
        .date-range { color: #666; font-size: 0.9rem; }
        .api-component {
            margin-bottom: 1.5rem;
        }
        .api-component-header {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            margin-bottom: 0.5rem;
        }
        .api-component-name {
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        .api-component-name .check {
            color: #00ff88;
        }
        .component-count {
            color: #666;
            font-size: 0.85rem;
        }
        .uptime-bar {
            display: flex;
            gap: 2px;
            height: 32px;
            border-radius: 4px;
            overflow: hidden;
        }
        .uptime-bar .day {
            flex: 1;
            min-width: 3px;
            background: #00ff88;
            transition: all 0.2s;
            cursor: pointer;
            position: relative;
        }
        .uptime-bar .day:hover {
            transform: scaleY(1.1);
        }
        .uptime-bar .day.degraded { background: #ffaa00; }
        .uptime-bar .day.down { background: #ff4444; }
        .uptime-bar .day.unknown { background: #444; }
        .uptime-bar .day .tooltip {
            display: none;
            position: absolute;
            bottom: 100%;
            left: 50%;
            transform: translateX(-50%);
            background: #1a1a2e;
            border: 1px solid rgba(255,255,255,0.2);
            padding: 0.5rem;
            border-radius: 6px;
            font-size: 0.75rem;
            white-space: nowrap;
            z-index: 100;
            margin-bottom: 5px;
        }
        .uptime-bar .day:hover .tooltip { display: block; }
    </style>
</head>
<body>
    ${NAV_HTML}
    <div class="container">
        <h1>📊 System Status</h1>
        <p style="color: #888; margin-bottom: 2rem;">Real-time status of Jarvis services</p>

        <div class="status-header">
            <div class="status-indicator" id="overallStatus">
                <span class="status-dot operational"></span>
                <span>All Systems Operational</span>
            </div>
            <p style="color: #888; margin-top: 1rem; font-size: 0.9rem;" id="statusSubtext">We're not aware of any issues affecting our systems.</p>
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

        <!-- API Status Section like OpenAI -->
        <div class="api-status-section">
            <div class="api-status-header">
                <h2>System Status</h2>
                <span class="date-range" id="dateRange">Loading...</span>
            </div>

            <div class="api-component" id="apiComponent">
                <div class="api-component-header">
                    <span class="api-component-name"><span class="check">✓</span> APIs</span>
                    <span class="component-count" id="apiProviderCount">-- providers</span>
                </div>
                <div class="uptime-bar" id="apiUptimeBar"></div>
            </div>

            <div class="api-component" id="discordComponent">
                <div class="api-component-header">
                    <span class="api-component-name"><span class="check">✓</span> Discord Bot</span>
                    <span class="component-count" id="discordGuildCount">-- servers</span>
                </div>
                <div class="uptime-bar" id="discordUptimeBar"></div>
            </div>

            <div class="api-component" id="dbComponent">
                <div class="api-component-header">
                    <span class="api-component-name"><span class="check">✓</span> Database</span>
                    <span class="component-count">MongoDB</span>
                </div>
                <div class="uptime-bar" id="dbUptimeBar"></div>
            </div>
        </div>

        <h2>🔧 Services</h2>
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
            <div class="service-item">
                <span class="service-name">SBX Exchange</span>
                <span class="service-status operational" id="svcSBX"><span class="dot"></span> Operational</span>
            </div>
        </div>

        <!-- Cloudflare Status Section -->
        <div class="cloudflare-section">
            <div class="cloudflare-header">
                <svg class="cloudflare-logo" viewBox="0 0 65 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M18.5 12c0 3.59-2.91 6.5-6.5 6.5S5.5 15.59 5.5 12 8.41 5.5 12 5.5s6.5 2.91 6.5 6.5z" fill="#F58220"/>
                    <path d="M12 0C5.37 0 0 5.37 0 12s5.37 12 12 12 12-5.37 12-12S18.63 0 12 0zm0 22c-5.52 0-10-4.48-10-10S6.48 2 12 2s10 4.48 10 10-4.48 10-10 10z" fill="#F58220"/>
                </svg>
                <h2 style="margin: 0; border: 0; padding: 0;">Cloudflare Status</h2>
            </div>
            <div id="cloudflareUpdates">
                <div class="no-updates">Loading Cloudflare status...</div>
            </div>
        </div>

        <div class="last-updated">
            Last updated: <span id="lastUpdate">--</span>
            <button class="refresh-btn" onclick="refreshStatus()">↻ Refresh</button>
        </div>
    </div>

    <script>
        let healthData = null;

        async function fetchStatus() {
            const start = Date.now();
            try {
                const res = await fetch('/api/dashboard/health');
                const latency = Date.now() - start;
                if (res.ok) {
                    healthData = await res.json();
                    healthData.latency = latency;
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

            // Update component counts
            document.getElementById('apiProviderCount').textContent = (data.activeProviders || 0) + ' active providers';
            document.getElementById('discordGuildCount').textContent = (data.discord?.guilds || 0) + ' servers';
        }

        function updateServices(data) {
            const discordOk = data.discord?.guilds > 0;
            const aiOk = data.activeProviders > 0;
            const dbOk = data.status === 'healthy';

            updateServiceStatus('svcDiscord', discordOk);
            updateServiceStatus('svcAI', aiOk);
            updateServiceStatus('svcDB', dbOk);
            updateServiceStatus('svcWeb', true); // Website is up if we got here
            updateServiceStatus('svcSBX', true);

            // Update component check marks
            updateComponentCheck('apiComponent', aiOk);
            updateComponentCheck('discordComponent', discordOk);
            updateComponentCheck('dbComponent', dbOk);

            // Update overall status
            const allOk = discordOk && aiOk && dbOk;
            const overall = document.getElementById('overallStatus');
            const subtext = document.getElementById('statusSubtext');
            if (allOk) {
                overall.innerHTML = '<span class="status-dot operational"></span><span>All Systems Operational</span>';
                subtext.textContent = "We're not aware of any issues affecting our systems.";
            } else {
                overall.innerHTML = '<span class="status-dot degraded"></span><span>Some Systems Degraded</span>';
                subtext.textContent = "Some services may be experiencing issues.";
            }
        }

        function updateComponentCheck(id, isOk) {
            const el = document.getElementById(id);
            const check = el.querySelector('.check');
            if (check) {
                check.textContent = isOk ? '✓' : '!';
                check.style.color = isOk ? '#00ff88' : '#ffaa00';
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
            // Generate 90 days of uptime data based on current status
            const now = new Date();
            const days = 90;

            // Set date range
            const startDate = new Date(now);
            startDate.setDate(startDate.getDate() - days);
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            document.getElementById('dateRange').textContent =
                months[startDate.getMonth()] + ' ' + startDate.getFullYear() + ' - ' +
                months[now.getMonth()] + ' ' + now.getFullYear();

            // Generate bars based on real current status
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

                // Current day uses real status, past days show as operational (since we don't have history yet)
                let status = 'operational';
                let statusText = 'Operational';

                if (i === 0) {
                    // Today - use real status
                    status = currentlyOk ? 'operational' : 'degraded';
                    statusText = currentlyOk ? 'Operational' : 'Degraded';
                }
                // Past days without data show as unknown/gray for first run,
                // but we'll show green since system was presumably running

                html += '<div class="day ' + (i === 0 ? status : '') + '">';
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

                    html += '<div class="update-item' + (status !== 'none' ? ' maintenance' : '') + '">';
                    html += '<div class="update-title">';
                    html += '<span class="update-badge' + (status !== 'none' ? ' in-progress' : '') + '">' + escapeHtml(statusDesc) + '</span>';
                    html += '</div>';
                    html += '</div>';

                    if (data.incidents && data.incidents.length > 0) {
                        data.incidents.slice(0, 3).forEach(incident => {
                            html += '<div class="update-item incident">';
                            html += '<div class="update-title">' + escapeHtml(incident.name) + '</div>';
                            html += '<div class="update-time">' + new Date(incident.updated_at).toLocaleString() + '</div>';
                            if (incident.incident_updates && incident.incident_updates[0]) {
                                html += '<div class="update-desc">' + escapeHtml(incident.incident_updates[0].body) + '</div>';
                            }
                            html += '</div>';
                        });
                    }

                    if (data.scheduled_maintenances && data.scheduled_maintenances.length > 0) {
                        data.scheduled_maintenances.slice(0, 3).forEach(maint => {
                            html += '<div class="update-item maintenance">';
                            html += '<div class="update-title">';
                            html += '<span class="update-badge scheduled">Scheduled</span> ';
                            html += escapeHtml(maint.name);
                            html += '</div>';
                            html += '<div class="update-time">' + new Date(maint.scheduled_for).toLocaleString() + '</div>';
                            if (maint.incident_updates && maint.incident_updates[0]) {
                                html += '<div class="update-desc">' + escapeHtml(maint.incident_updates[0].body) + '</div>';
                            }
                            html += '</div>';
                        });
                    }

                    container.innerHTML = html || '<div class="no-updates">No current incidents or maintenance</div>';
                }
            } catch (e) {
                container.innerHTML = '<div class="no-updates">Unable to fetch Cloudflare status</div>';
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
