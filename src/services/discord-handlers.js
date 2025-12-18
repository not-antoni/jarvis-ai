const fs = require('fs');
const path = require('path');

const partsDir = path.join(__dirname, 'discord-handlers-parts');
const partFiles = fs
    .readdirSync(partsDir)
    .filter(name => name.endsWith('.js'))
    .sort();

// Validate handler parts exist (minimum 1, warn if count changes unexpectedly)
const EXPECTED_PARTS_COUNT = 7;
if (partFiles.length === 0) {
    throw new Error('No discord handler parts found in discord-handlers-parts/');
}
if (partFiles.length !== EXPECTED_PARTS_COUNT) {
    console.warn(
        `[DiscordHandlers] Part count changed: expected ${EXPECTED_PARTS_COUNT}, found ${partFiles.length}. ` +
        'Update EXPECTED_PARTS_COUNT if this is intentional.'
    );
}

const combinedCode = partFiles
    .map(name => fs.readFileSync(path.join(partsDir, name), 'utf8'))
    .join('\n');

module._compile(combinedCode, __filename);
