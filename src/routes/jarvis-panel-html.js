'use strict';

function getDiscordAvatarUrl(discordUser) {
    if (!discordUser || !discordUser.id) {return '';}
    if (discordUser.avatar) {
        const ext = String(discordUser.avatar).startsWith('a_') ? 'gif' : 'png';
        return `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.${ext}?size=64`;
    }
    return 'https://cdn.discordapp.com/embed/avatars/0.png';
}

function getLoginPage({ oauthUrl, errorMsg }) {
    const safeError = errorMsg ? String(errorMsg).replace(/[<>]/g, '') : '';
    const buttonText = oauthUrl ? 'Login with Discord' : 'Discord OAuth not configured';

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Jarvis Owner Console</title>
  <style>
    body { margin: 0; font-family: 'Comic Neue', 'Comic Sans MS', cursive, sans-serif; background: #000; color: #ccc; display: flex; min-height: 100vh; align-items: center; justify-content: center; }
    .card { width: min(520px, 92vw); background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 20px; box-shadow: 0 12px 40px rgba(0,0,0,0.35); }
    h1 { margin: 0 0 6px; font-size: 20px; }
    p { margin: 0 0 14px; opacity: 0.9; font-size: 13px; }
    a.btn { display: inline-flex; align-items: center; justify-content: center; width: 100%; box-sizing: border-box; padding: 12px; border-radius: 10px; border: 0; cursor: pointer; background: #fff; color: #000; font-weight: 700; text-decoration: none; }
    a.btn[aria-disabled="true"] { opacity: 0.6; pointer-events: none; }
    .error { margin-top: 10px; color: #888; min-height: 18px; font-size: 13px; }
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
    :root { --bg:#000; --panel:rgba(255,255,255,0.03); --panel2:rgba(255,255,255,0.05); --border:rgba(255,255,255,0.06); --text:#ccc; --muted:rgba(255,255,255,0.5); --good:#fff; --warn:#888; --bad:#555; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: 'Comic Neue', 'Comic Sans MS', cursive, sans-serif; background:var(--bg); color:var(--text); }
    header { position:sticky; top:0; z-index:5; backdrop-filter: blur(10px); background: rgba(0,0,0,0.85); border-bottom: 1px solid var(--border); }
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
    .banner.good { border-color: rgba(255,255,255,0.15); background: rgba(255,255,255,0.05); }
    .banner.bad { border-color: rgba(255,255,255,0.1); background: rgba(255,255,255,0.03); }
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
          <a href="#music" data-route="music">Music</a>
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
            { label: 'Music', value: String(o.music.activeQueues || 0), sub: 'Active queues' },
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
        if (r === 'music') return renderMusic();
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

module.exports = { getDiscordAvatarUrl, getLoginPage, getPanelPage };
