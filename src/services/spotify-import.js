/**
 * Spotify Playlist Import
 * 
 * Parses Spotify playlist URLs and converts tracks to YouTube searches
 * for playback via DisTube.
 */

const fetch = require('node-fetch');

// Spotify API credentials (optional - works without for public playlists)
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

let accessToken = null;
let tokenExpiry = 0;

/**
 * Get Spotify access token (Client Credentials flow)
 */
async function getAccessToken() {
    // Return cached token if still valid
    if (accessToken && Date.now() < tokenExpiry) {
        return accessToken;
    }

    if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
        console.log('[SpotifyImport] No credentials configured, using scraping fallback');
        return null;
    }

    try {
        const response = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')
            },
            body: 'grant_type=client_credentials'
        });

        if (!response.ok) {
            throw new Error(`Token request failed: ${response.status}`);
        }

        const data = await response.json();
        accessToken = data.access_token;
        tokenExpiry = Date.now() + (data.expires_in - 60) * 1000; // Refresh 1 min early
        return accessToken;
    } catch (error) {
        console.error('[SpotifyImport] Failed to get access token:', error.message);
        return null;
    }
}

/**
 * Parse Spotify URL to extract type and ID
 * @param {string} url 
 * @returns {{ type: string, id: string } | null}
 */
function parseSpotifyUrl(url) {
    // Patterns:
    // https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M
    // https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh
    // https://open.spotify.com/album/6JKUk9yWNWHAnL7sTuCjGg
    // spotify:playlist:37i9dQZF1DXcBWIGoYBM5M

    const patterns = [
        /open\.spotify\.com\/(playlist|track|album)\/([a-zA-Z0-9]+)/,
        /spotify:(playlist|track|album):([a-zA-Z0-9]+)/,
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) {
            return { type: match[1], id: match[2] };
        }
    }

    return null;
}

/**
 * Fetch playlist tracks from Spotify API
 * @param {string} playlistId 
 * @returns {Promise<Array<{ title: string, artist: string, duration: number }>>}
 */
async function fetchPlaylistTracks(playlistId) {
    const token = await getAccessToken();

    if (!token) {
        // Fallback: try to scrape public playlist page
        return await scrapePlaylistFallback(playlistId);
    }

    const tracks = [];
    let nextUrl = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`;

    while (nextUrl) {
        const response = await fetch(nextUrl, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            throw new Error(`Spotify API error: ${response.status}`);
        }

        const data = await response.json();

        for (const item of data.items || []) {
            const track = item.track;
            if (track && track.name) {
                tracks.push({
                    title: track.name,
                    artist: track.artists?.map(a => a.name).join(', ') || 'Unknown',
                    duration: Math.floor(track.duration_ms / 1000),
                    spotifyUrl: track.external_urls?.spotify
                });
            }
        }

        nextUrl = data.next;

        // Limit to 200 tracks to prevent abuse
        if (tracks.length >= 200) {
            console.log('[SpotifyImport] Limiting to 200 tracks');
            break;
        }
    }

    return tracks;
}

/**
 * Fallback: Scrape public playlist (no API key required)
 */
async function scrapePlaylistFallback(playlistId) {
    try {
        const response = await fetch(`https://open.spotify.com/playlist/${playlistId}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const html = await response.text();

        // Extract JSON-LD or meta data
        const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
        if (jsonLdMatch) {
            const data = JSON.parse(jsonLdMatch[1]);
            if (data.track) {
                return data.track.map(t => ({
                    title: t.name,
                    artist: t.byArtist?.name || 'Unknown',
                    duration: 0
                }));
            }
        }

        console.log('[SpotifyImport] Fallback scraping failed, no track data found');
        return [];
    } catch (error) {
        console.error('[SpotifyImport] Scrape fallback failed:', error.message);
        return [];
    }
}

/**
 * Fetch single track info
 */
async function fetchTrackInfo(trackId) {
    const token = await getAccessToken();
    if (!token) return null;

    const response = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) return null;

    const track = await response.json();
    return {
        title: track.name,
        artist: track.artists?.map(a => a.name).join(', ') || 'Unknown',
        duration: Math.floor(track.duration_ms / 1000)
    };
}

/**
 * Fetch album tracks
 */
async function fetchAlbumTracks(albumId) {
    const token = await getAccessToken();
    if (!token) return [];

    const tracks = [];
    let nextUrl = `https://api.spotify.com/v1/albums/${albumId}/tracks?limit=50`;

    // First get album info for artist
    const albumResponse = await fetch(`https://api.spotify.com/v1/albums/${albumId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const albumData = await albumResponse.json();
    const albumArtist = albumData.artists?.[0]?.name || 'Unknown';

    while (nextUrl) {
        const response = await fetch(nextUrl, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) break;

        const data = await response.json();

        for (const track of data.items || []) {
            tracks.push({
                title: track.name,
                artist: track.artists?.map(a => a.name).join(', ') || albumArtist,
                duration: Math.floor(track.duration_ms / 1000)
            });
        }

        nextUrl = data.next;
    }

    return tracks;
}

/**
 * Convert track info to YouTube search query
 * @param {{ title: string, artist: string }} track 
 * @returns {string}
 */
function trackToSearchQuery(track) {
    // Remove common suffixes that hurt search results
    let title = track.title
        .replace(/\s*\(feat\..*?\)/gi, '')
        .replace(/\s*\(with.*?\)/gi, '')
        .replace(/\s*-\s*Remastered.*$/gi, '')
        .replace(/\s*-\s*Radio Edit.*$/gi, '')
        .trim();

    return `${track.artist} - ${title}`;
}

/**
 * Import Spotify content (playlist, track, or album)
 * @param {string} url - Spotify URL
 * @returns {Promise<{ type: string, tracks: string[], name?: string }>}
 */
async function importFromSpotify(url) {
    const parsed = parseSpotifyUrl(url);
    if (!parsed) {
        throw new Error('Invalid Spotify URL');
    }

    let tracks = [];
    let name = 'Spotify Import';

    switch (parsed.type) {
        case 'playlist':
            tracks = await fetchPlaylistTracks(parsed.id);
            name = `Spotify Playlist (${tracks.length} tracks)`;
            break;

        case 'track':
            const trackInfo = await fetchTrackInfo(parsed.id);
            if (trackInfo) {
                tracks = [trackInfo];
                name = `${trackInfo.artist} - ${trackInfo.title}`;
            }
            break;

        case 'album':
            tracks = await fetchAlbumTracks(parsed.id);
            name = `Spotify Album (${tracks.length} tracks)`;
            break;
    }

    return {
        type: parsed.type,
        name,
        tracks: tracks.map(trackToSearchQuery),
        rawTracks: tracks
    };
}

/**
 * Check if a URL is a Spotify URL
 */
function isSpotifyUrl(url) {
    return parseSpotifyUrl(url) !== null;
}

module.exports = {
    parseSpotifyUrl,
    importFromSpotify,
    isSpotifyUrl,
    trackToSearchQuery,
    fetchPlaylistTracks,
    fetchTrackInfo,
    fetchAlbumTracks,
};
