const express = require('express');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const cookieParser = require('cookie-parser');

const router = express.Router();
const auth = require('../services/moderator-auth');
const config = require('../../config');
const database = require('../services/database');
const aiManager = require('../services/ai-providers');
const { gatherHealthSnapshot } = require('../services/diagnostics');
const moderation = require('../services/GUILDS_FEATURES/moderation');
const moderationFilters = require('../services/moderation-filters');
const subscriptions = require('../services/monitor-subscriptions');
const dataSync = require('../services/data-sync');
const ytDlpManager = require('../services/yt-dlp-manager');
const starkEconomy = require('../services/stark-economy');
const selfhostFeatures = require('../services/selfhost-features');
const { musicManager } = require('../core/musicManager');
const musicGuildWhitelist = require('../utils/musicGuildWhitelist');
const commandRegistry = require('../core/command-registry');
const errorLogger = require('../services/error-logger');

router.use(cookieParser());
router.use(express.json({ limit: '1mb' }));

const jarvisAuditLog = [];
const jarvisRateBuckets = new Map();
const jarvisSnapshotBuckets = new Map();

let jarvisSnapshotIndexesReady = false;

function getSnapshotCollection() {
    if (!database?.isConnected || !database?.db) {
        return null;
    }
    if (typeof database.getCollection === 'function') {
        return database.getCollection('jarvis_owner_snapshots');
    }
    if (typeof database.db.collection === 'function') {
        return database.db.collection('jarvis_owner_snapshots');
    }
    return null;
}

async function ensureSnapshotIndexes(collection) {
    if (jarvisSnapshotIndexesReady) return;
    jarvisSnapshotIndexesReady = true;
    await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => null);
    await collection.createIndex({ updatedAt: -1 }).catch(() => null);
}

async function saveJarvisSnapshot(key, payload, opts = {}) {
    const safeKey = String(key || '').trim();
    if (!safeKey) return false;

    const maxBytes = Math.max(1024, Number(opts.maxBytes || 512 * 1024));
    const ttlMs = Math.max(60 * 1000, Number(opts.ttlMs || 6 * 60 * 60 * 1000));
    const minWriteMs = Math.max(250, Number(opts.minWriteMs || 5000));

    let json = '';
    try {
        json = JSON.stringify(payload);
    } catch {
        return false;
    }
    if (Buffer.byteLength(json, 'utf8') > maxBytes) {
        return false;
    }

    const collection = getSnapshotCollection();
    if (!collection) return false;
    await ensureSnapshotIndexes(collection);

    const now = Date.now();
    const hash = crypto.createHash('sha256').update(json).digest('hex');

    const bucket = jarvisSnapshotBuckets.get(safeKey);
    if (bucket && now - bucket.lastWriteAt < minWriteMs && bucket.lastHash === hash) {
        return false;
    }

    jarvisSnapshotBuckets.set(safeKey, { lastWriteAt: now, lastHash: hash });

    const doc = {
        _id: safeKey,
        key: safeKey,
        payload,
        payloadHash: hash,
        sizeBytes: Buffer.byteLength(json, 'utf8'),
        updatedAt: new Date(now),
        expiresAt: new Date(now + ttlMs)
    };

    await collection.replaceOne({ _id: safeKey }, doc, { upsert: true });
    return true;
}

function getClientIp(req) {
    const xf = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    return xf || req.ip || req.connection?.remoteAddress || 'unknown';
}

function recordAuditEvent(req, action, data) {
    const entry = {
        ts: Date.now(),
        userId: req.session?.userId || null,
        ip: getClientIp(req),
        action: String(action || ''),
        data: data || null
    };
    jarvisAuditLog.push(entry);
    if (jarvisAuditLog.length > 500) jarvisAuditLog.splice(0, jarvisAuditLog.length - 500);
    return entry;
}

function rateLimit({ keyPrefix, max, windowMs }) {
    return (req, res, next) => {
        const ip = getClientIp(req);
        const key = `${String(keyPrefix || 'rl')}:${ip}`;
        const now = Date.now();
        const bucket = jarvisRateBuckets.get(key);
        if (!bucket || now >= bucket.resetAt) {
            jarvisRateBuckets.set(key, { count: 1, resetAt: now + Number(windowMs || 60000) });
            return next();
        }
        bucket.count += 1;
        if (bucket.count > Number(max || 60)) {
            return res.status(429).json({ ok: false, error: 'rate_limited' });
        }
        return next();
    };
}

function requireCsrf(req, res, next) {
    const expected = req.session?.csrfToken ? String(req.session.csrfToken) : '';
    const provided = String(req.headers?.['x-csrf-token'] || req.body?.csrfToken || req.body?._csrf || '');
    if (!expected || !provided || provided !== expected) {
        return res.status(403).json({ ok: false, error: 'bad_csrf' });
    }
    return next();
}

function shouldUseSecureCookies(req) {
    if (req?.secure) return true;
    if (String(req?.headers?.['x-forwarded-proto'] || '').toLowerCase() === 'https') return true;
    if (process.env.DASHBOARD_DOMAIN && process.env.DASHBOARD_DOMAIN.startsWith('https://')) return true;
    return false;
}

function getCookieOptions(req, overrides = {}) {
    return {
        httpOnly: true,
        sameSite: 'lax',
        secure: shouldUseSecureCookies(req),
        path: '/',
        ...overrides
    };
}

function getOwnerId() {
    return String(config?.admin?.userId || '').trim();
}

function getDiscordClient() {
    return global.discordClient || null;
}

function getDiscordHandlers() {
    return global.discordHandlers || null;
}

function getDiscordAvatarUrl(discordUser) {
    if (!discordUser || !discordUser.id) return '';
    if (discordUser.avatar) {
        const ext = String(discordUser.avatar).startsWith('a_') ? 'gif' : 'png';
        return `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.${ext}?size=64`;
    }
    return 'https://cdn.discordapp.com/embed/avatars/0.png';
}

async function resolveDiscordUserData(userId) {
    const client = getDiscordClient();
    if (!client?.users?.fetch) return { id: String(userId) };

    const user = await client.users.fetch(String(userId)).catch(() => null);
    if (!user) return { id: String(userId) };

    return {
        id: user.id,
        username: user.username,
        global_name: user.globalName || null,
        avatar: user.avatar || null
    };
}

async function requireOwner(req, res, next) {
    const token = req.cookies?.jarvis_owner_session;
    if (!token) {
        const accept = String(req.headers?.accept || '');
        if (accept.includes('application/json')) {
            return res.status(401).json({ ok: false, error: 'not_authenticated' });
        }
        return res.redirect('/jarvis?error=not_authenticated');
    }

    const session = auth.validateSession(token);
    if (!session) {
        res.clearCookie('jarvis_owner_session', { path: '/' });
        const accept = String(req.headers?.accept || '');
        if (accept.includes('application/json')) {
            return res.status(401).json({ ok: false, error: 'session_expired' });
        }
        return res.redirect('/jarvis?error=session_expired');
    }

    const ownerId = getOwnerId();
    if (!ownerId || String(session.userId) !== ownerId) {
        res.clearCookie('jarvis_owner_session', { path: '/' });
        auth.destroySession(token);
        const accept = String(req.headers?.accept || '');
        if (accept.includes('application/json')) {
            return res.status(403).json({ ok: false, error: 'unauthorized' });
        }
        return res.redirect('/jarvis?error=unauthorized');
    }

    if (!session.csrfToken) {
        session.csrfToken = crypto.randomBytes(24).toString('hex');
    }

    req.session = session;

    try {
        const d = req.session.discordData;
        const hasIdentity = Boolean(d && d.id);
        const hasName = Boolean(d && (d.global_name || d.username));
        const hasAvatar = Boolean(d && (d.avatar || d.avatar_url));

        if (!hasIdentity || !hasName || !hasAvatar) {
            const resolved = await resolveDiscordUserData(req.session.userId);
            if (resolved && resolved.id) {
                req.session.discordData = {
                    ...(req.session.discordData || {}),
                    ...resolved
                };
            }
        }
    } catch {
    }

    next();
}

function getLoginPage({ oauthUrl, errorMsg }) {
    const safeError = errorMsg ? String(errorMsg).replace(/[<>]/g, '') : '';
    const buttonDisabled = oauthUrl ? '' : 'disabled';
    const buttonText = oauthUrl ? 'Login with Discord' : 'Discord OAuth not configured';

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Jarvis Owner Console</title>
  <style>
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Arial; background: #0b0f17; color: #e6edf3; display: flex; min-height: 100vh; align-items: center; justify-content: center; }
    .card { width: min(520px, 92vw); background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 20px; box-shadow: 0 12px 40px rgba(0,0,0,0.35); }
    h1 { margin: 0 0 6px; font-size: 20px; }
    p { margin: 0 0 14px; opacity: 0.9; font-size: 13px; }
    a.btn { display: inline-flex; align-items: center; justify-content: center; width: 100%; box-sizing: border-box; padding: 12px; border-radius: 10px; border: 0; cursor: pointer; background: #5865f2; color: white; font-weight: 700; text-decoration: none; }
    a.btn[aria-disabled="true"] { opacity: 0.6; pointer-events: none; }
    .error { margin-top: 10px; color: #ff7b72; min-height: 18px; font-size: 13px; }
    .hint { margin-top: 12px; opacity: 0.65; font-size: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Jarvis Owner Console</h1>
    <p>Owner-only access. Authenticate via Discord.</p>
    <a class="btn" href="${oauthUrl || '#'}" aria-disabled="${oauthUrl ? 'false' : 'true'}">${buttonText}</a>
    <div class="error">${safeError}</div>
    <div class="hint">If Discord rejects the login, ensure <code>/jarvis/callback</code> is added as an OAuth2 redirect URL in the Discord Developer Portal.</div>
  </div>
</body>
</html>`;
}

function getPanelPage(session) {
    const discordUser = session?.discordData || { id: session?.userId };
    const name =
        discordUser?.global_name ||
        discordUser?.username ||
        (discordUser?.id ? `User ${discordUser.id}` : 'Owner');
    const avatar = getDiscordAvatarUrl(discordUser);

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Jarvis Owner Console</title>
  <style>
    :root { --bg:#0b0f17; --panel:rgba(255,255,255,0.04); --panel2:rgba(255,255,255,0.06); --border:rgba(255,255,255,0.10); --text:#e6edf3; --muted:rgba(230,237,243,0.72); --good:#2ecc71; --warn:#f1c40f; --bad:#e74c3c; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Arial; background:var(--bg); color:var(--text); }
    header { position:sticky; top:0; z-index:5; backdrop-filter: blur(10px); background: rgba(11,15,23,0.75); border-bottom: 1px solid var(--border); }
    .wrap { max-width: 1400px; margin:0 auto; padding: 14px 16px; }
    .top { display:flex; align-items:center; justify-content:space-between; gap:12px; }
    .me { display:flex; align-items:center; gap:10px; min-width: 260px; }
    .me img { width:32px; height:32px; border-radius:999px; border:1px solid rgba(255,255,255,0.2); }
    .me .name { font-weight: 850; }
    .me .sub { font-size: 12px; color: var(--muted); }
    .actions { display:flex; gap:8px; align-items:center; }
    .btn { border:1px solid var(--border); background: var(--panel2); color: var(--text); border-radius: 10px; padding: 8px 12px; cursor:pointer; font-weight: 700; }
    .layout { display:grid; grid-template-columns: 260px 1fr; gap: 14px; align-items: start; }
    .sidebar { position: sticky; top: 72px; align-self: start; background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 12px; }
    .navTitle { margin: 0 0 8px; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
    .nav { display:flex; flex-direction:column; gap:6px; }
    .nav a { text-decoration:none; padding: 9px 10px; border-radius: 10px; border:1px solid transparent; color: rgba(230,237,243,0.92); font-weight: 700; font-size: 13px; display:flex; align-items:center; justify-content:space-between; }
    .nav a:hover { background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.10); }
    .nav a.active { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.18); }
    .badge { font-size: 11px; padding: 1px 8px; border-radius: 999px; background: rgba(255,255,255,0.06); border: 1px solid var(--border); color: var(--muted); }
    .main { min-width: 0; background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 14px; }
    h2 { margin: 0 0 6px; font-size: 16px; }
    .muted { color: var(--muted); font-size: 12px; }
    pre { margin: 12px 0 0; white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.45; opacity: 0.95; }
    .toolbar { display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:flex-start; }
    .toolbarRight { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
    .controls { display:flex; gap:10px; flex-wrap: wrap; margin-top: 10px; }
    select, input { padding: 8px 10px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.25); color: var(--text); }
    .toggle { font-size:12px; color: var(--muted); display:flex; gap:6px; align-items:center; user-select:none; }
    .banner { display:none; margin-top: 10px; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--border); background: rgba(255,255,255,0.06); font-size: 12px; }
    .banner.good { border-color: rgba(46,204,113,0.45); background: rgba(46,204,113,0.12); }
    .banner.bad { border-color: rgba(231,76,60,0.45); background: rgba(231,76,60,0.12); }
    .kpis { display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin-top: 10px; }
    .kpi { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 12px; }
    .kpi .label { font-size: 12px; color: var(--muted); }
    .kpi .value { font-size: 20px; font-weight: 900; margin-top: 4px; }
    .kpi .sub { font-size: 12px; color: var(--muted); margin-top: 4px; }
    .pill { display:inline-flex; gap:8px; align-items:center; font-size: 12px; padding: 2px 10px; border-radius: 999px; border: 1px solid var(--border); background: rgba(255,255,255,0.06); }
    .dot { width: 8px; height: 8px; border-radius: 999px; background: var(--muted); }
    .dot.good { background: var(--good); }
    .dot.warn { background: var(--warn); }
    .dot.bad { background: var(--bad); }
    .row { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
    table { width:100%; border-collapse: collapse; margin-top: 10px; }
    th, td { text-align:left; padding: 10px 10px; border-bottom: 1px solid rgba(255,255,255,0.08); vertical-align: top; font-size: 12px; }
    th { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; }
    th button { cursor:pointer; border:0; background:transparent; color: inherit; font: inherit; padding:0; text-transform: inherit; letter-spacing: inherit; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
    @media (max-width: 980px) { .layout { grid-template-columns: 1fr; } .sidebar { position: static; } }
  </style>
</head>
<body>
  <header>
    <div class="wrap">
      <div class="top">
        <div class="me">
          <img src="${avatar}" alt="avatar" />
          <div>
            <div class="name">${String(name).replace(/[<>]/g, '')}</div>
            <div class="sub">Owner console</div>
          </div>
        </div>
        <div class="actions">
          <button class="btn" id="refresh" type="button">Refresh</button>
          <form method="post" action="/jarvis/logout">
            <button class="btn" type="submit">Logout</button>
          </form>
        </div>
      </div>
    </div>
  </header>

  <main class="wrap">
    <div class="layout">
      <aside class="sidebar">
        <div class="navTitle">Console</div>
        <nav class="nav" id="nav">
          <a href="#overview" data-route="overview">Overview <span class="badge" id="b-overview">—</span></a>
          <a href="#providers" data-route="providers">AI Providers <span class="badge" id="b-providers">—</span></a>
          <a href="#agent" data-route="agent">Agent <span class="badge" id="b-agent">—</span></a>
          <a href="#moderation" data-route="moderation">Moderation</a>
          <a href="#filters" data-route="filters">Filters</a>
          <a href="#monitoring" data-route="monitoring">Monitoring</a>
          <a href="#music" data-route="music">Music</a>
          <a href="#economy" data-route="economy">Economy</a>
          <a href="#soul" data-route="soul">Soul</a>
          <a href="#sync" data-route="sync">Data Sync</a>
          <a href="#ytdlp" data-route="ytdlp">yt-dlp</a>
          <a href="#logs" data-route="logs">Logs</a>
          <a href="#commands" data-route="commands">Commands</a>
          <a href="#audit" data-route="audit">Audit</a>
          <a href="#config" data-route="config">Config</a>
        </nav>
      </aside>

      <section class="main">
        <div class="toolbar">
          <div>
            <h2 id="title">Loading…</h2>
            <div id="subtitle" class="muted">Fetching data from the running bot process.</div>
          </div>
          <div class="toolbarRight">
            <span class="muted" id="lastUpdated">—</span>
            <select id="refreshEvery">
              <option value="0">Auto: Off</option>
              <option value="5000">Auto: 5s</option>
              <option value="15000">Auto: 15s</option>
              <option value="60000">Auto: 60s</option>
            </select>
            <label class="toggle"><input id="rawToggle" type="checkbox" /> Raw JSON</label>
          </div>
        </div>
        <div id="banner" class="banner"></div>
        <div id="controls" class="controls"></div>
        <div id="view"></div>
        <pre id="output" style="display:none"></pre>
      </section>
    </div>
  </main>

  <script>
    (function () {
      var nav = document.getElementById('nav');
      var refreshBtn = document.getElementById('refresh');
      var titleEl = document.getElementById('title');
      var subtitleEl = document.getElementById('subtitle');
      var controlsEl = document.getElementById('controls');
      var viewEl = document.getElementById('view');
      var outputEl = document.getElementById('output');
      var bannerEl = document.getElementById('banner');
      var lastUpdatedEl = document.getElementById('lastUpdated');
      var refreshEveryEl = document.getElementById('refreshEvery');
      var rawToggleEl = document.getElementById('rawToggle');

      var state = {
        csrfToken: null,
        autoRefreshMs: 0,
        autoTimer: null,
        raw: false,
        moderationPage: 1,
        filtersPage: 1,
        log: {
          file: '',
          paused: false,
          es: null,
          buffer: ''
        }
      };

      var CACHE_PREFIX = 'jarvis.owner.snapshot.';
      var OFFLINE_BANNER = 'Offline. Showing cached data.';

      function smartCleanCache() {
        try {
          if (typeof localStorage === 'undefined') return;
          var now = Date.now();
          var maxAge = 14 * 24 * 60 * 60 * 1000;
          var keys = [];
          for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (k && k.indexOf(CACHE_PREFIX) === 0) keys.push(k);
          }
          var keep = [];
          for (var j = 0; j < keys.length; j++) {
            var raw = localStorage.getItem(keys[j]);
            var obj = null;
            try { obj = raw ? JSON.parse(raw) : null; } catch { obj = null; }
            var ts = obj && typeof obj.ts === 'number' ? obj.ts : 0;
            if (!obj || !obj.data || !ts || now - ts > maxAge) {
              localStorage.removeItem(keys[j]);
            } else {
              keep.push({ k: keys[j], ts: ts });
            }
          }
          if (keep.length > 80) {
            keep.sort(function (a, b) { return a.ts - b.ts; });
            for (var x = 0; x < keep.length - 80; x++) localStorage.removeItem(keep[x].k);
          }
        } catch {
        }
      }

      function readCache(key) {
        try {
          if (typeof localStorage === 'undefined') return null;
          var safeKey = String(key || '').trim();
          if (!safeKey) return null;
          var raw = localStorage.getItem(CACHE_PREFIX + safeKey);
          if (!raw) return null;
          var obj = JSON.parse(raw);
          if (!obj || !obj.data) return null;
          return { ts: obj.ts || null, data: obj.data };
        } catch {
          return null;
        }
      }

      function writeCache(key, data) {
        try {
          if (typeof localStorage === 'undefined') return;
          var safeKey2 = String(key || '').trim();
          if (!safeKey2) return;
          localStorage.setItem(CACHE_PREFIX + safeKey2, JSON.stringify({ ts: Date.now(), data: data }));
          smartCleanCache();
        } catch {
        }
      }

      function setBadge(id, value) {
        var el = document.getElementById(id);
        if (el) el.textContent = String(value);
      }

      function setActive(route) {
        var links = nav.querySelectorAll('a[data-route]');
        for (var i = 0; i < links.length; i++) {
          links[i].classList.toggle('active', links[i].getAttribute('data-route') === route);
        }
      }

      function clear(el) {
        while (el.firstChild) el.removeChild(el.firstChild);
      }

      function clearControls() {
        clear(controlsEl);
      }

      function clearView() {
        clear(viewEl);
      }

      function setBanner(tone, text) {
        if (!text) {
          bannerEl.style.display = 'none';
          bannerEl.textContent = '';
          bannerEl.className = 'banner';
          return;
        }
        bannerEl.style.display = 'block';
        bannerEl.textContent = String(text);
        bannerEl.className = 'banner ' + String(tone || '');
      }

      function showRaw(obj) {
        if (state.raw) {
          outputEl.style.display = 'block';
          outputEl.textContent = JSON.stringify(obj, null, 2);
        } else {
          outputEl.style.display = 'none';
          outputEl.textContent = '';
        }
      }

      function updateLastUpdated(prefix, ts) {
        var d = ts ? new Date(ts) : new Date();
        lastUpdatedEl.textContent = String(prefix || 'Updated ') + d.toLocaleTimeString();
      }

      function lastUpdatedPrefix(meta) {
        if (!meta || !meta.source) return 'Updated ';
        if (meta.source === 'local') return 'Cached ';
        if (meta.source === 'server') return 'Snapshot ';
        return 'Updated ';
      }

      function updateConnectionBanner() {
        try {
          if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            if (!bannerEl.textContent) setBanner('warn', OFFLINE_BANNER);
          } else {
            if (bannerEl.textContent === OFFLINE_BANNER) setBanner('', '');
          }
        } catch {
        }
      }

      function pill(label, tone) {
        var span = document.createElement('span');
        span.className = 'pill';
        var dot = document.createElement('span');
        dot.className = 'dot' + (tone ? ' ' + tone : '');
        var txt = document.createElement('span');
        txt.textContent = String(label);
        span.appendChild(dot);
        span.appendChild(txt);
        return span;
      }

      function renderKpis(items) {
        var grid = document.createElement('div');
        grid.className = 'kpis';
        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          var card = document.createElement('div');
          card.className = 'kpi';
          var lab = document.createElement('div');
          lab.className = 'label';
          lab.textContent = String(it.label);
          var val = document.createElement('div');
          val.className = 'value';
          val.textContent = String(it.value);
          var sub = document.createElement('div');
          sub.className = 'sub';
          sub.textContent = String(it.sub || '');
          card.appendChild(lab);
          card.appendChild(val);
          card.appendChild(sub);
          grid.appendChild(card);
        }
        viewEl.appendChild(grid);
      }

      function asText(v) {
        if (v == null) return '';
        if (typeof v === 'string') return v;
        if (typeof v === 'number' || typeof v === 'boolean') return String(v);
        try {
          return JSON.stringify(v);
        } catch {
          return String(v);
        }
      }

      function renderTable(rows, columns, options) {
        options = options || {};
        var pageSize = Math.min(Math.max(Number(options.pageSize || 25), 5), 200);
        var tableState = options.state || { q: '', sortKey: null, sortDir: 1, page: 1 };

        var top = document.createElement('div');
        top.className = 'row';
        top.style.marginTop = '10px';

        var search = document.createElement('input');
        search.type = 'search';
        search.placeholder = 'Search…';
        search.value = tableState.q || '';
        search.oninput = function () {
          tableState.q = search.value;
          tableState.page = 1;
          paint();
        };

        var prev = document.createElement('button');
        prev.className = 'btn';
        prev.textContent = 'Prev';
        prev.onclick = function () {
          tableState.page = Math.max(1, tableState.page - 1);
          paint();
        };

        var next = document.createElement('button');
        next.className = 'btn';
        next.textContent = 'Next';
        next.onclick = function () {
          tableState.page = tableState.page + 1;
          paint();
        };

        var pageInfo = document.createElement('span');
        pageInfo.className = 'muted';
        pageInfo.textContent = '';

        top.appendChild(search);
        top.appendChild(prev);
        top.appendChild(next);
        top.appendChild(pageInfo);
        viewEl.appendChild(top);

        var table = document.createElement('table');
        var thead = document.createElement('thead');
        var thr = document.createElement('tr');
        for (var c = 0; c < columns.length; c++) {
          (function () {
            var col = columns[c];
            var th = document.createElement('th');
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = String(col.label);
            btn.onclick = function () {
              if (!col.key) return;
              if (tableState.sortKey === col.key) {
                tableState.sortDir = tableState.sortDir * -1;
              } else {
                tableState.sortKey = col.key;
                tableState.sortDir = 1;
              }
              paint();
            };
            th.appendChild(btn);
            thr.appendChild(th);
          })();
        }
        thead.appendChild(thr);
        table.appendChild(thead);
        var tbody = document.createElement('tbody');
        table.appendChild(tbody);
        viewEl.appendChild(table);

        function filteredSorted() {
          var q = String(tableState.q || '').toLowerCase().trim();
          var out = rows.slice();
          if (q) {
            out = out.filter(function (r) {
              for (var i = 0; i < columns.length; i++) {
                var k = columns[i].key;
                if (!k) continue;
                var t = asText(r[k]).toLowerCase();
                if (t.indexOf(q) !== -1) return true;
              }
              return false;
            });
          }
          if (tableState.sortKey) {
            var sk = tableState.sortKey;
            var dir = tableState.sortDir;
            out.sort(function (a, b) {
              var av = asText(a[sk]);
              var bv = asText(b[sk]);
              if (av === bv) return 0;
              return av > bv ? dir : -dir;
            });
          }
          return out;
        }

        function paint() {
          clear(tbody);
          var data = filteredSorted();
          var total = data.length;
          var pages = Math.max(1, Math.ceil(total / pageSize));
          if (tableState.page > pages) tableState.page = pages;
          var start = (tableState.page - 1) * pageSize;
          var slice = data.slice(start, start + pageSize);

          pageInfo.textContent = 'Page ' + tableState.page + ' / ' + pages + ' • Rows ' + total;
          prev.disabled = tableState.page <= 1;
          next.disabled = tableState.page >= pages;

          if (!slice.length) {
            var tr0 = document.createElement('tr');
            var td0 = document.createElement('td');
            td0.colSpan = columns.length;
            td0.className = 'muted';
            td0.textContent = 'No rows';
            tr0.appendChild(td0);
            tbody.appendChild(tr0);
            return;
          }

          for (var r = 0; r < slice.length; r++) {
            var tr = document.createElement('tr');
            for (var cc = 0; cc < columns.length; cc++) {
              var col2 = columns[cc];
              var td = document.createElement('td');
              if (typeof col2.render === 'function') {
                var node = col2.render(slice[r]);
                if (node) td.appendChild(node);
              } else if (col2.key) {
                td.textContent = asText(slice[r][col2.key]);
              } else {
                td.textContent = '';
              }
              tr.appendChild(td);
            }
            tbody.appendChild(tr);
          }
        }

        paint();
        return tableState;
      }

      function api(url, options) {
        options = options || {};
        options.headers = options.headers || {};
        options.headers['Accept'] = 'application/json';
        var method = String(options.method || 'GET').toUpperCase();
        if (method !== 'GET' && state.csrfToken) {
          options.headers['X-CSRF-Token'] = String(state.csrfToken);
        }

        var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        if (controller) {
          options.signal = controller.signal;
          setTimeout(function () {
            try {
              controller.abort();
            } catch {
            }
          }, 15000);
        }

        return fetch(url, options).then(function (res) {
          if (res.status === 401) {
            location.href = '/jarvis?error=not_authenticated';
            throw new Error('not_authenticated');
          }
          if (res.status === 403) {
            location.href = '/jarvis?error=unauthorized';
            throw new Error('unauthorized');
          }
          if (!res.ok) {
            return res.text().then(function (t) {
              throw new Error('HTTP ' + res.status + (t ? ' - ' + t.slice(0, 200) : ''));
            });
          }
          return res.json();
        });
      }

      function loadSection(cacheKey, url, paint) {
        var key = String(cacheKey || '').trim();
        var cached = key ? readCache(key) : null;
        var usedCached = Boolean(cached && cached.data);

        if (usedCached) {
          try {
            paint(cached.data, { source: 'local', ts: cached.ts || null });
          } catch {
          }
        } else {
          viewEl.appendChild(pill('Loading…', 'warn'));
        }

        return api(url)
          .then(function (data) {
            setBanner('', '');
            if (key) writeCache(key, data);
            paint(data, { source: 'live', ts: Date.now() });
            updateConnectionBanner();
            return data;
          })
          .catch(function (e) {
            if (usedCached) {
              var msg = (typeof navigator !== 'undefined' && navigator.onLine === false)
                ? OFFLINE_BANNER
                : ('Showing cached data • ' + String(e.message || 'failed'));
              setBanner('warn', msg);
              updateConnectionBanner();
              return cached.data;
            }

            if (!key) throw e;

            return api('/jarvis/api/cache/' + encodeURIComponent(key))
              .then(function (snap) {
                if (snap && snap.payload) {
                  writeCache(key, snap.payload);
                  paint(snap.payload, { source: 'server', ts: snap.updatedAt || null });
                  setBanner('warn', 'Showing cached snapshot');
                  updateConnectionBanner();
                  return snap.payload;
                }
                throw e;
              });
          });
      }

      function stopLogStream() {
        try {
          if (state.log.es) {
            state.log.es.close();
          }
        } catch {
        }
        state.log.es = null;
      }

      function renderOverview() {
        titleEl.textContent = 'Overview';
        subtitleEl.textContent = 'High-level snapshot across core subsystems.';
        setActive('overview');
        setBanner('', '');
        clearControls();
        clearView();

        function paint(data, meta) {
          clearView();
          showRaw(data);
          updateLastUpdated(lastUpdatedPrefix(meta), meta && meta.ts ? meta.ts : null);
          var o = data && data.overview ? data.overview : null;
          if (!o) {
            setBanner('bad', 'Malformed overview payload');
            return;
          }

          setBadge('b-overview', 'OK');
          setBadge('b-providers', String(o.providers.active) + '/' + String(o.providers.total));
          setBadge('b-agent', o.agent && o.agent.ok ? String(o.agent.health) : '—');

          renderKpis([
            { label: 'Discord', value: o.discord && o.discord.ready ? 'Ready' : 'Not ready', sub: 'Guilds: ' + o.discord.guilds + ' • Users: ' + o.discord.users },
            { label: 'AI Providers', value: String(o.providers.active) + '/' + String(o.providers.total), sub: 'Mode: ' + o.providers.selectionMode + ' • Type: ' + o.providers.providerType },
            { label: 'Agent', value: o.agent && o.agent.ok ? String(o.agent.health) : 'Unavailable', sub: 'Circuit: ' + (o.agent.circuit || '—') + ' • Sessions: ' + String(o.agent.activeSessions || 0) },
            { label: 'Monitoring', value: String(o.monitoring.subscriptions || 0), sub: 'Subscriptions' },
            { label: 'Music', value: String(o.music.activeQueues || 0), sub: 'Active queues' },
            { label: 'Economy', value: o.economy && o.economy.multiplierActive ? 'Boost' : '—', sub: 'Multiplier' },
            { label: 'Logs', value: String(o.logs.files || 0), sub: 'Files' },
            { label: 'Errors', value: o.errorLogger && o.errorLogger.pendingQueue != null ? String(o.errorLogger.pendingQueue) : '—', sub: 'Pending error queue' }
          ]);
        }

        return loadSection('overview', '/jarvis/api/overview', paint).catch(function (e) {
          clearView();
          showRaw({ ok: false, error: e.message });
          setBanner('bad', e.message);
        });
      }

      function renderProviders() {
        titleEl.textContent = 'AI Providers';
        subtitleEl.textContent = 'Provider pool status + safe controls.';
        setActive('providers');
        setBanner('', '');
        clearControls();
        clearView();

        function paint(data, meta) {
          clearView();
          showRaw(data);
          updateLastUpdated(lastUpdatedPrefix(meta), meta && meta.ts ? meta.ts : null);

          renderKpis([
            { label: 'Active', value: String(data.active) + '/' + String(data.count), sub: 'Providers' },
            { label: 'Mode', value: String(data.selectionMode || 'unknown'), sub: 'Selection mode' },
            { label: 'Type', value: String(data.providerType || 'unknown'), sub: 'Provider type' },
            { label: 'Health', value: data.health && data.health.overall ? String(data.health.overall) : '—', sub: 'Health summary' }
          ]);

          var btnRandom = document.createElement('button');
          btnRandom.className = 'btn';
          btnRandom.textContent = 'Mode: Random';
          btnRandom.onclick = function () {
            api('/jarvis/api/providers/selection-mode', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ mode: 'random' })
            }).then(function () { renderProviders(); }).catch(function (e) { setBanner('bad', e.message); });
          };

          var btnRanked = document.createElement('button');
          btnRanked.className = 'btn';
          btnRanked.textContent = 'Mode: Ranked';
          btnRanked.onclick = function () {
            api('/jarvis/api/providers/selection-mode', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ mode: 'ranked' })
            }).then(function () { renderProviders(); }).catch(function (e) { setBanner('bad', e.message); });
          };

          var sel = document.createElement('select');
          var types = data && data.availableProviderTypes ? data.availableProviderTypes : [];
          for (var i = 0; i < types.length; i++) {
            var opt = document.createElement('option');
            opt.value = String(types[i]);
            opt.textContent = String(types[i]);
            if (String(types[i]) === String(data.providerType)) opt.selected = true;
            sel.appendChild(opt);
          }

          var btnApply = document.createElement('button');
          btnApply.className = 'btn';
          btnApply.textContent = 'Apply type';
          btnApply.onclick = function () {
            api('/jarvis/api/providers/type', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: sel.value })
            }).then(function () { renderProviders(); }).catch(function (e) { setBanner('bad', e.message); });
          };

          controlsEl.appendChild(btnRandom);
          controlsEl.appendChild(btnRanked);
          controlsEl.appendChild(sel);
          controlsEl.appendChild(btnApply);

          var providers = Array.isArray(data.providers) ? data.providers : [];
          renderTable(
            providers,
            [
              {
                label: 'Status',
                key: 'status',
                render: function (row) {
                  var tone = row.isDisabled ? 'warn' : row.hasError ? 'bad' : 'good';
                  var label = row.isDisabled ? 'Disabled' : row.hasError ? 'Error' : 'OK';
                  return pill(label, tone);
                }
              },
              { label: 'Name', key: 'name' },
              { label: 'Family', key: 'family' },
              { label: 'Tier', key: 'costTier' },
              {
                label: 'Model',
                key: 'model',
                render: function (row) {
                  var code = document.createElement('code');
                  code.textContent = row.model || '';
                  return code;
                }
              },
              {
                label: 'Success',
                key: 'successRate',
                render: function (row) {
                  var v = row.metrics && row.metrics.successRate != null ? (row.metrics.successRate * 100).toFixed(1) + '%' : '—';
                  var span = document.createElement('span');
                  span.textContent = v;
                  return span;
                }
              },
              {
                label: 'Latency',
                key: 'avgLatencyMs',
                render: function (row) {
                  var v2 = row.metrics && row.metrics.avgLatencyMs != null ? String(Math.round(row.metrics.avgLatencyMs)) + 'ms' : '—';
                  var span2 = document.createElement('span');
                  span2.textContent = v2;
                  return span2;
                }
              }
            ],
            { pageSize: 25 }
          );
        }

        return loadSection('providers', '/jarvis/api/providers', paint).catch(function (e) {
          clearView();
          showRaw({ ok: false, error: e.message });
          setBanner('bad', e.message);
        });
      }

      function renderAgent() {
        titleEl.textContent = 'Agent';
        subtitleEl.textContent = 'Browser agent health + recent alerts.';
        setActive('agent');
        setBanner('', '');
        clearControls();
        clearView();

        function paint(data, meta) {
          clearView();
          showRaw(data);
          updateLastUpdated(lastUpdatedPrefix(meta), meta && meta.ts ? meta.ts : null);

          if (!data || !data.ok) {
            setBanner('bad', 'Agent not initialized');
            return;
          }
          var h = data.health || {};
          var m = data.metrics || {};
          var tone = h.overallHealth >= 75 ? 'good' : h.overallHealth >= 50 ? 'warn' : 'bad';
          renderKpis([
            { label: 'Health', value: String(h.overallHealth), sub: 'Overall health score' },
            { label: 'Circuit', value: String(m.circuitBreakerStatus || '—'), sub: 'Breaker status' },
            { label: 'Sessions', value: String(m.activeSessions || 0), sub: 'Active sessions' },
            { label: 'Uptime', value: String(Math.round((h.uptime || 0) / 1000)) + 's', sub: 'Agent uptime' }
          ]);

          var pre = document.createElement('pre');
          pre.textContent = JSON.stringify({ recentAlerts: h.recentAlerts || [], memory: h.memory || {} }, null, 2);
          viewEl.appendChild(pre);
        }

        return loadSection('agent.health', '/jarvis/api/agent/health', paint).catch(function (e) {
          clearView();
          showRaw({ ok: false, error: e.message });
          setBanner('bad', e.message);
        });
      }

      function renderModeration() {
        titleEl.textContent = 'Moderation';
        subtitleEl.textContent = 'Per-guild moderation status.';
        setActive('moderation');
        setBanner('', '');
        clearControls();
        clearView();

        var prev = document.createElement('button');
        prev.className = 'btn';
        prev.textContent = 'Prev page';
        prev.onclick = function () {
          state.moderationPage = Math.max(1, state.moderationPage - 1);
          renderModeration();
        };
        var next = document.createElement('button');
        next.className = 'btn';
        next.textContent = 'Next page';
        next.onclick = function () {
          state.moderationPage = state.moderationPage + 1;
          renderModeration();
        };
        var pageLab = document.createElement('span');
        pageLab.className = 'muted';
        pageLab.textContent = 'Page ' + String(state.moderationPage);
        controlsEl.appendChild(prev);
        controlsEl.appendChild(next);
        controlsEl.appendChild(pageLab);

        var url = '/jarvis/api/moderation?limit=50&page=' + encodeURIComponent(String(state.moderationPage));
        var cacheKey = 'moderation.page.' + String(state.moderationPage);
        function paint(data, meta) {
          clearView();
          showRaw(data);
          updateLastUpdated(lastUpdatedPrefix(meta), meta && meta.ts ? meta.ts : null);
          if (!data || !data.ready) {
            setBanner('bad', 'Discord client not ready');
            return;
          }

          var rows = Array.isArray(data.guilds) ? data.guilds : [];
          renderTable(
            rows.map(function (g) {
              return {
                guildName: g.guildName || g.guildId,
                guildId: g.guildId,
                enabled: Boolean(g.status && g.status.isEnabled),
                tracked: g.status && g.status.trackedMembersCount != null ? g.status.trackedMembersCount : null
              };
            }),
            [
              { label: 'Guild', key: 'guildName' },
              {
                label: 'ID',
                key: 'guildId',
                render: function (row) {
                  var code = document.createElement('code');
                  code.textContent = row.guildId;
                  return code;
                }
              },
              {
                label: 'Status',
                key: 'enabled',
                render: function (row) {
                  return pill(row.enabled ? 'Enabled' : 'Disabled', row.enabled ? 'good' : 'warn');
                }
              },
              { label: 'Tracked', key: 'tracked' }
            ],
            { pageSize: 25 }
          );
        }

        return loadSection(cacheKey, url, paint).catch(function (e) {
          clearView();
          showRaw({ ok: false, error: e.message });
          setBanner('bad', e.message);
        });
      }

      function renderFilters() {
        titleEl.textContent = 'Filters';
        subtitleEl.textContent = 'Per-guild moderation filters.';
        setActive('filters');
        setBanner('', '');
        clearControls();
        clearView();

        var prev = document.createElement('button');
        prev.className = 'btn';
        prev.textContent = 'Prev page';
        prev.onclick = function () {
          state.filtersPage = Math.max(1, state.filtersPage - 1);
          renderFilters();
        };
        var next = document.createElement('button');
        next.className = 'btn';
        next.textContent = 'Next page';
        next.onclick = function () {
          state.filtersPage = state.filtersPage + 1;
          renderFilters();
        };
        var pageLab = document.createElement('span');
        pageLab.className = 'muted';
        pageLab.textContent = 'Page ' + String(state.filtersPage);
        controlsEl.appendChild(prev);
        controlsEl.appendChild(next);
        controlsEl.appendChild(pageLab);

        var url = '/jarvis/api/filters?limit=25&page=' + encodeURIComponent(String(state.filtersPage));
        var cacheKey = 'filters.page.' + String(state.filtersPage);
        function paint(data, meta) {
          clearView();
          showRaw(data);
          updateLastUpdated(lastUpdatedPrefix(meta), meta && meta.ts ? meta.ts : null);
          if (!data || !data.ready) {
            setBanner('bad', 'Discord client not ready');
            return;
          }
          var rows = Array.isArray(data.guilds) ? data.guilds : [];
          renderTable(
            rows.map(function (g) {
              var f = g.filters || {};
              return {
                guildName: g.guildName || g.guildId,
                guildId: g.guildId,
                words: Array.isArray(f.words) ? f.words.length : 0,
                regex: Array.isArray(f.regexPatterns) ? f.regexPatterns.length : 0,
                auto: Boolean(f.autoRegexEnabled)
              };
            }),
            [
              { label: 'Guild', key: 'guildName' },
              {
                label: 'ID',
                key: 'guildId',
                render: function (row) {
                  var code = document.createElement('code');
                  code.textContent = row.guildId;
                  return code;
                }
              },
              { label: 'Words', key: 'words' },
              { label: 'Regex', key: 'regex' },
              {
                label: 'Auto',
                key: 'auto',
                render: function (row) {
                  return pill(row.auto ? 'On' : 'Off', row.auto ? 'good' : 'warn');
                }
              }
            ],
            { pageSize: 25 }
          );
        }

        return loadSection(cacheKey, url, paint).catch(function (e) {
          clearView();
          showRaw({ ok: false, error: e.message });
          setBanner('bad', e.message);
        });
      }

      function renderMonitoring() {
        titleEl.textContent = 'Monitoring';
        subtitleEl.textContent = 'Subscriptions.';
        setActive('monitoring');
        setBanner('', '');
        clearControls();
        clearView();

        function paint(data, meta) {
          clearView();
          showRaw(data);
          updateLastUpdated(lastUpdatedPrefix(meta), meta && meta.ts ? meta.ts : null);
          renderKpis([
            { label: 'Total', value: String(data.count || 0), sub: 'Subscriptions' }
          ]);
          var subs = Array.isArray(data.subscriptions) ? data.subscriptions : [];
          renderTable(
            subs.slice(0, 250).map(function (s) {
              return {
                type: s.monitor_type || 'unknown',
                source: s.source_id || '',
                guild: s.guild_id || '',
                channel: s.channel_id || ''
              };
            }),
            [
              { label: 'Type', key: 'type' },
              { label: 'Source', key: 'source' },
              { label: 'Guild', key: 'guild', render: function (row) { var c = document.createElement('code'); c.textContent = row.guild; return c; } },
              { label: 'Channel', key: 'channel', render: function (row) { var c2 = document.createElement('code'); c2.textContent = row.channel; return c2; } }
            ],
            { pageSize: 25 }
          );
        }

        return loadSection('monitoring.subscriptions', '/jarvis/api/monitoring/subscriptions', paint).catch(function (e) {
          clearView();
          showRaw({ ok: false, error: e.message });
          setBanner('bad', e.message);
        });
      }

      function renderMusic() {
        titleEl.textContent = 'Music';
        subtitleEl.textContent = 'Whitelist + queue snapshots.';
        setActive('music');
        setBanner('', '');
        clearControls();
        clearView();

        function paint(data, meta) {
          clearView();
          showRaw(data);
          updateLastUpdated(lastUpdatedPrefix(meta), meta && meta.ts ? meta.ts : null);
          var wl = Array.isArray(data.whitelist) ? data.whitelist : [];
          var aq = Array.isArray(data.activeQueues) ? data.activeQueues : [];
          renderKpis([
            { label: 'Whitelisted', value: String(wl.length), sub: 'Guilds' },
            { label: 'Active queues', value: String(aq.length), sub: 'Guilds with playback' }
          ]);

          renderTable(
            aq.map(function (q) {
              return {
                guildId: q.guildId,
                current: q.current && q.current.title ? q.current.title : '—',
                queued: q.queuedCount || 0,
                voice: q.voiceChannelId || '—'
              };
            }),
            [
              { label: 'Guild', key: 'guildId', render: function (row) { var c = document.createElement('code'); c.textContent = row.guildId; return c; } },
              { label: 'Now playing', key: 'current' },
              { label: 'Queued', key: 'queued' },
              { label: 'Voice', key: 'voice', render: function (row) { var c2 = document.createElement('code'); c2.textContent = row.voice; return c2; } }
            ],
            { pageSize: 25 }
          );
        }

        return loadSection('music', '/jarvis/api/music', paint).catch(function (e) {
          clearView();
          showRaw({ ok: false, error: e.message });
          setBanner('bad', e.message);
        });
      }

      function renderEconomy() {
        titleEl.textContent = 'Economy';
        subtitleEl.textContent = 'Multiplier + leaderboard.';
        setActive('economy');
        setBanner('', '');
        clearControls();
        clearView();

        function paint(data, meta) {
          clearView();
          showRaw(data);
          updateLastUpdated(lastUpdatedPrefix(meta), meta && meta.ts ? meta.ts : null);
          var m = data.multiplier || {};
          renderKpis([
            { label: 'Multiplier', value: m && m.active ? String(m.multiplier) + 'x' : '1x', sub: m && m.active ? 'Active' : 'Inactive' },
            { label: 'Shop items', value: data.shopItems != null ? String(data.shopItems) : '—', sub: 'Configured' }
          ]);

          var lb = data.leaderboard && Array.isArray(data.leaderboard.entries) ? data.leaderboard.entries : null;
          if (lb) {
            renderTable(
              lb.map(function (e) {
                return {
                  rank: e.rank,
                  user: e.username || e.userId,
                  balance: e.balance
                };
              }),
              [
                { label: '#', key: 'rank' },
                { label: 'User', key: 'user' },
                { label: 'Balance', key: 'balance' }
              ],
              { pageSize: 10 }
            );
          }
        }

        return loadSection('economy.leaderboard', '/jarvis/api/economy?leaderboard=true', paint).catch(function (e) {
          clearView();
          showRaw({ ok: false, error: e.message });
          setBanner('bad', e.message);
        });
      }

      function renderSoul() {
        titleEl.textContent = 'Soul';
        subtitleEl.textContent = 'Soul + sentience + self-mod.';
        setActive('soul');
        setBanner('', '');
        clearControls();
        clearView();

        function paint(data, meta) {
          clearView();
          showRaw(data);
          updateLastUpdated(lastUpdatedPrefix(meta), meta && meta.ts ? meta.ts : null);
          renderKpis([
            { label: 'Soul', value: data.soul && data.soul.enabled ? 'Enabled' : '—', sub: data.soul && data.soul.mode ? String(data.soul.mode) : '' },
            { label: 'Self-mod', value: data.selfMod && data.selfMod.enabled ? 'Enabled' : '—', sub: '' }
          ]);
          var pre = document.createElement('pre');
          pre.textContent = JSON.stringify({ soul: data.soul || null, selfMod: data.selfMod || null }, null, 2);
          viewEl.appendChild(pre);
        }

        return loadSection('soul', '/jarvis/api/soul', paint).catch(function (e) {
          clearView();
          showRaw({ ok: false, error: e.message });
          setBanner('bad', e.message);
        });
      }

      function renderSync() {
        titleEl.textContent = 'Data Sync';
        subtitleEl.textContent = 'Local/Mongo sync status.';
        setActive('sync');
        setBanner('', '');
        clearControls();
        clearView();

        function paint(data, meta) {
          clearView();
          showRaw(data);
          updateLastUpdated(lastUpdatedPrefix(meta), meta && meta.ts ? meta.ts : null);
          var pre = document.createElement('pre');
          pre.textContent = JSON.stringify(data, null, 2);
          viewEl.appendChild(pre);
        }

        return loadSection('sync', '/jarvis/api/sync', paint).catch(function (e) {
          clearView();
          showRaw({ ok: false, error: e.message });
          setBanner('bad', e.message);
        });
      }

      function renderYtdlp() {
        titleEl.textContent = 'yt-dlp';
        subtitleEl.textContent = 'yt-dlp manager status.';
        setActive('ytdlp');
        setBanner('', '');
        clearControls();
        clearView();

        function paint(data, meta) {
          clearView();
          showRaw(data);
          updateLastUpdated(lastUpdatedPrefix(meta), meta && meta.ts ? meta.ts : null);
          var s = data.status || {};
          renderKpis([
            { label: 'Ready', value: s.ready ? 'Yes' : 'No', sub: s.currentVersion ? 'v' + String(s.currentVersion) : '' },
            { label: 'Updating', value: s.updating ? 'Yes' : 'No', sub: s.latestVersion ? 'Latest: ' + String(s.latestVersion) : '' }
          ]);
        }

        return loadSection('ytdlp', '/jarvis/api/ytdlp', paint).catch(function (e) {
          clearView();
          showRaw({ ok: false, error: e.message });
          setBanner('bad', e.message);
        });
      }

      function renderCommands() {
        titleEl.textContent = 'Commands';
        subtitleEl.textContent = 'Command registry catalog.';
        setActive('commands');
        setBanner('', '');
        clearControls();
        clearView();

        function paint(data, meta) {
          clearView();
          showRaw(data);
          updateLastUpdated(lastUpdatedPrefix(meta), meta && meta.ts ? meta.ts : null);
          renderKpis([
            { label: 'Definitions', value: Array.isArray(data.definitions) ? String(data.definitions.length) : '—', sub: 'Loaded' },
            { label: 'Catalog', value: Array.isArray(data.catalog) ? String(data.catalog.length) : '—', sub: 'Help entries' }
          ]);
          var pre = document.createElement('pre');
          pre.textContent = JSON.stringify({ catalog: data.catalog || [] }, null, 2);
          viewEl.appendChild(pre);
        }

        return loadSection('commands.catalog', '/jarvis/api/commands/catalog', paint).catch(function (e) {
          clearView();
          showRaw({ ok: false, error: e.message });
          setBanner('bad', e.message);
        });
      }

      function renderAudit() {
        titleEl.textContent = 'Audit';
        subtitleEl.textContent = 'Recent owner-console actions.';
        setActive('audit');
        setBanner('', '');
        clearControls();
        clearView();

        function paint(data, meta) {
          clearView();
          showRaw(data);
          updateLastUpdated(lastUpdatedPrefix(meta), meta && meta.ts ? meta.ts : null);
          var rows = Array.isArray(data.events) ? data.events.slice().reverse() : [];
          renderTable(
            rows.map(function (e) {
              return {
                ts: new Date(e.ts).toLocaleString(),
                action: e.action,
                ip: e.ip,
                data: e.data ? JSON.stringify(e.data) : ''
              };
            }),
            [
              { label: 'Time', key: 'ts' },
              { label: 'Action', key: 'action' },
              { label: 'IP', key: 'ip' },
              { label: 'Data', key: 'data' }
            ],
            { pageSize: 25 }
          );
        }

        return loadSection('audit', '/jarvis/api/audit?limit=200', paint).catch(function (e) {
          clearView();
          showRaw({ ok: false, error: e.message });
          setBanner('bad', e.message);
        });
      }

      function renderConfig() {
        titleEl.textContent = 'Config';
        subtitleEl.textContent = 'Sanitized runtime config snapshot.';
        setActive('config');
        setBanner('', '');
        clearControls();
        clearView();

        function paint(data, meta) {
          clearView();
          showRaw(data);
          updateLastUpdated(lastUpdatedPrefix(meta), meta && meta.ts ? meta.ts : null);
          var pre = document.createElement('pre');
          pre.textContent = JSON.stringify(data, null, 2);
          viewEl.appendChild(pre);
        }

        return loadSection('config', '/jarvis/api/config', paint).catch(function (e) {
          clearView();
          showRaw({ ok: false, error: e.message });
          setBanner('bad', e.message);
        });
      }

      function renderLogs() {
        titleEl.textContent = 'Logs';
        subtitleEl.textContent = 'Tail or stream a log file.';
        setActive('logs');
        setBanner('', '');
        clearControls();
        clearView();
        stopLogStream();
        state.log.paused = false;
        state.log.buffer = '';

        var row = document.createElement('div');
        row.className = 'row';
        row.style.marginTop = '10px';

        var select = document.createElement('select');
        var btnTail = document.createElement('button');
        btnTail.className = 'btn';
        btnTail.textContent = 'Tail once';

        var btnStream = document.createElement('button');
        btnStream.className = 'btn';
        btnStream.textContent = 'Start stream';

        var btnPause = document.createElement('button');
        btnPause.className = 'btn';
        btnPause.textContent = 'Pause';

        var search = document.createElement('input');
        search.type = 'search';
        search.placeholder = 'Filter…';

        row.appendChild(select);
        row.appendChild(btnTail);
        row.appendChild(btnStream);
        row.appendChild(btnPause);
        row.appendChild(search);
        controlsEl.appendChild(row);

        var pre = document.createElement('pre');
        pre.textContent = '';
        viewEl.appendChild(pre);

        function repaintLog() {
          var q = String(search.value || '').toLowerCase();
          if (!q) {
            pre.textContent = state.log.buffer;
            return;
          }
          var lines = String(state.log.buffer || '').split('\\n');
          var out = [];
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (line && line.charCodeAt(line.length - 1) === 13) line = line.slice(0, -1);
            if (String(line).toLowerCase().indexOf(q) !== -1) out.push(String(line));
          }
          pre.textContent = out.join('\\n');
        }

        search.oninput = repaintLog;

        function appendLogChunk(text) {
          if (!text) return;
          state.log.buffer = state.log.buffer + text;
          if (state.log.buffer.length > 512000) {
            state.log.buffer = state.log.buffer.slice(state.log.buffer.length - 512000);
          }
          if (!state.log.paused) {
            repaintLog();
          }
        }

        btnPause.onclick = function () {
          state.log.paused = !state.log.paused;
          btnPause.textContent = state.log.paused ? 'Resume' : 'Pause';
          if (!state.log.paused) repaintLog();
        };

        btnTail.onclick = function () {
          setBanner('', '');
          api('/jarvis/api/logs/tail?file=' + encodeURIComponent(select.value) + '&lines=400').then(function (tail) {
            appendLogChunk(String(tail && tail.data ? tail.data : '') + '\\n');
            updateLastUpdated();
          }).catch(function (e) {
            setBanner('bad', e.message);
          });
        };

        btnStream.onclick = function () {
          if (state.log.es) {
            stopLogStream();
            btnStream.textContent = 'Start stream';
            return;
          }
          setBanner('', '');
          state.log.file = select.value;
          state.log.es = new EventSource('/jarvis/api/logs/stream?file=' + encodeURIComponent(state.log.file));
          btnStream.textContent = 'Stop stream';
          state.log.es.addEventListener('chunk', function (ev) {
            try {
              var p = JSON.parse(ev.data);
              if (p && p.type === 'init') {
                state.log.buffer = String(p.data || '') + '\\n';
              } else if (p && p.type === 'append') {
                appendLogChunk(String(p.data || ''));
              } else if (p && p.type === 'rotated') {
                appendLogChunk('\\n--- log rotated ---\\n');
              }
              if (!state.log.paused) repaintLog();
              updateLastUpdated();
            } catch {
            }
          });
          state.log.es.addEventListener('error', function () {
            setBanner('bad', 'Stream error');
          });
        };

        return api('/jarvis/api/logs/files').then(function (filesData) {
          showRaw(filesData);
          var files = filesData && filesData.files ? filesData.files : [];
          clear(select);
          for (var i = 0; i < files.length; i++) {
            var opt = document.createElement('option');
            opt.value = String(files[i].name);
            opt.textContent = String(files[i].name);
            select.appendChild(opt);
          }
          if (files.length) {
            select.value = String(files[0].name);
            btnTail.onclick();
          } else {
            pre.textContent = 'No log files.';
          }
        }).catch(function (e) {
          setBanner('bad', e.message);
        });
      }

      function show(route) {
        stopLogStream();
        var r = String(route || 'overview');
        if (r !== 'logs') {
          state.log.paused = false;
        }
        if (r === 'overview') return renderOverview();
        if (r === 'providers') return renderProviders();
        if (r === 'agent') return renderAgent();
        if (r === 'moderation') return renderModeration();
        if (r === 'filters') return renderFilters();
        if (r === 'monitoring') return renderMonitoring();
        if (r === 'music') return renderMusic();
        if (r === 'economy') return renderEconomy();
        if (r === 'soul') return renderSoul();
        if (r === 'sync') return renderSync();
        if (r === 'ytdlp') return renderYtdlp();
        if (r === 'logs') return renderLogs();
        if (r === 'commands') return renderCommands();
        if (r === 'audit') return renderAudit();
        if (r === 'config') return renderConfig();
        return renderOverview();
      }

      function currentRoute() {
        var hash = String(location.hash || '').replace(/^#/, '').trim();
        return hash || 'overview';
      }

      function setAutoRefresh(ms) {
        state.autoRefreshMs = Number(ms) || 0;
        if (state.autoTimer) {
          clearInterval(state.autoTimer);
          state.autoTimer = null;
        }
        if (state.autoRefreshMs > 0) {
          state.autoTimer = setInterval(function () {
            if (currentRoute() === 'logs') return;
            show(currentRoute());
          }, state.autoRefreshMs);
        }
      }

      rawToggleEl.addEventListener('change', function () {
        state.raw = Boolean(rawToggleEl.checked);
        show(currentRoute());
      });

      refreshEveryEl.addEventListener('change', function () {
        setAutoRefresh(refreshEveryEl.value);
      });

      window.addEventListener('hashchange', function () { show(currentRoute()); });
      refreshBtn.addEventListener('click', function () { show(currentRoute()); });

      api('/jarvis/api/csrf').then(function (d) {
        state.csrfToken = d && d.csrfToken ? String(d.csrfToken) : null;
      }).catch(function () {
        state.csrfToken = null;
      }).finally(function () {
        show(currentRoute());
      });
    })();
  </script>
</body>
</html>`;
}

router.get('/', async (req, res) => {
    const token = req.cookies?.jarvis_owner_session;
    if (token) {
        const session = auth.validateSession(token);
        if (session && String(session.userId) === getOwnerId()) {
            return res.redirect('/jarvis/panel');
        }
    }

    const error = req.query.error;
    const errorMessages = {
        not_authenticated: 'Please log in to access the owner console.',
        session_expired: 'Your session has expired. Please log in again.',
        unauthorized: 'You are not authorized to access this console.',
        oauth_failed: 'Discord authentication failed. Please try again.',
        owner_not_configured: 'Owner ID is not configured.'
    };

    const state = crypto.randomBytes(16).toString('hex');
    res.cookie('jarvis_oauth_state', state, getCookieOptions(req, { maxAge: 600000 }));

    const ownerId = getOwnerId();
    if (!ownerId) {
        return res.send(getLoginPage({ oauthUrl: '', errorMsg: errorMessages.owner_not_configured }));
    }

    let oauthUrl = '';
    let errorMsg = errorMessages[error] || '';

    try {
        oauthUrl = auth.getOAuthUrl(state, '/jarvis/callback');
    } catch (e) {
        errorMsg = errorMsg || `Discord OAuth is not configured: ${e.message}`;
    }

    res.send(getLoginPage({ oauthUrl, errorMsg }));
});

router.get('/callback', async (req, res) => {
    const { code, state } = req.query;
    const storedState = req.cookies?.jarvis_oauth_state;
    res.clearCookie('jarvis_oauth_state', { path: '/' });

    if (!state || state !== storedState) {
        return res.redirect('/jarvis?error=oauth_failed');
    }

    try {
        const tokens = await auth.exchangeCode(code, '/jarvis/callback');
        const discordUser = await auth.getDiscordUser(tokens.access_token);

        const ownerId = getOwnerId();
        if (!ownerId || String(discordUser.id) !== ownerId) {
            return res.redirect('/jarvis?error=unauthorized');
        }

        const sessionToken = auth.createSession(discordUser.id, discordUser);
        res.cookie('jarvis_owner_session', sessionToken, getCookieOptions(req, { maxAge: 12 * 60 * 60 * 1000 }));

        res.redirect('/jarvis/panel');
    } catch (error) {
        console.error('[JarvisOwner] OAuth callback error:', error);
        res.redirect('/jarvis?error=oauth_failed');
    }
});

router.get('/panel', requireOwner, (req, res) => {
    res.send(getPanelPage(req.session));
});

router.get('/api/identity', requireOwner, (req, res) => {
    res.json({
        ok: true,
        ownerId: getOwnerId(),
        userId: req.session.userId,
        discord: req.session.discordData || null
    });
});

router.get('/api/csrf', requireOwner, (req, res) => {
    res.json({ ok: true, csrfToken: req.session.csrfToken });
});

router.get('/api/cache/:key', requireOwner, async (req, res) => {
    const rawKey = String(req.params?.key || '').trim();
    if (!rawKey || rawKey.length > 120 || !/^[a-zA-Z0-9._-]+$/.test(rawKey)) {
        return res.status(400).json({ ok: false, error: 'invalid_key' });
    }
    const collection = getSnapshotCollection();
    if (!collection) {
        return res.status(503).json({ ok: false, error: 'mongo_unavailable' });
    }
    try {
        const doc = await collection.findOne({ _id: rawKey });
        if (!doc) {
            return res.status(404).json({ ok: false, error: 'not_found' });
        }
        return res.json({
            ok: true,
            key: doc.key,
            updatedAt: doc.updatedAt ? new Date(doc.updatedAt).getTime() : null,
            expiresAt: doc.expiresAt ? new Date(doc.expiresAt).getTime() : null,
            sizeBytes: doc.sizeBytes || null,
            payload: doc.payload || null
        });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e?.message || 'failed' });
    }
});

router.get('/api/audit', requireOwner, (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 500);
    const events = jarvisAuditLog.slice(-limit);
    const payload = { ok: true, count: events.length, events };
    res.json(payload);
    saveJarvisSnapshot('audit', payload).catch(() => null);
});

router.get('/api/stats', requireOwner, (req, res) => {
    const client = getDiscordClient();

    const now = Date.now();
    const uptimeMs = process.uptime() * 1000;

    let discordStats = { guilds: 0, users: 0, channels: 0, ready: false, tag: null };
    if (client && typeof client.isReady === 'function' && client.isReady()) {
        discordStats.ready = true;
        discordStats.tag = client.user?.tag || null;
        discordStats.guilds = client.guilds?.cache?.size || 0;
        discordStats.channels = client.channels?.cache?.size || 0;
        try {
            discordStats.users = client.guilds.cache.reduce((acc, g) => acc + (g.memberCount || 0), 0);
        } catch {
            discordStats.users = 0;
        }
    }

    res.json({
        ok: true,
        now,
        uptimeMs,
        nodeVersion: process.version,
        platform: process.platform,
        memory: {
            rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
            heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            heapTotalMb: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
        },
        cpu: {
            load1: os.loadavg()[0],
            cores: os.cpus().length
        },
        discord: discordStats
    });
});

router.get('/api/guilds', requireOwner, (req, res) => {
    const client = getDiscordClient();
    if (!client || typeof client.isReady !== 'function' || !client.isReady()) {
        return res.json({ ok: true, ready: false, guilds: [] });
    }

    const guilds = Array.from(client.guilds.cache.values()).map(g => ({
        id: g.id,
        name: g.name,
        memberCount: g.memberCount || 0,
        icon: typeof g.iconURL === 'function' ? g.iconURL({ size: 64 }) : null,
        ownerId: g.ownerId
    }));

    res.json({ ok: true, ready: true, count: guilds.length, guilds });
});

function listLocalCommandFiles() {
    const baseDir = path.join(__dirname, '..', 'commands');
    const found = [];

    function walk(dir) {
        const entries = fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : [];
        for (const entry of entries) {
            if (entry.name.startsWith('.')) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
                continue;
            }
            if (entry.isFile() && entry.name.endsWith('.js')) {
                const rel = path.relative(baseDir, full).replace(/\\/g, '/');
                found.push(rel);
            }
        }
    }

    walk(baseDir);
    return found.sort();
}

router.get('/api/commands', requireOwner, async (req, res) => {
    const client = getDiscordClient();

    let registered = [];
    if (client && typeof client.isReady === 'function' && client.isReady()) {
        try {
            const commands = await client.application?.commands?.fetch().catch(() => null);
            if (commands && typeof commands.values === 'function') {
                registered = Array.from(commands.values()).map(cmd => ({
                    id: cmd.id,
                    name: cmd.name,
                    description: cmd.description || '',
                    type: cmd.type
                }));
            }
        } catch {
            registered = [];
        }
    }

    const localFiles = listLocalCommandFiles();

    res.json({
        ok: true,
        registered,
        localFiles
    });
});

router.get('/api/config', requireOwner, (req, res) => {
    const snapshot = {
        deployment: config.deployment,
        ai: config.ai,
        features: config.features,
        commands: config.commands,
        sentience: config.sentience,
        youtube: { apiKeyConfigured: Boolean(config.youtube?.apiKey) },
        brave: { apiKeyConfigured: Boolean(config.brave?.apiKey) },
        crypto: { apiKeyConfigured: Boolean(config.crypto?.apiKey) },
        admin: { userId: config.admin?.userId },
        server: { port: config.server?.port }
    };

    const payload = { ok: true, config: snapshot };
    res.json(payload);
    saveJarvisSnapshot('config', payload).catch(() => null);
});

router.get('/api/overview', requireOwner, async (req, res) => {
    const client = getDiscordClient();
    const handlers = getDiscordHandlers();

    const discord = {
        ready: false,
        tag: null,
        guilds: 0,
        users: 0,
        channels: 0
    };

    if (client && typeof client.isReady === 'function' && client.isReady()) {
        discord.ready = true;
        discord.tag = client.user?.tag || null;
        discord.guilds = client.guilds?.cache?.size || 0;
        discord.channels = client.channels?.cache?.size || 0;
        try {
            discord.users = client.guilds.cache.reduce((acc, g) => acc + (g.memberCount || 0), 0);
        } catch {
            discord.users = 0;
        }
    }

    let providerStatus = [];
    let providerHealth = null;
    let selectionMode = 'unknown';
    let providerType = 'unknown';

    try {
        providerStatus = aiManager.getProviderStatus();
        providerHealth = aiManager.getHealthSummary();
        selectionMode = aiManager.getSelectionMode();
        providerType = aiManager.getProviderType();
    } catch {
        providerStatus = [];
        providerHealth = null;
    }

    let healthSnapshot = null;
    try {
        healthSnapshot = await gatherHealthSnapshot({ includeProviders: false, pingDatabase: false });
    } catch {
        healthSnapshot = null;
    }

    let agentSummary = {
        ok: false,
        health: null,
        circuit: null,
        activeSessions: 0,
        healthLabel: 'unavailable'
    };

    try {
        const metrics = handlers?.browserAgent?.getMetrics?.() || null;
        const report = handlers?.agentMonitor?.getHealthReport?.(handlers?.browserAgent) || null;
        if (metrics && report) {
            const score = report.overallHealth;
            agentSummary = {
                ok: true,
                health: score,
                circuit: metrics.circuitBreakerStatus || null,
                activeSessions: metrics.activeSessions || 0,
                healthLabel: score >= 75 ? 'ok' : score >= 50 ? 'warning' : 'critical'
            };
        }
    } catch {
        agentSummary = agentSummary;
    }

    let subsCount = 0;
    try {
        const all = await subscriptions.get_all_subscriptions().catch(() => []);
        subsCount = Array.isArray(all) ? all.length : 0;
    } catch {
        subsCount = 0;
    }

    let syncStatus = null;
    try {
        syncStatus = typeof dataSync.getSyncStatus === 'function' ? dataSync.getSyncStatus() : null;
    } catch {
        syncStatus = null;
    }

    let ytdlp = null;
    try {
        ytdlp = ytDlpManager?.getStatus?.() || null;
    } catch {
        ytdlp = null;
    }

    let multiplier = null;
    try {
        multiplier = starkEconomy?.getMultiplierStatus?.() || null;
    } catch {
        multiplier = null;
    }

    const logsDir = path.join(__dirname, '..', '..', 'logs');
    let logFiles = [];
    try {
        if (fs.existsSync(logsDir)) {
            const entries = fs.readdirSync(logsDir, { withFileTypes: true });
            logFiles = entries
                .filter(e => e.isFile())
                .slice(0, 50)
                .map(e => {
                    const p = path.join(logsDir, e.name);
                    const st = fs.statSync(p);
                    return { name: e.name, size: st.size, mtimeMs: st.mtimeMs };
                })
                .sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
        }
    } catch {
        logFiles = [];
    }

    const payload = {
        ok: true,
        overview: {
            system: {
                now: Date.now(),
                uptimeMs: process.uptime() * 1000,
                nodeVersion: process.version,
                platform: process.platform,
                memory: {
                    rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
                    heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
                }
            },
            discord,
            database: healthSnapshot?.database || { connected: null, ping: 'unknown' },
            providers: {
                total: providerStatus.length,
                active: providerStatus.filter(p => !p.isDisabled).length,
                selectionMode,
                providerType,
                health: providerHealth
            },
            agent: agentSummary,
            monitoring: { subscriptions: subsCount },
            music: { activeQueues: musicManager?.getActiveGuildIds?.()?.length || 0 },
            economy: { multiplierActive: Boolean(multiplier?.active) },
            sync: syncStatus,
            ytdlp,
            logs: { files: logFiles.length },
            commands: { defined: Array.isArray(commandRegistry?.commandDefinitions) ? commandRegistry.commandDefinitions.length : 0 },
            errorLogger: {
                pendingQueue: Array.isArray(errorLogger?.pendingQueue) ? errorLogger.pendingQueue.length : null
            },
            soul: { enabled: Boolean(selfhostFeatures?.jarvisSoul), mood: selfhostFeatures?.jarvisSoul?.mood || null }
        }
    };

    res.json(payload);
    saveJarvisSnapshot('overview', payload).catch(() => null);
});

router.get('/api/providers', requireOwner, (req, res) => {
    const availableProviderTypes = [
        'auto',
        'openai',
        'groq',
        'openrouter',
        'google',
        'deepseek',
        'ollama'
    ];

    let providers = [];
    let health = null;
    let selectionMode = 'unknown';
    let providerType = 'unknown';

    try {
        providers = aiManager.getProviderStatus();
        health = aiManager.getHealthSummary();
        selectionMode = aiManager.getSelectionMode();
        providerType = aiManager.getProviderType();
    } catch {
        providers = [];
        health = null;
    }

    const payload = {
        ok: true,
        selectionMode,
        providerType,
        availableProviderTypes,
        health,
        providers,
        count: providers.length,
        active: providers.filter(p => !p.isDisabled).length
    };

    res.json(payload);
    saveJarvisSnapshot('providers', payload).catch(() => null);
});

router.post(
    '/api/providers/selection-mode',
    requireOwner,
    rateLimit({ keyPrefix: 'jarvis:providers', max: 60, windowMs: 60 * 1000 }),
    requireCsrf,
    (req, res) => {
    const mode = String(req.body?.mode || '').toLowerCase();
    if (mode !== 'random' && mode !== 'ranked') {
        return res.status(400).json({ ok: false, error: 'invalid_mode' });
    }

    try {
        aiManager.setRandomSelection(mode === 'random');
        recordAuditEvent(req, 'providers.selectionMode', { mode });
        return res.json({ ok: true, selectionMode: aiManager.getSelectionMode() });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e?.message || 'failed' });
    }
    }
);

router.post(
    '/api/providers/type',
    requireOwner,
    rateLimit({ keyPrefix: 'jarvis:providers', max: 60, windowMs: 60 * 1000 }),
    requireCsrf,
    (req, res) => {
    const type = String(req.body?.type || '').toLowerCase();
    try {
        aiManager.setProviderType(type);
        recordAuditEvent(req, 'providers.type', { type });
        return res.json({ ok: true, providerType: aiManager.getProviderType() });
    } catch (e) {
        return res.status(400).json({ ok: false, error: e?.message || 'invalid_type' });
    }
    }
);

router.get('/api/agent/health', requireOwner, (req, res) => {
    const handlers = getDiscordHandlers();
    const browserAgent = handlers?.browserAgent;
    const agentMonitor = handlers?.agentMonitor;

    if (!browserAgent?.getMetrics || !agentMonitor?.getHealthReport) {
        return res.json({ ok: false, error: 'not_initialized' });
    }

    try {
        const metrics = browserAgent.getMetrics();
        const health = agentMonitor.getHealthReport(browserAgent);
        const payload = { ok: true, metrics, health };
        res.json(payload);
        saveJarvisSnapshot('agent.health', payload).catch(() => null);
        return;
    } catch (e) {
        return res.status(500).json({ ok: false, error: e?.message || 'failed' });
    }
});

router.get('/api/moderation', requireOwner, (req, res) => {
    const client = getDiscordClient();
    if (!client || typeof client.isReady !== 'function' || !client.isReady()) {
        return res.json({ ok: true, ready: false, guilds: [] });
    }

    const ids = Array.from(client.guilds.cache.keys());
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const page = Math.max(Number(req.query.page || 1), 1);
    const start = (page - 1) * limit;
    const slice = ids.slice(start, start + limit);

    const rows = slice.map(guildId => {
        const g = client.guilds.cache.get(guildId);
        let status = null;
        try {
            status = moderation.getStatus(guildId);
        } catch {
            status = null;
        }
        return {
            guildId,
            guildName: g?.name || null,
            status
        };
    });

    const payload = { ok: true, ready: true, page, limit, total: ids.length, guilds: rows };
    res.json(payload);
    saveJarvisSnapshot(`moderation.page.${page}`, payload).catch(() => null);
});

router.get('/api/filters', requireOwner, async (req, res) => {
    const client = getDiscordClient();
    if (!client || typeof client.isReady !== 'function' || !client.isReady()) {
        return res.json({ ok: true, ready: false, guilds: [] });
    }

    const guildIdParam = req.query.guildId ? String(req.query.guildId) : null;
    const ids = guildIdParam ? [guildIdParam] : Array.from(client.guilds.cache.keys());
    const limit = Math.min(Number(req.query.limit || 25), 100);
    const page = Math.max(Number(req.query.page || 1), 1);
    const start = (page - 1) * limit;
    const slice = guildIdParam ? ids : ids.slice(start, start + limit);

    const guilds = [];
    for (const guildId of slice) {
        const g = client.guilds.cache.get(guildId);
        let filters = null;
        try {
            filters = await moderationFilters.getFilters(guildId);
            if (filters) {
                filters = {
                    words: filters.words || [],
                    regexPatterns: filters.regexPatterns || [],
                    autoRegexEnabled: Boolean(filters.autoRegexEnabled),
                    cachedAt: filters.cachedAt || null
                };
            }
        } catch {
            filters = null;
        }
        guilds.push({ guildId, guildName: g?.name || null, filters });
    }

    const payload = { ok: true, ready: true, page, limit, total: ids.length, guilds };
    res.json(payload);
    saveJarvisSnapshot(`filters.page.${page}`, payload).catch(() => null);
});

router.get('/api/monitoring/subscriptions', requireOwner, async (req, res) => {
    try {
        const all = await subscriptions.get_all_subscriptions().catch(() => []);
        const subs = Array.isArray(all) ? all : [];
        const byType = subs.reduce((acc, s) => {
            const t = String(s?.monitor_type || 'unknown');
            acc[t] = (acc[t] || 0) + 1;
            return acc;
        }, {});
        const payload = { ok: true, count: subs.length, byType, subscriptions: subs };
        res.json(payload);
        saveJarvisSnapshot('monitoring.subscriptions', payload).catch(() => null);
    } catch (e) {
        res.status(500).json({ ok: false, error: e?.message || 'failed' });
    }
});

router.get('/api/music', requireOwner, (req, res) => {
    const whitelist = musicGuildWhitelist.getWhitelistedGuilds();
    const activeGuilds = typeof musicManager.getActiveGuildIds === 'function' ? musicManager.getActiveGuildIds() : [];
    const activeQueues = activeGuilds.map(gid => musicManager.getQueueSnapshot(gid));

    const payload = { ok: true, whitelist, activeGuilds, activeQueues };
    res.json(payload);
    saveJarvisSnapshot('music', payload).catch(() => null);
});

router.get('/api/economy', requireOwner, async (req, res) => {
    let multiplier = null;
    try {
        multiplier = starkEconomy.getMultiplierStatus();
    } catch {
        multiplier = null;
    }

    let leaderboard = null;
    const includeLeaderboard = String(req.query.leaderboard || '').toLowerCase() === 'true';
    if (includeLeaderboard && typeof starkEconomy.getLeaderboard === 'function') {
        try {
            leaderboard = await starkEconomy.getLeaderboard(10, getDiscordClient());
        } catch {
            leaderboard = null;
        }
    }

    const payload = {
        ok: true,
        config: starkEconomy.ECONOMY_CONFIG || null,
        shopItems: Array.isArray(starkEconomy.SHOP_ITEMS) ? starkEconomy.SHOP_ITEMS.length : null,
        multiplier,
        leaderboard
    };

    res.json(payload);
    saveJarvisSnapshot('economy.leaderboard', payload).catch(() => null);
});

router.get('/api/soul', requireOwner, (req, res) => {
    let soul = null;
    let selfMod = null;
    try {
        soul = selfhostFeatures?.jarvisSoul?.getStatus?.() || null;
    } catch {
        soul = null;
    }
    try {
        selfMod = selfhostFeatures?.selfMod?.getStatus?.() || null;
    } catch {
        selfMod = null;
    }

    const payload = {
        ok: true,
        sentience: config.sentience || null,
        soul,
        selfMod
    };

    res.json(payload);
    saveJarvisSnapshot('soul', payload).catch(() => null);
});

router.get('/api/sync', requireOwner, (req, res) => {
    try {
        const status = typeof dataSync.getSyncStatus === 'function' ? dataSync.getSyncStatus() : null;
        const payload = { ok: true, status };
        res.json(payload);
        saveJarvisSnapshot('sync', payload).catch(() => null);
    } catch (e) {
        res.status(500).json({ ok: false, error: e?.message || 'failed' });
    }
});

router.get('/api/ytdlp', requireOwner, (req, res) => {
    try {
        const payload = { ok: true, status: ytDlpManager?.getStatus?.() || null };
        res.json(payload);
        saveJarvisSnapshot('ytdlp', payload).catch(() => null);
    } catch (e) {
        res.status(500).json({ ok: false, error: e?.message || 'failed' });
    }
});

router.get('/api/commands/catalog', requireOwner, (req, res) => {
    try {
        const catalog =
            typeof commandRegistry.buildHelpCatalog === 'function'
                ? commandRegistry.buildHelpCatalog()
                : [];
        const payload = {
            ok: true,
            catalog,
            definitions: commandRegistry.commandDefinitions || [],
            ephemeral: Array.from(commandRegistry.SLASH_EPHEMERAL_COMMANDS || [])
        };

        res.json(payload);
        saveJarvisSnapshot('commands.catalog', payload).catch(() => null);
    } catch (e) {
        res.status(500).json({ ok: false, error: e?.message || 'failed' });
    }
});

function listLogFiles() {
    const logsDir = path.join(__dirname, '..', '..', 'logs');
    if (!fs.existsSync(logsDir)) {
        return [];
    }

    const entries = fs.readdirSync(logsDir, { withFileTypes: true });
    return entries
        .filter(e => e.isFile())
        .map(e => {
            const p = path.join(logsDir, e.name);
            const st = fs.statSync(p);
            return { name: e.name, size: st.size, mtimeMs: st.mtimeMs };
        })
        .sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
}

function tailLogFile(fileName, lineCount) {
    const logsDir = path.join(__dirname, '..', '..', 'logs');
    const safeName = String(fileName || '').trim();
    if (!safeName || safeName.includes('/') || safeName.includes('\\') || safeName.includes('..')) {
        throw new Error('Invalid file');
    }

    const filePath = path.join(logsDir, safeName);
    if (!filePath.startsWith(logsDir)) {
        throw new Error('Invalid file');
    }

    const st = fs.statSync(filePath);
    const maxBytes = 256 * 1024;
    const bytesToRead = Math.min(st.size, maxBytes);

    const fd = fs.openSync(filePath, 'r');
    try {
        const buf = Buffer.alloc(bytesToRead);
        fs.readSync(fd, buf, 0, bytesToRead, st.size - bytesToRead);
        const text = buf.toString('utf8');
        const lines = text.split(/\r?\n/);
        const keep = Math.max(1, Math.min(Number(lineCount) || 200, 2000));
        return lines.slice(-keep);
    } finally {
        fs.closeSync(fd);
    }
}

router.get('/api/logs/files', requireOwner, (req, res) => {
    try {
        const files = listLogFiles();
        res.json({ ok: true, count: files.length, files });
    } catch (e) {
        res.status(500).json({ ok: false, error: e?.message || 'failed' });
    }
});

router.get(
    '/api/logs/tail',
    requireOwner,
    rateLimit({ keyPrefix: 'jarvis:logs', max: 120, windowMs: 60 * 1000 }),
    (req, res) => {
    const file = req.query.file ? String(req.query.file) : '';
    const lines = Math.min(Number(req.query.lines || 200), 2000);
    try {
        const out = tailLogFile(file, lines);
        res.json({ ok: true, file, lines: out.length, data: out.join('\n') });
    } catch (e) {
        res.status(400).json({ ok: false, error: e?.message || 'failed' });
    }
    }
);

router.get(
    '/api/logs/stream',
    requireOwner,
    rateLimit({ keyPrefix: 'jarvis:logs_stream', max: 30, windowMs: 60 * 1000 }),
    (req, res) => {
        const logsDir = path.join(__dirname, '..', '..', 'logs');
        const safeName = String(req.query.file || '').trim();
        if (!safeName || safeName.includes('/') || safeName.includes('\\') || safeName.includes('..')) {
            return res.status(400).json({ ok: false, error: 'invalid_file' });
        }

        const filePath = path.join(logsDir, safeName);
        if (!filePath.startsWith(logsDir)) {
            return res.status(400).json({ ok: false, error: 'invalid_file' });
        }

        res.status(200);
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        if (typeof res.flushHeaders === 'function') {
            res.flushHeaders();
        }

        function sendEvent(event, payload) {
            try {
                res.write(`event: ${event}\n`);
                res.write(`data: ${JSON.stringify(payload)}\n\n`);
            } catch {
            }
        }

        let lastSize = 0;
        try {
            const initLines = tailLogFile(safeName, 200);
            sendEvent('chunk', { type: 'init', file: safeName, data: initLines.join('\n') });
            const st = fs.statSync(filePath);
            lastSize = st.size;
        } catch (e) {
            sendEvent('error', { ok: false, error: e?.message || 'failed' });
        }

        const maxChunkBytes = 64 * 1024;
        const pollMs = 1000;

        const interval = setInterval(() => {
            try {
                const st = fs.statSync(filePath);
                if (st.size < lastSize) {
                    lastSize = 0;
                    sendEvent('chunk', { type: 'rotated', file: safeName, data: '' });
                }
                if (st.size === lastSize) {
                    res.write(`: ping ${Date.now()}\n\n`);
                    return;
                }

                const toRead = Math.min(st.size - lastSize, maxChunkBytes);
                if (toRead <= 0) return;

                const fd = fs.openSync(filePath, 'r');
                try {
                    const buf = Buffer.alloc(toRead);
                    fs.readSync(fd, buf, 0, toRead, lastSize);
                    lastSize += toRead;
                    const text = buf.toString('utf8');
                    if (text) {
                        sendEvent('chunk', { type: 'append', file: safeName, data: text });
                    }
                } finally {
                    fs.closeSync(fd);
                }
            } catch (e) {
                sendEvent('error', { ok: false, error: e?.message || 'failed' });
            }
        }, pollMs);

        req.on('close', () => {
            clearInterval(interval);
        });
    }
);

router.post('/logout', (req, res) => {
    const token = req.cookies?.jarvis_owner_session;
    if (token) {
        auth.destroySession(token);
    }
    res.clearCookie('jarvis_owner_session', { path: '/' });
    res.redirect('/jarvis');
});

module.exports = router;
