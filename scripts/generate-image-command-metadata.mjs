import { promises as fs } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const repoRoot = path.resolve('.');
const esmRoot = path.join(repoRoot, 'external/esmBot');
const commandsDir = path.join(esmRoot, 'commands', 'image-editing');

process.chdir(esmRoot);

async function collectFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(full);
    }
  }
  return files;
}

const files = await collectFiles(commandsDir);

const metadata = [];

for (const file of files) {
  const moduleUrl = pathToFileURL(file).href;
  const imported = await import(moduleUrl);
  const CommandClass = imported.default;
  if (!CommandClass) continue;
  if (typeof CommandClass.init === 'function') {
    CommandClass.init();
  }
  metadata.push({
    file: path.relative(commandsDir, file).replace(/\\/g, '/'),
    className: CommandClass.name,
    description: CommandClass.description || null,
    aliases: CommandClass.aliases || [],
    command: CommandClass.command || null,
    requiresImage: CommandClass.requiresImage !== false,
    requiresParam: CommandClass.requiresParam === true,
    requiredParam: CommandClass.requiredParam || null,
    requiredParamType: CommandClass.requiredParamType || null,
    requiresAnim: CommandClass.requiresAnim === true,
    alwaysGIF: CommandClass.alwaysGIF === true,
    textOptional: CommandClass.textOptional === true,
    flags: CommandClass.flags || []
  });
}

await fs.writeFile(
  path.join(repoRoot, 'image-command-metadata.json'),
  JSON.stringify(metadata, null, 2)
);
