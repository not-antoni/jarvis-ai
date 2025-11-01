const youtubeSearch = require('../../youtube-search');

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

    try {
        const result = await youtubeSearch.searchVideo(query);
        if (!result) {
            return null;
        }

        return {
            title: result.title,
            url: result.url,
            thumbnail: result.thumbnail,
            duration: result.duration ?? null,
            channel: result.channel ?? null
        };
    } catch (error) {
        console.error('YouTube fetch error:', error);
        throw new Error('YouTube API error');
    }
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
