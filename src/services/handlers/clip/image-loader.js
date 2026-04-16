'use strict';

const { loadImage } = require('canvas');
const sharp = require('sharp');
const { fetchBuffer } = require('../../../utils/net-guard');

function envInt(name, fallback, min) { return Math.max(min, Number(process.env[name] || '') || fallback); }
const MAX_REMOTE_IMAGE_BYTES = envInt('REMOTE_IMAGE_MAX_BYTES', 10 * 1024 * 1024, 1024 * 1024);

async function loadImageSafe(url) {
    const fetched = await fetchBuffer(url, { method: 'GET' }, { maxBytes: MAX_REMOTE_IMAGE_BYTES });
    if (fetched.tooLarge) {
        throw new Error('Image too large');
    }
    const contentType = String(fetched.contentType || '').toLowerCase();
    if (contentType && !contentType.startsWith('image/')) {
        throw new Error('Invalid image content type');
    }
    return await loadImage(fetched.buffer);
}

async function loadStaticImage(url) {
    try {
        const fetched = await fetchBuffer(url, { method: 'GET' }, { maxBytes: MAX_REMOTE_IMAGE_BYTES });
        if (fetched.tooLarge) {throw new Error('Image too large');}
        const input = fetched.buffer;
        const pngBuffer = await sharp(input).ensureAlpha().extractFrame(0).png().toBuffer();
        return await loadImage(pngBuffer);
    } catch (error) {
        console.warn('Failed to load static GIF frame, falling back to direct load:', error);
        return await loadImageSafe(url);
    }
}

async function resolveTenorStatic(url) {
    try {
        const oembedUrl = `https://tenor.com/oembed?url=${encodeURIComponent(url)}`;
        const res = await fetch(oembedUrl, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!res.ok) {throw new Error(`Tenor oEmbed HTTP ${res.status}`);}
        const data = await res.json();
        if (data && data.thumbnail_url) {return data.thumbnail_url;}
        if (data && data.url) {return data.url;}
    } catch (error) {
        console.warn('Failed to resolve Tenor static image via oEmbed:', error);
    }
    try {
        const pageRes = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!pageRes.ok) {throw new Error(`Tenor page HTTP ${pageRes.status}`);}
        const html = await pageRes.text();
        let metaMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
        if (!metaMatch) {metaMatch = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);}
        if (metaMatch && metaMatch[1]) {return metaMatch[1];}
    } catch (err) {
        console.warn('Failed to parse Tenor page for image:', err);
    }
    return null;
}

module.exports = { loadImageSafe, loadStaticImage, resolveTenorStatic, MAX_REMOTE_IMAGE_BYTES };
