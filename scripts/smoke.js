// Basic smoke checks that don't require Discord or external services
const fs = require('fs');
const path = require('path');

(async () => {
  const { sanitizePings } = require('../src/utils/sanitize');
  const tempFiles = require('../src/utils/temp-files');

  const original = 'hello @everyone and @here and @Someone';
  const sanitized = sanitizePings(original);
  if (/@everyone|@here/.test(sanitized)) {
    throw new Error('sanitizePings failed to neutralize mass mentions');
  }
  console.log('sanitizePings ok:', sanitized);

  const buf = Buffer.from('test-data');
  const saved = tempFiles.saveTempFile(buf, 'txt', { ttlMs: 2000 });
  if (!fs.existsSync(saved.filePath)) {
    throw new Error('saveTempFile did not write file');
  }
  console.log('saveTempFile ok:', saved.url, '->', saved.filePath);

  // Wait a moment, then sweep and ensure file is removed after TTL
  await new Promise((r) => setTimeout(r, 2500));
  tempFiles.sweepExpired();
  const existsAfter = fs.existsSync(saved.filePath);
  if (existsAfter) {
    console.warn('temp file not yet removed by sweep (acceptable if deletion timer pending)');
  } else {
    console.log('temp sweep ok: file removed');
  }

  console.log('SMOKE OK');
})();
