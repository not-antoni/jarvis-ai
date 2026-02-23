'use strict';

const crypto = require('crypto');
const express = require('express');
const path = require('path');

// ─── Rate Limiting ───────────────────────────────────────────────────────────

const dashboardLoginBuckets = new Map();
let dashboardLoginBucketsLastPruneAt = 0;
const DASHBOARD_LOGIN_BUCKET_PRUNE_INTERVAL_MS = 5 * 60 * 1000;
const DASHBOARD_LOGIN_BUCKET_MAX = Math.max(
    1000,
    Number(process.env.DASHBOARD_LOGIN_BUCKET_MAX || '') || 5000
);

function pruneDashboardLoginBuckets(now, windowMs) {
    if (now - dashboardLoginBucketsLastPruneAt < DASHBOARD_LOGIN_BUCKET_PRUNE_INTERVAL_MS) {
        return;
    }
    dashboardLoginBucketsLastPruneAt = now;

    for (const [key, bucket] of dashboardLoginBuckets.entries()) {
        const bucketWindowMs = Number(bucket?.windowMs || windowMs || 0);
        const bucketResetAt = Number(bucket?.resetAt || 0);
        const expiresAt = bucketResetAt + (Number.isFinite(bucketWindowMs) ? bucketWindowMs : 0);
        if (!bucketResetAt || !Number.isFinite(expiresAt) || now >= expiresAt) {
            dashboardLoginBuckets.delete(key);
        }
    }

    if (dashboardLoginBuckets.size > DASHBOARD_LOGIN_BUCKET_MAX) {
        const entries = Array.from(dashboardLoginBuckets.entries());
        entries.sort(
            (a, b) => Number(a?.[1]?.lastSeenAt || 0) - Number(b?.[1]?.lastSeenAt || 0)
        );
        const overflow = dashboardLoginBuckets.size - DASHBOARD_LOGIN_BUCKET_MAX;
        for (let i = 0; i < overflow; i += 1) {
            dashboardLoginBuckets.delete(entries[i][0]);
        }
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isProductionLike() {
    if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
        return true;
    }

    return Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.RENDER_EXTERNAL_URL);
}

function getClientIp(req) {
    const xf = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    return xf || req.ip || req.connection?.remoteAddress || 'unknown';
}

function getDashboardPassword() {
    const candidates = [process.env.DASHBOARD_PASSWORD, process.env.PASSWORD];
    for (const raw of candidates) {
        const value = typeof raw === 'string' ? raw.trim() : '';
        if (value) return value;
    }
    return null;
}

function makeDashboardCookieValue(password) {
    return crypto.createHmac('sha256', password).update('jarvis.dashboard.auth.v1').digest('hex');
}

function timingSafeEqualHex(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;
    try {
        return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
    } catch {
        return false;
    }
}

function isDashboardAuthed(req) {
    const password = getDashboardPassword();
    if (!password) {
        return !isProductionLike();
    }
    const expected = makeDashboardCookieValue(password);
    const provided = req.cookies?.jarvis_dashboard_auth;
    return timingSafeEqualHex(String(provided || ''), expected);
}

function shouldUseSecureCookie(req) {
    const forwardedProto = String(req.headers?.['x-forwarded-proto'] || '').toLowerCase();
    return Boolean(req.secure || forwardedProto === 'https');
}

function setDashboardAuthCookie(req, res) {
    const password = getDashboardPassword();
    if (!password) return;
    const maxAgeMs = 10 * 24 * 60 * 60 * 1000;
    res.cookie('jarvis_dashboard_auth', makeDashboardCookieValue(password), {
        httpOnly: true,
        sameSite: 'lax',
        secure: shouldUseSecureCookie(req),
        maxAge: maxAgeMs,
        path: '/'
    });
}

function clearDashboardAuthCookie(res) {
    res.clearCookie('jarvis_dashboard_auth', { path: '/' });
}

// ─── Middleware ───────────────────────────────────────────────────────────────

function dashboardLoginRateLimit(req, res, next) {
    const ip = getClientIp(req);
    const key = `dashboard:login:${ip}`;
    const now = Date.now();
    const windowMs = 5 * 60 * 1000;
    const max = 10;

    pruneDashboardLoginBuckets(now, windowMs);

    const bucket = dashboardLoginBuckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
        dashboardLoginBuckets.set(key, {
            count: 1,
            resetAt: now + windowMs,
            windowMs,
            lastSeenAt: now
        });
        return next();
    }

    bucket.count += 1;
    bucket.lastSeenAt = now;
    if (bucket.count > max) {
        return res.status(429).json({ ok: false, error: 'rate_limited' });
    }

    return next();
}

function dashboardAuthMiddleware(req, res, next) {
    if (isDashboardAuthed(req)) return next();

    const accept = String(req.headers?.accept || '');
    const expectsHtml = accept.includes('text/html');
    if (expectsHtml) {
        return res.redirect('/dashboard/login');
    }

    return res.status(401).json({ ok: false, error: 'unauthorized' });
}

// ─── Dashboard Access Router ─────────────────────────────────────────────────

function createDashboardAccessRouter(dashboardDistPath) {
    const router = express.Router();

    router.get('/login', (req, res) => {
        if (isDashboardAuthed(req)) {
            return res.redirect('/dashboard');
        }

        const password = getDashboardPassword();
        if (!password && isProductionLike()) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.status(200).send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Jarvis Dashboard</title>
  <style>
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Arial; background: #0b0f17; color: #e6edf3; display: flex; min-height: 100vh; align-items: center; justify-content: center; }
    .card { width: min(560px, 92vw); background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 20px; box-shadow: 0 12px 40px rgba(0,0,0,0.35); }
    h1 { margin: 0 0 10px; font-size: 20px; }
    p { margin: 0 0 12px; opacity: 0.9; font-size: 13px; line-height: 1.45; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
    .error { margin-top: 10px; color: #ff7b72; font-size: 13px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Jarvis Dashboard</h1>
    <p class="error">Dashboard access is disabled because no password is configured.</p>
    <p>Set <code>DASHBOARD_PASSWORD</code> (or <code>PASSWORD</code>) and restart the server.</p>
  </div>
</body>
</html>`);
        }

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Jarvis Dashboard Login</title>
  <style>
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Arial; background: #0b0f17; color: #e6edf3; display: flex; min-height: 100vh; align-items: center; justify-content: center; }
    .card { width: min(520px, 92vw); background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 20px; box-shadow: 0 12px 40px rgba(0,0,0,0.35); }
    h1 { margin: 0 0 6px; font-size: 20px; }
    p { margin: 0 0 14px; opacity: 0.9; font-size: 13px; }
    input { width: 100%; box-sizing: border-box; padding: 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.25); color: #e6edf3; outline: none; }
    input:focus { border-color: rgba(88,166,255,0.9); box-shadow: 0 0 0 3px rgba(88,166,255,0.15); }
    button { margin-top: 12px; width: 100%; padding: 12px; border-radius: 10px; border: 0; cursor: pointer; background: #1f6feb; color: white; font-weight: 600; }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    .error { margin-top: 10px; color: #ff7b72; min-height: 18px; font-size: 13px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Jarvis Dashboard</h1>
    <p>Enter the dashboard password to continue.</p>
    <form id="f">
      <input id="pw" type="password" autocomplete="current-password" placeholder="Password" required />
      <button id="btn" type="submit">Confirm</button>
      <div id="err" class="error"></div>
    </form>
  </div>
  <script>
    const f = document.getElementById('f');
    const pw = document.getElementById('pw');
    const btn = document.getElementById('btn');
    const err = document.getElementById('err');
    pw.focus();
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = '';
      btn.disabled = true;
      try {
        const res = await fetch('/dashboard/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pw.value })
        });
        if (res.ok) {
          window.location.href = '/dashboard';
          return;
        }
        err.textContent = 'Wrong password.';
      } catch (_) {
        err.textContent = 'Login failed.';
      } finally {
        btn.disabled = false;
      }
    });
  </script>
</body>
</html>`);
    });

    router.post('/login', dashboardLoginRateLimit, (req, res) => {
        const password = getDashboardPassword();
        if (!password) {
            if (isProductionLike()) {
                clearDashboardAuthCookie(res);
                return res.status(503).json({ ok: false, error: 'password_not_configured' });
            }

            setDashboardAuthCookie(req, res);
            return res.json({ ok: true });
        }

        const provided = typeof req.body?.password === 'string' ? req.body.password.trim() : '';
        const ok = timingSafeEqualHex(
            makeDashboardCookieValue(password),
            makeDashboardCookieValue(provided)
        );
        if (!ok) {
            clearDashboardAuthCookie(res);
            return res.status(401).json({ ok: false });
        }

        setDashboardAuthCookie(req, res);
        return res.json({ ok: true });
    });

    router.post('/logout', (req, res) => {
        clearDashboardAuthCookie(res);
        return res.json({ ok: true });
    });

    router.use(dashboardAuthMiddleware);
    router.use(express.static(dashboardDistPath));
    router.get('/*', (req, res) => {
        res.sendFile(path.join(dashboardDistPath, 'index.html'));
    });

    return router;
}

module.exports = {
    isProductionLike,
    isDashboardAuthed,
    dashboardAuthMiddleware,
    dashboardLoginRateLimit,
    createDashboardAccessRouter
};
