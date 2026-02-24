/**
 * YouTube API integration for video search
 */

const { google } = require('googleapis');

class YouTubeSearch {
    constructor() {
        this.youtube = null;
        this.apiKey = process.env.YT_API_KEY || process.env.YOUTUBE_API_KEY;

        if (this.apiKey) {
            this.youtube = google.youtube({
                version: 'v3',
                auth: this.apiKey
            });
        } else {
            console.warn('YouTube API key not found. YouTube search will be disabled.');
        }
    }

    async searchVideo(query) {
        const batch = await this.searchVideos(query, 1);
        return batch.items[0] || null;
    }

    async searchVideos(query, maxResults = 24) {
        if (!this.youtube) {
            throw new Error(
                'YouTube API not configured. Please set YOUTUBE_API_KEY environment variable.'
            );
        }

        try {
            const limit = Math.max(1, Math.min(50, Number(maxResults) || 24));
            const searchResponse = await this.youtube.search.list({
                part: 'snippet',
                q: query,
                type: 'video',
                maxResults: limit,
                order: 'relevance',
                safeSearch: 'moderate'
            });

            const items = Array.isArray(searchResponse.data.items)
                ? searchResponse.data.items
                : [];

            return {
                totalResults: Number(searchResponse.data.pageInfo?.totalResults) || items.length,
                items: items.map((video) => {
                    const rawDescription = video?.snippet?.description || '';
                    return {
                        videoId: video?.id?.videoId || null,
                        title: video?.snippet?.title || 'Untitled Video',
                        channel: video?.snippet?.channelTitle || 'Unknown channel',
                        description: rawDescription.length > 200 ? `${rawDescription.substring(0, 200)}...` : rawDescription,
                        url: video?.id?.videoId ? `https://www.youtube.com/watch?v=${video.id.videoId}` : null,
                        thumbnail:
                            video?.snippet?.thumbnails?.maxres?.url ||
                            video?.snippet?.thumbnails?.high?.url ||
                            video?.snippet?.thumbnails?.medium?.url ||
                            video?.snippet?.thumbnails?.default?.url ||
                            null,
                        publishedAt: video?.snippet?.publishedAt
                            ? new Date(video.snippet.publishedAt).toLocaleDateString()
                            : null
                    };
                }).filter((item) => item.url)
            };
            
        } catch (error) {
            console.error('YouTube API error:', error);
            throw new Error('Failed to search YouTube. Please try again later.');
        }
    }

    formatVideoResponse(videoData) {
        if (!videoData) {
            return 'No relevant videos found, sir. Perhaps try a different search term?';
        }

        return videoData.url;
    }

    async getVideoById(videoId) {
        if (!this.youtube) {
            throw new Error(
                'YouTube API not configured. Please set YOUTUBE_API_KEY environment variable.'
            );
        }

        try {
            const response = await this.youtube.videos.list({
                part: 'snippet,contentDetails',
                id: videoId,
                maxResults: 1
            });

            const item = response.data.items?.[0];
            if (!item) {
                return null;
            }

            return {
                title: item.snippet.title,
                channel: item.snippet.channelTitle,
                description: item.snippet.description?.substring(0, 200) ?? null,
                url: `https://www.youtube.com/watch?v=${videoId}`,
                thumbnail:
                    item.snippet.thumbnails?.medium?.url ||
                    item.snippet.thumbnails?.default?.url ||
                    null,
                duration: parseISODuration(item.contentDetails?.duration)
            };
        } catch (error) {
            console.error('YouTube video lookup error:', error);
            throw new Error('Failed to fetch YouTube video details. Please try again later.');
        }
    }
}

function parseISODuration(isoValue) {
    if (!isoValue) {
        return null;
    }

    const match = isoValue.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) {
        return isoValue;
    }

    const hours = parseInt(match[1] || '0', 10);
    const minutes = parseInt(match[2] || '0', 10);
    const seconds = parseInt(match[3] || '0', 10);

    const parts = [];
    if (hours) {parts.push(hours);}
    parts.push(hours ? String(minutes).padStart(2, '0') : minutes);
    parts.push(String(seconds).padStart(2, '0'));

    return parts.join(':');
}

module.exports = new YouTubeSearch();
