'use strict';

/**
 * Shared HTML utilities for consistent page rendering
 */

// Google Analytics snippet - inject after <head> in all pages
const GOOGLE_ANALYTICS = `
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-7P8W1MN168"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-7P8W1MN168');
</script>`;

/**
 * Inject Google Analytics into an HTML string
 * Inserts the GA script right after the <head> tag
 */
function injectGoogleAnalytics(html) {
    // Insert after <head> or <head ...>
    return html.replace(/(<head[^>]*>)/i, `$1\n${GOOGLE_ANALYTICS}`);
}

/**
 * Common meta tags for SEO
 */
function getCommonMeta(options = {}) {
    const {
        title = 'Jarvis - Discord AI Bot',
        description = 'The Discord AI with actual personality',
        url = 'https://jorvis.org',
        image = 'https://jorvis.org/jarvis.webp'
    } = options;

    return `
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="${description}">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${description}">
    <meta property="og:image" content="${image}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${url}">
    <meta name="theme-color" content="#00d4ff">
    <meta name="twitter:card" content="summary_large_image">
    <link rel="icon" type="image/webp" href="/jarvis.webp">`;
}

module.exports = {
    GOOGLE_ANALYTICS,
    injectGoogleAnalytics,
    getCommonMeta
};
