const youtubeSearch = require('../services/youtube-search');
const { searchYouTube, getVideoInfo } = require('./playDl');

const YOUTUBE_URL_REGEX = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/))|(?:youtu\.be\/))([\w-]{11})(?:[?&][^\s]*)?$/i;

async function getVideo(query) {
    const directId = extractVideoId(query);

    if (directId) {
        try {
            const directResult = await youtubeSearch.getVideoById(directId);
            if (directResult) {
                return directResult;
            }
        } catch (error) {
            console.warn('Direct YouTube lookup failed, falling back to search:', error?.message || error);
        }

        return {
            title: `YouTube Video (${directId})`,
            url: `https://www.youtube.com/watch?v=${directId}`,
            thumbnail: null,
            duration: null,
            channel: null
        };
    }

    // Try primary search first
    try {
        const result = await youtubeSearch.searchVideo(query);
        if (result) {
            return {
                title: result.title,
                url: result.url,
                thumbnail: result.thumbnail,
                duration: result.duration ?? null,
                channel: result.channel ?? null
            };
        }
    } catch (error) {
        console.warn('Primary YouTube search failed, trying play-dl:', error?.message);
    }

    // Fallback to play-dl search
    try {
        const results = await searchYouTube(query, 1);
        if (results && results.length > 0) {
            const result = results[0];
            return {
                title: result.title,
                url: result.url,
                thumbnail: result.thumbnail,
                duration: result.duration ?? null,
                channel: result.channel ?? null
            };
        }
    } catch (error) {
        console.error('play-dl search also failed:', error?.message);
    }

    return null;
}

function extractVideoId(input) {
    if (typeof input !== 'string') {
        return null;
    }

    const trimmed = input.trim();
    const directMatch = trimmed.match(YOUTUBE_URL_REGEX);
    if (directMatch) {
        return directMatch[1];
    }

    if (/^[\w-]{11}$/.test(trimmed)) {
        return trimmed;
    }

    return null;
}

module.exports = {
    getVideo,
    extractVideoId
};
