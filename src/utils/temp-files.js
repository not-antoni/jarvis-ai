const fs = require('fs');
const path = require('path');

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
const TEMP_DIR = path.join(__dirname, '..', '..', 'data', 'temp');

function ensureDir() {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

function guessExtFromName(name) {
    const ext = path.extname(name || '').toLowerCase().replace(/^\./, '');
    return ext || 'bin';
}

function randomId() {
    const a = Math.floor(10000 + Math.random() * 90000); // 5 digits
    const b = Math.floor(1000 + Math.random() * 9000); // 4 digits
    return `${a}${b}`; // looks like 9-digit numeric id
}

function getPublicBaseUrl() {
    const envBase = process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || '';
    if (envBase) return envBase.replace(/\/$/, '');
    const port = process.env.PORT || 3000;
    return `http://localhost:${port}`;
}

function buildPath(id, ext) {
    return `/${id}.${ext}`;
}

function saveTempFile(buffer, filenameOrExt, { ttlMs = FOUR_HOURS_MS } = {}) {
    ensureDir();
    const ext = filenameOrExt.includes('.') ? guessExtFromName(filenameOrExt) : (filenameOrExt || 'bin');
    const id = randomId();
    const diskName = `${id}.${ext}`;
    const filePath = path.join(TEMP_DIR, diskName);
    fs.writeFileSync(filePath, buffer);
    const expiresAt = Date.now() + Math.max(60_000, ttlMs);
    const meta = { id, ext, createdAt: Date.now(), expiresAt, size: buffer.length };
    fs.writeFileSync(`${filePath}.json`, JSON.stringify(meta));

    const mountPath = buildPath(id, ext);
    const url = `${getPublicBaseUrl()}${mountPath}`;

    const delay = expiresAt - Date.now();
    setTimeout(() => {
        try { fs.unlinkSync(filePath); } catch (_) {}
        try { fs.unlinkSync(`${filePath}.json`); } catch (_) {}
    }, Math.max(1000, delay)).unref();

    return { id, ext, path: mountPath, url, filePath, expiresAt };
}

function sweepExpired() {
    ensureDir();
    const names = fs.readdirSync(TEMP_DIR);
    const now = Date.now();
    for (const name of names) {
        if (!name.endsWith('.json')) continue;
        try {
            const meta = JSON.parse(fs.readFileSync(path.join(TEMP_DIR, name), 'utf8'));
            if (!meta || !meta.expiresAt || meta.expiresAt <= now) {
                const base = name.replace(/\.json$/, '');
                try { fs.unlinkSync(path.join(TEMP_DIR, base)); } catch (_) {}
                try { fs.unlinkSync(path.join(TEMP_DIR, name)); } catch (_) {}
            }
        } catch (_) {
            // cleanup invalid meta
            try { fs.unlinkSync(path.join(TEMP_DIR, name)); } catch (_) {}
        }
    }
}

module.exports = {
    TEMP_DIR,
    saveTempFile,
    sweepExpired,
    getPublicBaseUrl
};
