const fs = require('fs');
const path = require('path');

const partsDir = path.join(__dirname, 'discord-handlers-parts');
const partFiles = fs
    .readdirSync(partsDir)
    .filter((name) => name.endsWith('.js'))
    .sort();

if (partFiles.length !== 5) {
    throw new Error(`Expected 5 discord handler parts, found ${partFiles.length}`);
}

const combinedCode = partFiles
    .map((name) => fs.readFileSync(path.join(partsDir, name), 'utf8'))
    .join('\n');

module._compile(combinedCode, __filename);
