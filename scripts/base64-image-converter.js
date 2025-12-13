#!/usr/bin/env node
/**
 * Base64 Image Converter for Rap Battle Comebacks
 *
 * Usage:
 *   node scripts/base64-image-converter.js add <image_path> [name]     - Add image to base64 storage
 *   node scripts/base64-image-converter.js remove <name>               - Remove image by name
 *   node scripts/base64-image-converter.js list                        - List all stored images
 *   node scripts/base64-image-converter.js export <name> <output_path> - Export base64 back to file
 *   node scripts/base64-image-converter.js size                        - Show total storage size
 */

const fs = require('fs');
const path = require('path');

const STORAGE_PATH = path.join(__dirname, '..', 'rapping_comebacks', 'images_base64.json');
const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1MB max per image
const MAX_TOTAL_SIZE = 10 * 1024 * 1024; // 10MB max total

const SUPPORTED_FORMATS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

function loadStorage() {
    try {
        return JSON.parse(fs.readFileSync(STORAGE_PATH, 'utf8'));
    } catch {
        return { images: [] };
    }
}

function saveStorage(data) {
    fs.writeFileSync(STORAGE_PATH, JSON.stringify(data, null, 2));
}

function getBase64Size(base64String) {
    // Base64 is ~4/3 the size of the original
    return Math.ceil((base64String.length * 3) / 4);
}

function getTotalSize(storage) {
    return storage.images.reduce((total, img) => total + getBase64Size(img.data), 0);
}

function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function addImage(imagePath, customName) {
    const fullPath = path.resolve(imagePath);

    if (!fs.existsSync(fullPath)) {
        console.error(`❌ File not found: ${fullPath}`);
        process.exit(1);
    }

    const ext = path.extname(fullPath).toLowerCase();
    if (!SUPPORTED_FORMATS.includes(ext)) {
        console.error(`❌ Unsupported format: ${ext}. Supported: ${SUPPORTED_FORMATS.join(', ')}`);
        process.exit(1);
    }

    const stats = fs.statSync(fullPath);
    if (stats.size > MAX_FILE_SIZE) {
        console.error(
            `❌ File too large: ${formatBytes(stats.size)}. Max: ${formatBytes(MAX_FILE_SIZE)}`
        );
        process.exit(1);
    }

    const storage = loadStorage();
    const totalSize = getTotalSize(storage);

    if (totalSize + stats.size > MAX_TOTAL_SIZE) {
        console.error(
            `❌ Would exceed total storage limit. Current: ${formatBytes(totalSize)}, Max: ${formatBytes(MAX_TOTAL_SIZE)}`
        );
        process.exit(1);
    }

    const name = customName || path.basename(fullPath, ext);

    // Check for duplicate names
    if (storage.images.some(img => img.name === name)) {
        console.error(`❌ Image with name "${name}" already exists. Use a different name.`);
        process.exit(1);
    }

    const imageBuffer = fs.readFileSync(fullPath);
    const base64Data = imageBuffer.toString('base64');
    const mimeType =
        ext === '.png'
            ? 'image/png'
            : ext === '.webp'
              ? 'image/webp'
              : ext === '.gif'
                ? 'image/gif'
                : 'image/jpeg';

    storage.images.push({
        name,
        mimeType,
        data: base64Data,
        addedAt: new Date().toISOString()
    });

    saveStorage(storage);
    console.log(`✅ Added "${name}" (${formatBytes(stats.size)})`);
    console.log(
        `📊 Total storage: ${formatBytes(getTotalSize(storage))} / ${formatBytes(MAX_TOTAL_SIZE)}`
    );
}

function removeImage(name) {
    const storage = loadStorage();
    const index = storage.images.findIndex(img => img.name === name);

    if (index === -1) {
        console.error(`❌ Image "${name}" not found`);
        process.exit(1);
    }

    const removed = storage.images.splice(index, 1)[0];
    saveStorage(storage);
    console.log(`✅ Removed "${name}" (freed ${formatBytes(getBase64Size(removed.data))})`);
}

function listImages() {
    const storage = loadStorage();

    if (storage.images.length === 0) {
        console.log('📭 No images stored');
        return;
    }

    console.log(`📷 Stored images (${storage.images.length}):\n`);
    storage.images.forEach((img, i) => {
        const size = formatBytes(getBase64Size(img.data));
        console.log(`  ${i + 1}. ${img.name} (${img.mimeType}, ${size})`);
    });
    console.log(
        `\n📊 Total: ${formatBytes(getTotalSize(storage))} / ${formatBytes(MAX_TOTAL_SIZE)}`
    );
}

function exportImage(name, outputPath) {
    const storage = loadStorage();
    const img = storage.images.find(i => i.name === name);

    if (!img) {
        console.error(`❌ Image "${name}" not found`);
        process.exit(1);
    }

    const buffer = Buffer.from(img.data, 'base64');
    fs.writeFileSync(outputPath, buffer);
    console.log(`✅ Exported "${name}" to ${outputPath}`);
}

function showSize() {
    const storage = loadStorage();
    const totalSize = getTotalSize(storage);
    const percentage = ((totalSize / MAX_TOTAL_SIZE) * 100).toFixed(1);

    console.log(
        `📊 Storage usage: ${formatBytes(totalSize)} / ${formatBytes(MAX_TOTAL_SIZE)} (${percentage}%)`
    );
    console.log(`📷 Images stored: ${storage.images.length}`);
}

// CLI
const [, , command, ...args] = process.argv;

switch (command) {
    case 'add':
        if (!args[0]) {
            console.error('Usage: node base64-image-converter.js add <image_path> [name]');
            process.exit(1);
        }
        addImage(args[0], args[1]);
        break;
    case 'remove':
        if (!args[0]) {
            console.error('Usage: node base64-image-converter.js remove <name>');
            process.exit(1);
        }
        removeImage(args[0]);
        break;
    case 'list':
        listImages();
        break;
    case 'export':
        if (!args[0] || !args[1]) {
            console.error('Usage: node base64-image-converter.js export <name> <output_path>');
            process.exit(1);
        }
        exportImage(args[0], args[1]);
        break;
    case 'size':
        showSize();
        break;
    default:
        console.log(`
Base64 Image Converter for Rap Battle Comebacks

Commands:
  add <image_path> [name]     Add image to base64 storage
  remove <name>               Remove image by name
  list                        List all stored images
  export <name> <output_path> Export base64 back to file
  size                        Show total storage size

Limits:
  Max per image: ${formatBytes(MAX_FILE_SIZE)}
  Max total: ${formatBytes(MAX_TOTAL_SIZE)}
  Formats: ${SUPPORTED_FORMATS.join(', ')}
`);
}
