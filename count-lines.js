#!/usr/bin/env node
/**
 * count-js-lines.js
 * Recursively scan a directory for JS files, count lines (streamed),
 * collect bytes + mtime, group by directory, and print a report.
 *
 * Usage examples:
 *   node count-js-lines.js --dir .                     # scan current dir for .js
 *   node count-js-lines.js --dir src --ext .js,.jsx    # multiple extensions
 *   node count-js-lines.js --dir . --exclude node_modules --json
 *   node count-js-lines.js --dir . --sort mtime        # sort overall by mtime
 *
 * Node: works with Node 14+ (uses fs.promises and streams)
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');

const argv = require('process').argv.slice(2);

// Simple arg parser (no deps)
function parseArgs(args) {
  const out = {
    dir: process.cwd(),
    ext: ['.js'],
    exclude: ['node_modules', '.git'],
    json: false,
    sort: 'lines', // lines | mtime | name
    help: false,
    showHidden: false
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dir' || a === '-d') { out.dir = args[++i]; continue; }
    if (a === '--ext' || a === '-e') { out.ext = args[++i].split(',').map(x => x.trim()).filter(Boolean); continue; }
    if (a === '--exclude' || a === '-x') { out.exclude = args[++i].split(',').map(x => x.trim()).filter(Boolean); continue; }
    if (a === '--json' || a === '-j') { out.json = true; continue; }
    if (a === '--sort' || a === '-s') { out.sort = args[++i]; continue; }
    if (a === '--hidden') { out.showHidden = true; continue; }
    if (a === '--help' || a === '-h') { out.help = true; continue; }
    // fallback: unknown
    console.error(`Unknown arg: ${a}`);
    out.help = true;
  }
  return out;
}

const opts = parseArgs(argv);

if (opts.help) {
  console.log(`
count-js-lines.js -- recursive JS line counter

Options:
  --dir, -d       Directory to scan (default: current working dir)
  --ext, -e       Comma separated extensions (default: .js). e.g. --ext .js,.jsx
  --exclude, -x   Comma separated names to exclude (default: node_modules,.git)
  --json, -j      Output machine-friendly JSON (uses stdout)
  --sort, -s      Sort overall list: lines (default) | mtime | name
  --hidden        Include hidden files/dirs (dotfiles)
  --help, -h      Show this help
`);
  process.exit(0);
}

// Helpers
const isExcludedName = (name, excludeList) => {
  return excludeList.some(ex => ex && name === ex);
};
const extMatch = (name, exts) => {
  const e = path.extname(name).toLowerCase();
  return exts.map(x => x.toLowerCase()).includes(e);
};

// Count lines using streaming to avoid memory spikes
function countLinesStream(filePath) {
  return new Promise((resolve, reject) => {
    let lines = 0;
    const rs = fs.createReadStream(filePath, { encoding: 'utf8' });
    rs.on('error', err => reject(err));
    let lastChar = '';
    rs.on('data', chunk => {
      // Count number of \n in chunk
      for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] === '\n') lines++;
      }
      lastChar = chunk[chunk.length - 1];
    });
    rs.on('end', () => {
      // If file not ending with newline, still count last line
      // If file is not empty and last char isn't \n, add 1
      if (lastChar !== '\n' && lastChar !== undefined && lastChar !== '') lines++;
      resolve(lines);
    });
  });
}

// Concurrency limiter
function makeLimiter(maxConcurrent = Math.max(2, Math.floor(os.cpus().length / 2))) {
  let active = 0;
  const queue = [];
  function run(fn) {
    return new Promise((res, rej) => {
      const task = async () => {
        active++;
        try {
          const r = await fn();
          res(r);
        } catch (e) {
          rej(e);
        } finally {
          active--;
          if (queue.length) {
            const next = queue.shift();
            next();
          }
        }
      };
      if (active < maxConcurrent) task();
      else queue.push(task);
    });
  }
  return run;
}

const limiter = makeLimiter(8);

// Recursive traversal
async function walkDir(root, opts, result) {
  const { ext, exclude, showHidden } = opts;
  const stack = [ { dir: path.resolve(root), relative: '.' } ];

  while (stack.length) {
    const frame = stack.pop();
    const dirAbsolute = frame.dir;
    const relBase = frame.relative;

    let entries;
    try {
      entries = await fsp.readdir(dirAbsolute, { withFileTypes: true });
    } catch (err) {
      // ignore permission errors, continue
      console.error(`Warning: cannot read directory ${dirAbsolute}: ${err.message}`);
      continue;
    }

    for (const ent of entries) {
      const name = ent.name;
      if (!showHidden && name.startsWith('.')) continue;
      if (isExcludedName(name, exclude)) continue;
      const abs = path.join(dirAbsolute, name);
      const rel = path.join(relBase, name);

      try {
        if (ent.isSymbolicLink()) {
          // skip symlink to avoid cycles
          continue;
        }
        if (ent.isDirectory()) {
          // push for later
          stack.push({ dir: abs, relative: rel });
        } else if (ent.isFile()) {
          if (!extMatch(name, ext)) continue;
          // gather stats and schedule line count
          const stat = await fsp.stat(abs);
          result.files.push({
            path: abs,
            relative: rel,
            bytes: stat.size,
            mtimeMs: stat.mtimeMs,
            mtime: stat.mtime,
            lines: null // to fill
          });
        }
      } catch (err) {
        console.error(`Warning: trouble with ${abs}: ${err.message}`);
      }
    }
  }
}

// Main
(async function main() {
  const start = Date.now();
  const config = {
    dir: opts.dir,
    ext: opts.ext,
    exclude: opts.exclude,
    showHidden: opts.showHidden
  };

  const result = { files: [] };

  // 1) Walk and collect candidate files (stats included)
  await walkDir(config.dir, config, result);

  // 2) Count lines for each file (use limiter concurrency)
  await Promise.all(result.files.map(file =>
    limiter(async () => {
      try {
        const lines = await countLinesStream(file.path);
        file.lines = lines;
      } catch (err) {
        console.error(`Failed to count ${file.relative}: ${err.message}`);
        file.lines = 0;
      }
    })
  ));

  // 3) Group by directory
  const byDir = new Map(); // dir -> { files: [], totals... }
  for (const f of result.files) {
    const dir = path.dirname(f.relative);
    if (!byDir.has(dir)) byDir.set(dir, { files: [], totalLines: 0, totalBytes: 0 });
    const bucket = byDir.get(dir);
    bucket.files.push(f);
    bucket.totalLines += f.lines || 0;
    bucket.totalBytes += f.bytes || 0;
  }

  // 4) Sort files inside each directory (by lines desc)
  for (const [, bucket] of byDir) {
    bucket.files.sort((a,b) => (b.lines - a.lines) || (b.bytes - a.bytes) || a.relative.localeCompare(b.relative));
  }

  // 5) Prepare overall listing sorted per opts.sort
  const overall = [...result.files];
  if (opts.sort === 'lines') {
    overall.sort((a,b) => (b.lines - a.lines) || (b.bytes - a.bytes) || a.relative.localeCompare(b.relative));
  } else if (opts.sort === 'mtime') {
    overall.sort((a,b) => (b.mtimeMs - a.mtimeMs) || (b.lines - a.lines) || a.relative.localeCompare(b.relative));
  } else if (opts.sort === 'name') {
    overall.sort((a,b) => a.relative.localeCompare(b.relative));
  } else {
    // unknown sort fallback
    overall.sort((a,b) => (b.lines - a.lines));
  }

  const totalFiles = overall.length;
  const totalLines = overall.reduce((s,f) => s + (f.lines || 0), 0);
  const totalBytes = overall.reduce((s,f) => s + (f.bytes || 0), 0);

  // Output
  if (opts.json) {
    const out = {
      generatedAt: new Date().toISOString(),
      root: path.resolve(config.dir),
      totals: { files: totalFiles, lines: totalLines, bytes: totalBytes },
      directories: Array.from(byDir.entries())
        .map(([dir, bucket]) => ({
          directory: dir,
          totalLines: bucket.totalLines,
          totalBytes: bucket.totalBytes,
          files: bucket.files.map(f => ({
            relative: f.relative,
            bytes: f.bytes,
            lines: f.lines,
            mtime: new Date(f.mtimeMs).toISOString()
          }))
        })),
      overall: overall.map(f => ({
        relative: f.relative,
        bytes: f.bytes,
        lines: f.lines,
        mtime: new Date(f.mtimeMs).toISOString()
      }))
    };
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  // Human readable table
  console.log('');
  console.log('JS LINE COUNT REPORT'.padStart(28));
  console.log('='.repeat(80));
  console.log(`Root: ${path.resolve(config.dir)}`);
  console.log(`Files found: ${totalFiles}  |  Total lines: ${totalLines}  |  Total bytes: ${totalBytes}`);
  console.log(`Scan time: ${(Date.now()-start)/1000}s  |  Sorted by: ${opts.sort}`);
  console.log('='.repeat(80));

  // Print directories summary sorted by total lines desc
  const dirList = Array.from(byDir.entries()).map(([dir, bucket]) => ({ dir, ...bucket }));
  dirList.sort((a,b) => b.totalLines - a.totalLines || b.totalBytes - a.totalBytes);

  for (const d of dirList) {
    console.log(`\nDirectory: ${d.dir}  -  ${d.files.length} file(s)  |  lines: ${d.totalLines}  |  bytes: ${d.totalBytes}`);
    console.log('-'.repeat(80));
    // print each file as: lines | bytes | mtime | relative path
    for (const f of d.files) {
      const mtime = new Date(f.mtimeMs).toISOString().replace('T',' ').replace('Z','');
      console.log(`${String(f.lines).padStart(7)} lines  | ${String(f.bytes).padStart(8)} bytes  | ${mtime}  | ${f.relative}`);
    }
  }

  // Overall top list
  console.log('\n' + '='.repeat(80));
  console.log('ALL FILES (overall) - biggest → smaller by chosen sort');
  console.log('-'.repeat(80));
  for (const f of overall) {
    const mtime = new Date(f.mtimeMs).toISOString().replace('T',' ').replace('Z','');
    console.log(`${String(f.lines).padStart(7)} lines  | ${String(f.bytes).padStart(8)} bytes  | ${mtime}  | ${f.relative}`);
  }

  console.log('\nDone.');
})();
