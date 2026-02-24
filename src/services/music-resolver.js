'use strict';

const youtubeSearch = require('./youtube-search');
const searchCache = require('./search-cache');
const soundcloudApi = require('./soundcloud-api');
const soundcloudCache = require('./soundcloud-cache');
const { extractVideoId } = require('../utils/youtube');

function isUrl(value) {
    try {
        const parsed = new URL(String(value || '').trim());
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

function isYouTubeUrl(url) {
    return /(?:youtube\.com|youtu\.be)/i.test(String(url || ''));
}

function isSoundCloudUrl(url) {
    return /soundcloud\.com/i.test(String(url || ''));
}

function isSpotifyUrl(url) {
    return /spotify\.com/i.test(String(url || ''));
}

function cleanYouTubeUrl(url) {
    let normalized = String(url || '').trim();
    normalized = normalized.replace(/[&?]list=[^&]+/g, '');
    normalized = normalized.replace(/[&?]index=\d+/g, '');
    return normalized.replace(/[&?]$/, '');
}

function inferSourceFromUrl(url) {
    if (isYouTubeUrl(url)) {return 'youtube';}
    if (isSoundCloudUrl(url)) {return 'soundcloud';}
    return 'unknown';
}

function buildTrack({ source, title, url, duration = null, thumbnail = null, uploader = null }) {
    return {
        source,
        title,
        url,
        duration,
        thumbnail,
        uploader
    };
}

function createResolverError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}

async function resolveYouTubeUrlTrack(url) {
    const cleaned = cleanYouTubeUrl(url);
    const videoId = extractVideoId(cleaned);
    if (videoId) {
        try {
            const info = await youtubeSearch.getVideoById(videoId);
            if (info?.url) {
                return buildTrack({
                    source: 'youtube',
                    title: info.title || `YouTube Video (${videoId})`,
                    url: info.url,
                    duration: info.duration || null,
                    thumbnail: info.thumbnail || null,
                    uploader: info.channel || null
                });
            }
        } catch (_e) {
            // If API lookup fails, keep URL playback path available.
        }
    }

    return buildTrack({
        source: 'youtube',
        title: 'YouTube Track',
        url: cleaned
    });
}

async function resolveSoundCloudUrlTrack(url) {
    const cached = soundcloudCache.get(url);
    if (cached) {
        return buildTrack({
            source: 'soundcloud',
            title: cached.title || 'SoundCloud Track',
            url,
            duration: cached.duration || null,
            thumbnail: cached.thumbnail || null,
            uploader: cached.uploader || null
        });
    }

    try {
        const resolved = await soundcloudApi.resolveTrack(url);
        if (resolved?.url) {
            soundcloudCache.set(resolved.url, resolved);
            return buildTrack({
                source: 'soundcloud',
                title: resolved.title || 'SoundCloud Track',
                url: resolved.url,
                duration: resolved.duration || null,
                thumbnail: resolved.thumbnail || null,
                uploader: resolved.uploader || null
            });
        }
    } catch (error) {
        console.warn('[MusicResolver] SoundCloud resolve failed, trying direct URL:', error.message);
    }

    // Allow direct yt-dlp playback even if metadata resolve fails.
    return buildTrack({
        source: 'soundcloud',
        title: 'SoundCloud Track',
        url
    });
}

async function resolveQueryTrack(query) {
    const cached = searchCache.get(query);
    if (cached?.url) {
        const source = cached.source || inferSourceFromUrl(cached.url);
        if (source === 'youtube' || source === 'soundcloud') {
            return {
                track: buildTrack({
                    source,
                    title: cached.title || (source === 'soundcloud' ? 'SoundCloud Track' : 'YouTube Track'),
                    url: cached.url
                }),
                fromCache: true,
                fallbackToSoundCloud: false
            };
        }
    }

    let youtubeError = null;
    try {
        const result = await youtubeSearch.searchVideo(query);
        if (result?.url) {
            const track = buildTrack({
                source: 'youtube',
                title: result.title || 'YouTube Track',
                url: cleanYouTubeUrl(result.url),
                thumbnail: result.thumbnail || null,
                uploader: result.channel || null
            });
            searchCache.set(query, {
                title: track.title,
                url: track.url,
                source: 'youtube'
            });
            return { track, fromCache: false, fallbackToSoundCloud: false };
        }
    } catch (error) {
        youtubeError = error;
    }

    try {
        const soundCloudResults = await soundcloudApi.searchTracks(query, 1);
        const match = soundCloudResults[0];
        if (match?.url) {
            const track = buildTrack({
                source: 'soundcloud',
                title: match.title || 'SoundCloud Track',
                url: match.url,
                duration: match.duration || null,
                thumbnail: match.thumbnail || null,
                uploader: match.uploader || null
            });
            soundcloudCache.set(track.url, track);
            searchCache.set(query, {
                title: track.title,
                url: track.url,
                source: 'soundcloud'
            });
            return { track, fromCache: false, fallbackToSoundCloud: true };
        }
    } catch (soundCloudError) {
        console.warn('[MusicResolver] SoundCloud query fallback failed:', soundCloudError.message);
    }

    if (youtubeError) {
        throw createResolverError(
            '❌ YouTube search failed and no SoundCloud fallback result was found.',
            'NO_RESULT'
        );
    }

    throw createResolverError('❌ No results found for that query.', 'NO_RESULT');
}

async function resolveTrackInput(input) {
    const raw = String(input || '').trim();
    if (!raw) {
        throw createResolverError('Provide a song name or URL, sir.', 'MISSING_INPUT');
    }

    if (isUrl(raw)) {
        if (isSpotifyUrl(raw)) {
            throw createResolverError(
                '❌ Spotify links are no longer supported. Use YouTube or SoundCloud links, sir.',
                'UNSUPPORTED_SPOTIFY'
            );
        }
        if (isYouTubeUrl(raw)) {
            return {
                track: await resolveYouTubeUrlTrack(raw),
                fromCache: false,
                fallbackToSoundCloud: false
            };
        }
        if (isSoundCloudUrl(raw)) {
            return {
                track: await resolveSoundCloudUrlTrack(raw),
                fromCache: false,
                fallbackToSoundCloud: false
            };
        }

        throw createResolverError(
            '❌ Unsupported URL source. Only YouTube and SoundCloud links are supported.',
            'UNSUPPORTED_URL'
        );
    }

    return resolveQueryTrack(raw);
}

module.exports = {
    resolveTrackInput,
    isUrl,
    isYouTubeUrl,
    isSoundCloudUrl,
    isSpotifyUrl,
    cleanYouTubeUrl
};
