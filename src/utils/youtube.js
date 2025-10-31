const youtubeSearch = require('../../youtube-search');

async function getVideo(query) {
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

module.exports = {
    getVideo
};

