const fs = require('fs');
const path = require('path');

const EXPORTS_DIR = path.join(__dirname, '..', '..', 'data', 'mongo-exports');
const LOCAL_DIR = path.join(__dirname, '..', '..', 'data', 'local-db');

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function listExports() {
    if (!fs.existsSync(EXPORTS_DIR)) return [];
    return fs.readdirSync(EXPORTS_DIR)
        .filter((f) => f.endsWith('.json'))
        .map((f) => path.join(EXPORTS_DIR, f))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeCollection(name, docs) {
    ensureDir(LOCAL_DIR);
    const file = path.join(LOCAL_DIR, `${name}.json`);
    fs.writeFileSync(file, JSON.stringify({ updatedAt: new Date().toISOString(), docs }, null, 2));
    return file;
}

function readCollection(name) {
    const file = path.join(LOCAL_DIR, `${name}.json`);
    if (!fs.existsSync(file)) return [];
    const payload = readJson(file);
    return Array.isArray(payload?.docs) ? payload.docs : [];
}

function syncFromLatestExport() {
    const files = listExports();
    if (!files.length) return null;
    const latest = files[0];
    const payload = readJson(latest);
    const collections = Object.keys(payload || {});
    for (const coll of collections) {
        writeCollection(coll, payload[coll] || []);
    }
    return { latest, collections };
}

module.exports = {
    EXPORTS_DIR,
    LOCAL_DIR,
    listExports,
    syncFromLatestExport,
    readCollection,
    writeCollection
};
