---
description: Fixes the yt-dlp JSON parsing error caused by stderr warnings (e.g., Python deprecation messages)
---

# Fix yt-dlp JSON Parsing Error

This workflow patches `@distube/yt-dlp` to prevent stderr output (warnings, deprecation notices) from corrupting the JSON response, which causes `SyntaxError: Unexpected token`.

## The Problem

`@distube/yt-dlp` concatenates both `stdout` AND `stderr` before parsing as JSON. Any warning on stderr (like Python's "DeprecationWarning") breaks parsing.

## The Fix

Comment out the line that appends stderr to the output buffer.

---

## Windows (PowerShell)

// turbo
1. Run this patch command:
```powershell
$path = "node_modules\@distube\yt-dlp\dist\index.js"
(Get-Content $path -Raw) -replace 'process2\.stderr\?\.\on\("data", \(chunk\) => \{\s+output \+= chunk;', 'process2.stderr?.on("data", (chunk) => { // output += chunk;' | Set-Content $path -NoNewline
```

## Linux/macOS (Bash)

// turbo
1. Run this patch command:
```bash
sed -i 's/output += chunk;$/\/\/ output += chunk;/' node_modules/@distube/yt-dlp/dist/index.js
```

---

## Automated via postinstall (Recommended)

Add this to your `package.json` to auto-apply the patch after every `npm install`:

```json
"scripts": {
  "postinstall": "node scripts/patch-ytdlp.js"
}
```

Then create `scripts/patch-ytdlp.js`:

```javascript
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'node_modules', '@distube', 'yt-dlp', 'dist', 'index.js');

if (fs.existsSync(filePath)) {
  let content = fs.readFileSync(filePath, 'utf8');
  const target = 'output += chunk;';
  const replacement = '// output += chunk;';
  
  // Only patch stderr handler (2nd occurrence), not stdout
  let count = 0;
  content = content.replace(/output \+= chunk;/g, (match) => {
    count++;
    return count === 2 ? replacement : match;
  });
  
  fs.writeFileSync(filePath, content);
  console.log('[postinstall] Patched @distube/yt-dlp to ignore stderr warnings.');
} else {
  console.log('[postinstall] @distube/yt-dlp not found, skipping patch.');
}
```

This ensures the fix persists across `npm install`, `npm ci`, and fresh clones.
