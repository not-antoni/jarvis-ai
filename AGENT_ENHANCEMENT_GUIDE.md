# Agent Enhancement & Robustness Guide

## Overview

The Jarvis AI agent has been enhanced with enterprise-grade robustness, captcha handling, and comprehensive monitoring. All components are configurable and can be tuned for different environments.

---

## Configuration

### Environment Variables

#### Agent Config (with `AGENT_` prefix)

```bash
# Memory Management
AGENT_MEMORY_HEAPWARNINGTHRESHOLD=80          # Warn at 80% heap usage
AGENT_MEMORY_HEAPCRITICALTHRESHOLD=90         # Critical at 90% heap
AGENT_MEMORY_AUTORESTARTONCRITICAL=true       # Auto-restart on critical

# Monitoring
AGENT_MONITORING_MEMORYPHRESHOLDPERCENT=80    # Alert threshold
AGENT_MONITORING_OPERATIONLATENCYMS=30000     # Max operation latency
AGENT_MONITORING_INACTIVESESSIONMINUTES=30    # Session idle timeout

# Sessions
AGENT_SESSIONS_MAXCONCURRENTSESSIONS=10       # Max parallel sessions
AGENT_SESSIONS_SESSIONTTLMINUTES=60           # Default TTL
AGENT_SESSIONS_SESSIONIDLETIMEOUTMINUTES=15   # Idle timeout

# Circuit Breaker
AGENT_CIRCUITBREAKER_ENABLED=true
AGENT_CIRCUITBREAKER_OPENTHRESHOLD=5          # Errors before open
AGENT_CIRCUITBREAKER_RESETIMEOUTMS=30000      # Reset delay

# Retry Policy
AGENT_RETRY_MAXRETRIES=3
AGENT_RETRY_BASEDELAYMS=1000
AGENT_RETRY_MAXDELAYMS=10000

# Auto-Healing
AGENT_AUTOHEALING_ENABLED=true
AGENT_AUTOHEALING_HEALTHCHECKINTERVALSECONDS=30
AGENT_AUTOHEALING_MAXAUTOSTARTS=5
```

#### Captcha Configuration

```bash
# Captcha Service Integration
CAPTCHA_SERVICE=2captcha              # Options: 'none', '2captcha', 'anticaptcha'
CAPTCHA_API_KEY=your_api_key_here     # API key for service
CAPTCHA_TIMEOUT=120000                # Timeout in ms
CAPTCHA_RETRIES=3                     # Retry attempts
```

#### Health Check Token

```bash
HEALTH_TOKEN=your_secure_token_here   # For /health endpoints
```

---

## Diagnostics Endpoints

### General Health

```
GET /diagnostics/health/agent/status
```
Quick health check (suitable for K8s liveness probes)

```json
{
  "status": "healthy|unhealthy",
  "health": 85,
  "circuit": "closed",
  "activeSessions": 3,
  "uptime": 3600000
}
```

### Detailed Metrics

```
GET /diagnostics/health/agent/detailed
```
Comprehensive health report with all metrics

### Full Diagnostics

```
GET /diagnostics/health/agent/diagnostics
```
Complete debugging report including recommendations

### Memory Trend Analysis

```
GET /diagnostics/health/agent/memory/trend
```
Detects memory leaks and provides recommendations

```json
{
  "current": { "heapUsedMb": 512, "heapUsedPercent": 45, ... },
  "trend": { "trend": "stable|increasing|decreasing", "slope": 0.05, "riskLevel": "low|medium|high" },
  "history": [...],
  "analysis": { "isLeaking": false, "recommendedAction": "OK" }
}
```

### Retry Strategies

```
GET /diagnostics/health/agent/retry/strategies
```
Lists available retry strategies by error type

```json
{
  "strategies": {
    "TIMEOUT": { "errorType": "TIMEOUT", "maxRetries": 4, "estimatedDelays": [...] },
    "NETWORK": { ... },
    "BROWSER_CRASH": { ... },
    "RATE_LIMIT": { ... },
    "INVALID_URL": { ... }
  }
}
```

### Auto-Healing Status

```
GET /diagnostics/health/agent/healing/status
```
Current state of auto-healing system

```json
{
  "autoHealing": { "enabled": true, "isHealthCheckRunning": true, ... },
  "monitor": { "autoRestartCount": 0, "alertCount": 5, "lastAlert": {...} }
}
```

### Captcha Support

```
GET /diagnostics/health/agent/captcha/status
```
Captcha handling capabilities

```json
{
  "enabled": true,
  "service": "2captcha|anticaptcha",
  "hasApiKey": true,
  "supportedTypes": ["recaptcha_v2", "recaptcha_v3", "hcaptcha", "cloudflare_turnstile"],
  "timeout": 120000,
  "retries": 3
}
```

### Robustness Status

```
GET /diagnostics/health/agent/robustness/status
```
Available error recovery mechanisms

```json
{
  "enhancerStats": { "strategiesAvailable": 6 },
  "recoveryStrategies": [...],
  "capabilities": { "resilientNavigation": true, ... }
}
```

### Prometheus Metrics

```
GET /diagnostics/health/agent/prometheus
```
Prometheus-compatible metrics export

### Operation Logs

```
GET /diagnostics/health/agent/logs?limit=50
```
Recent operation logs

### Alerts

```
GET /diagnostics/health/agent/alerts?limit=20
```
System alerts and anomalies

### Manual Restart

```
POST /diagnostics/health/agent/restart
Headers: X-Health-Token: <HEALTH_TOKEN>
```
Trigger manual browser restart

---

## Features

### 1. Captcha Detection & Handling

The agent automatically detects and handles:

- **reCAPTCHA v2** - Checkbox CAPTCHA
- **reCAPTCHA v3** - Invisible token-based CAPTCHA
- **hCaptcha** - Privacy-focused alternative
- **Cloudflare Turnstile** - Enterprise CAPTCHA
- **Custom challenges** - Generic challenge pages

**Configuration Options:**

- **No Service (Stealth)** - Uses browser masking techniques
- **2Captcha** - Affordable service, good for v2/v3
- **AntiCaptcha** - Reliable, modern API

**Usage in Code:**

```javascript
const { handleCaptcha } = discordHandlers.captchaHandler;

// Auto-detect and solve
const result = await captchaHandler.handleCaptcha(page);
// Returns: { detected: true, type: 'recaptcha_v2', solved: true, method: '2captcha' }
```

### 2. Robustness & Error Recovery

Automatic handling of common errors:

- **Timeouts** → Page reset + retry
- **Network Errors** → Exponential backoff + retry
- **Browser Crashes** → Auto-restart with session recovery
- **Rate Limits** → Smart wait time calculation + retry
- **JS Errors** → Attempt page reload
- **Memory Pressure** → Force garbage collection + restart

**Usage in Code:**

```javascript
const robustness = discordHandlers.robustnessEnhancer;

// Resilient navigation
const result = await robustness.navigateWithResilience(page, url, {
  maxRetries: 3,
  timeout: 30000,
  waitUntil: 'networkidle2'
});

// Resilient evaluation
const data = await robustness.evaluateWithResilience(page, () => {
  return document.title;
}, [], {
  onError: async (err) => ({ shouldRetry: true })
});

// Resilient screenshot
const screenshot = await robustness.screenshotWithResilience(page, {
  fullPage: true,
  timeout: 10000
});

// Error detection
const issues = await robustness.detectAndRecover(page, browser);
```

### 3. Memory Leak Detection

Continuous monitoring with trend analysis:

```javascript
const trend = agentMonitor.getMemoryTrend();
// Returns: { trend: 'increasing', slope: 0.05, riskLevel: 'medium' }
```

### 4. Configurable Retry Policies

Different retry strategies by error type:

```javascript
const strategy = retryPolicy.getRetryStrategy('TIMEOUT');
// TIMEOUT: 4 retries, 2000ms base delay
// NETWORK: 3 retries, 1500ms base delay
// RATE_LIMIT: 5 retries, 3000ms base delay
// INVALID_URL: 0 retries (don't bother)

// Execute with retry
const result = await retryPolicy.executeWithRetry(
  async () => { return await page.goto(url); },
  {
    errorType: 'NETWORK',
    onRetry: ({ attempt, delay, error }) => {
      console.log(`Retry ${attempt}: waiting ${delay}ms`);
    }
  }
);
```

### 5. Auto-Healing System

Proactive health monitoring and recovery:

```javascript
autoHealer.startHealthChecks(browserAgent, agentMonitor, {
  onCriticalMemory: async (agent) => { await agent.restartBrowser(); },
  onCircuitBreakerReset: async (agent) => { /* recovery logic */ },
  onBrowserRestart: async (agent) => { /* restart logic */ },
  onMemoryLeak: async (agent) => { /* alert */ },
  onSessionExpiry: (sessionKey) => { console.log(`Session ${sessionKey} expired`); }
});

// Get current state
const state = autoHealer.getState();
```

### 6. Session Expiry Management

```javascript
// Register session with TTL
agentMonitor.registerSession('ctx_123', 60); // 60 minutes TTL

// Clean up expired sessions
const expired = agentMonitor.cleanupExpiredSessions((key) => {
  console.log(`Session ${key} expired`);
});
```

---

## Deployment Recommendations

### Self-Hosted (Single Server)

```bash
# Basic config
AGENT_SESSIONS_MAXCONCURRENTSESSIONS=5
AGENT_AUTOHEALING_ENABLED=true
CAPTCHA_SERVICE=2captcha
CAPTCHA_API_KEY=your_key
```

### Kubernetes

```bash
# Add to liveness probe
GET /diagnostics/health/agent/status

# Add to readiness probe
GET /diagnostics/health/agent/detailed

# Monitor
GET /diagnostics/health/agent/prometheus
```

### Docker

```dockerfile
FROM node:18
WORKDIR /app
COPY . .
RUN npm install
ENV AGENT_SESSIONS_MAXCONCURRENTSESSIONS=5
ENV AGENT_AUTOHEALING_ENABLED=true
ENV CAPTCHA_SERVICE=2captcha
ENV CAPTCHA_API_KEY=${CAPTCHA_API_KEY}
CMD ["node", "index.js"]
```

---

## Monitoring & Alerting

### Key Metrics to Monitor

1. **jarvis_agent_health** - Overall health (0-100)
2. **jarvis_agent_memory_heap_used_percent** - Heap usage
3. **jarvis_agent_memory_trend_slope** - Memory leak indicator
4. **jarvis_agent_circuit_breaker** - Circuit breaker state (0=closed, 1=open)
5. **jarvis_agent_auto_restarts** - Auto-restart count
6. **jarvis_agent_session_error_rate** - Error rate across sessions

### Alert Thresholds

```
Warning:
- health < 75
- memory_trend_slope > 0.1 (10% growth per window)
- circuit_breaker == 1
- auto_restarts > 2 in 24h

Critical:
- health < 50
- heap_used_percent > 90
- memory_trend_slope > 0.3 (30% growth)
- circuit_breaker == 1 for > 5 minutes
- auto_restarts > 5 in 24h
```

---

## Troubleshooting

### Agent frequently crashes

1. Check memory trend: `/diagnostics/health/agent/memory/trend`
2. Increase heap limits or reduce `maxConcurrentSessions`
3. Enable `AGENT_AUTOHEALING_ENABLED=true`

### Captchas not being solved

1. Verify service: `/diagnostics/health/agent/captcha/status`
2. Check API key is set: `echo $CAPTCHA_API_KEY`
3. Try stealth mode: `CAPTCHA_SERVICE=none`

### High error rate

1. Check retry strategies: `/diagnostics/health/agent/retry/strategies`
2. Review operation logs: `/diagnostics/health/agent/logs`
3. Check alerts: `/diagnostics/health/agent/alerts`

### Circuit breaker stuck open

1. Check health: `/diagnostics/health/agent/detailed`
2. Manual restart: `POST /diagnostics/health/agent/restart`
3. Review healing status: `/diagnostics/health/agent/healing/status`

---

## API Reference Summary

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/diagnostics/health/agent/status` | GET | Quick health check |
| `/diagnostics/health/agent/detailed` | GET | Full metrics |
| `/diagnostics/health/agent/diagnostics` | GET | Debug report |
| `/diagnostics/health/agent/memory/trend` | GET | Leak detection |
| `/diagnostics/health/agent/retry/strategies` | GET | Retry config |
| `/diagnostics/health/agent/healing/status` | GET | Auto-healing state |
| `/diagnostics/health/agent/captcha/status` | GET | Captcha config |
| `/diagnostics/health/agent/robustness/status` | GET | Recovery capabilities |
| `/diagnostics/health/agent/prometheus` | GET | Prometheus export |
| `/diagnostics/health/agent/logs` | GET | Operation logs |
| `/diagnostics/health/agent/alerts` | GET | System alerts |
| `/diagnostics/health/agent/restart` | POST | Manual restart |

---

## Support & Contributing

For issues or improvements, please file an issue in the repository with:
1. Full diagnostic output from `/diagnostics/health/agent/diagnostics`
2. Recent operation logs from `/diagnostics/health/agent/logs?limit=100`
3. Steps to reproduce
