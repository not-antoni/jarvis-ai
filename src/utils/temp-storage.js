const fs = require('fs');
const path = require('path');

const TEMP_DIR = path.resolve(__dirname, '../../tmp/outputs');
const EXPIRATION_MS = 10 * 60 * 1000; // 10 minutes

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

function generateFileName(extension) {
    const id = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const safeExt = extension.replace(/[^a-z0-9]/gi, '') || 'png';
    return `${id}.${safeExt}`;
}

async function saveBuffer(buffer, extension) {
    const fileName = generateFileName(extension);
    const targetPath = path.join(TEMP_DIR, fileName);
    await fs.promises.writeFile(targetPath, buffer);
    return fileName;
}

async function cleanupExpiredFiles() {
    const now = Date.now();
    const entries = await fs.promises.readdir(TEMP_DIR).catch(() => []);
    await Promise.all(
        entries.map(async (entry) => {
            const fullPath = path.join(TEMP_DIR, entry);
            try {
                const stat = await fs.promises.stat(fullPath);
                if (now - stat.mtimeMs > EXPIRATION_MS) {
                    await fs.promises.unlink(fullPath);
                }
            } catch {
                // ignore
            }
        })
    );
}

setInterval(() => {
    cleanupExpiredFiles().catch(() => {});
}, EXPIRATION_MS).unref();

module.exports = {
    saveBuffer,
    TEMP_DIR
};
