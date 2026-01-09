/**
 * Patches @distube/yt-dlp to ignore stderr output during JSON parsing.
 * 
 * Problem: The library concatenates stdout AND stderr before JSON.parse(),
 * so any warning (e.g., Python deprecation) breaks the bot.
 * 
 * Solution: Comment out the line that appends stderr to the output buffer.
 * 
 * Run manually: node scripts/patch-ytdlp.js
 * Or require() from index.js to run on startup.
 */

const fs = require('fs');
const path = require('path');

(function patchYtDlp() {
  const filePath = path.join(__dirname, '..', 'node_modules', '@distube', 'yt-dlp', 'dist', 'index.js');

  if (!fs.existsSync(filePath)) {
    console.log('[patch-ytdlp] @distube/yt-dlp not found, skipping.');
    return;
  }

  let content = fs.readFileSync(filePath, 'utf8');

  // Check if already patched
  if (content.includes('// output += chunk;')) {
    console.log('[patch-ytdlp] Already patched.');
    return;
  }

  // Replace the 2nd occurrence (stderr handler, not stdout)
  let count = 0;
  content = content.replace(/output \+= chunk;/g, (match) => {
    count++;
    return count === 2 ? '// output += chunk;' : match;
  });

  if (count < 2) {
    console.warn('[patch-ytdlp] Could not find expected pattern. Library may have changed.');
    return;
  }

  fs.writeFileSync(filePath, content);
  console.log('[patch-ytdlp] Successfully patched @distube/yt-dlp to ignore stderr warnings.');
})();

