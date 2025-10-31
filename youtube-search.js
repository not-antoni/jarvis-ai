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
        if (!this.youtube) {
            throw new Error('YouTube API not configured. Please set YOUTUBE_API_KEY environment variable.');
        }

        try {
            const searchResponse = await this.youtube.search.list({
                part: 'snippet',
                q: query,
                type: 'video',
                maxResults: 1,
                order: 'relevance',
                safeSearch: 'moderate'
            });

            if (searchResponse.data.items && searchResponse.data.items.length > 0) {
                const video = searchResponse.data.items[0];
                return {
                    title: video.snippet.title,
                    channel: video.snippet.channelTitle,
                    description: video.snippet.description.substring(0, 200) + '...',
                    url: `https://www.youtube.com/watch?v=${video.id.videoId}`,
                    thumbnail: video.snippet.thumbnails.medium?.url || video.snippet.thumbnails.default?.url,
                    publishedAt: new Date(video.snippet.publishedAt).toLocaleDateString()
                };
            } else {
                return null;
            }
        } catch (error) {
            console.error('YouTube API error:', error);
            throw new Error('Failed to search YouTube. Please try again later.');
        }
    }

    formatVideoResponse(videoData) {
        if (!videoData) {
            return "No relevant videos found, sir. Perhaps try a different search term?";
        }

        return videoData.url;
    }
}

module.exports = new YouTubeSearch();
