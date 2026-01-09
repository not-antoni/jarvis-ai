/**
 * Patches @distube/yt-dlp to ignore stderr output during JSON parsing.
 * 
 * Problem: The library concatenates stdout AND stderr before JSON.parse(),
 * so any warning (e.g., Python deprecation) breaks the bot.
 * 
 * Solution: Comment out the line that appends stderr to the output buffer.
 * 
 * Run manually: node scripts/patch-ytdlp.js
 * Or add to package.json: "postinstall": "node scripts/patch-ytdlp.js"
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'node_modules', '@distube', 'yt-dlp', 'dist', 'index.js');

if (!fs.existsSync(filePath)) {
  console.log('[patch-ytdlp] @distube/yt-dlp not found, skipping.');
  process.exit(0);
}

let content = fs.readFileSync(filePath, 'utf8');

// Check if already patched
if (content.includes('// output += chunk;')) {
  console.log('[patch-ytdlp] Already patched.');
  process.exit(0);
}

// Replace the 2nd occurrence (stderr handler, not stdout)
let count = 0;
content = content.replace(/output \+= chunk;/g, (match) => {
  count++;
  return count === 2 ? '// output += chunk;' : match;
});

if (count < 2) {
  console.warn('[patch-ytdlp] Could not find expected pattern. Library may have changed.');
  process.exit(1);
}

fs.writeFileSync(filePath, content);
console.log('[patch-ytdlp] Successfully patched @distube/yt-dlp to ignore stderr warnings.');
