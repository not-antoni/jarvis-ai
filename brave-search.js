/**
 * Brave Search API integration for web search
 */

const fetch = require('node-fetch');
const { toUnicode } = require('punycode/');

const ZERO_WIDTH_CHAR_PATTERN = /[\u200B-\u200D\u200E-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;

const CONFUSABLE_CHAR_MAP = new Map([
    ['а', 'a'], ['ɑ', 'a'], ['ᴀ', 'a'], ['ⓐ', 'a'], ['ａ', 'a'],
    ['е', 'e'], ['ҽ', 'e'], ['ℯ', 'e'], ['ᴇ', 'e'], ['ⓔ', 'e'], ['ｅ', 'e'],
    ['о', 'o'], ['ο', 'o'], ['ᴏ', 'o'], ['ⓞ', 'o'], ['ｏ', 'o'],
    ['р', 'p'], ['ρ', 'p'], ['ᴘ', 'p'], ['ᴩ', 'p'], ['ⓟ', 'p'], ['ｐ', 'p'],
    ['ʀ', 'r'], ['ⓡ', 'r'], ['ｒ', 'r'],
    ['ɴ', 'n'], ['ᴎ', 'n'], ['Ⓝ', 'n'], ['ｎ', 'n'],
    ['ѕ', 's'], ['ꜱ', 's'], ['ⓢ', 's'], ['ｓ', 's'], ['ʂ', 's'],
    ['х', 'x'], ['ҳ', 'x'], ['ẋ', 'x'], ['ⓧ', 'x'], ['ｘ', 'x'],
    ['с', 'c'], ['ᴄ', 'c'], ['ⓒ', 'c'], ['ｃ', 'c'],
    ['ʏ', 'y'], ['у', 'y'], ['Ⓨ', 'y'], ['ｙ', 'y'],
    ['ᴠ', 'v'], ['ν', 'v'], ['ⓥ', 'v'], ['ｖ', 'v'],
    ['ｍ', 'm'], ['ᴍ', 'm'], ['ⓜ', 'm'],
    ['ｕ', 'u'], ['ᴜ', 'u'], ['ⓤ', 'u'], ['ʋ', 'u'],
    ['ｔ', 't'], ['ᴛ', 't'], ['ⓣ', 't'],
    ['ｈ', 'h'], ['һ', 'h'], ['ⓗ', 'h'], ['ʜ', 'h'],
    ['ｌ', 'l'], ['ⅼ', 'l'], ['ӏ', 'l'], ['ⓛ', 'l'], ['ℓ', 'l'],
    ['ｄ', 'd'], ['ԁ', 'd'], ['ᴅ', 'd'], ['ⓓ', 'd'],
    ['ｇ', 'g'], ['ɡ', 'g'], ['ⓖ', 'g'],
    ['ｑ', 'q'], ['զ', 'q'], ['ⓠ', 'q'],
    ['ｋ', 'k'], ['ᴋ', 'k'], ['ⓚ', 'k'],
    ['ｂ', 'b'], ['Ь', 'b'], ['ь', 'b'], ['ⓑ', 'b'],
    ['ｆ', 'f'], ['ғ', 'f'], ['ⓕ', 'f'],
    ['ｚ', 'z'], ['ᴢ', 'z'], ['ⓩ', 'z'],
    ['ｉ', 'i'], ['ᴉ', 'i'], ['ⓘ', 'i'], ['ı', 'i'], ['і', 'i']
]);

function replaceConfusableCharacters(text) {
    if (!text) return text;

    let result = '';
    for (const char of text) {
        result += CONFUSABLE_CHAR_MAP.get(char) || char;
    }

    return result;
}

function decodePunycodeDomain(value) {
    try {
        return toUnicode(value);
    } catch (error) {
        return value;
    }
}

const EXPLICIT_PATTERNS = [
    /\bporn(?:hub)?\b/i,
    /\bpornography\b/i,
    /\bxvideos?\b/i,
    /\bxnxx\b/i,
    /\bnsfw\b/i,
    /\bxxx\b/i,
    /\bnude\b/i,
    /\bnaked\b/i,
    /\bnudity\b/i,
    /\bhentai\b/i,
    /\bmilf\b/i,
    /\bcumshot\b/i,
    /(?:^|\W)cum(?!\s+laude)\b/i,
    /\bblowjob\b/i,
    /\bhandjob\b/i,
    /\bjerk\s*off\b/i,
    /\bstrip(?:per|tease|club)\b/i,
    /\bescort\s+(?:service|services|agency|agencies|site|sites|girl|girls|boy|boys|ads?|directory)\b/i,
    /\bpussy\b/i,
    /\bcock\b/i,
    /\bboobs?\b/i,
    /\bboobies\b/i,
    /\bbusty\b/i,
    /\btits?\b/i,
    /\btitties\b/i,
    /\bclit\b/i,
    /\berotic\b/i,
    /\bsex\s*tape\b/i,
    /\bsex\s*chat\b/i,
    /\bsex\s*cam\b/i,
    /\badult\s*(?:site|video|movie|content|chat|cams|dating)\b/i,
    /\bonly\s*fans?\b/i,
    /\bjustforfans\b/i,
    /\bfansly\b/i,
    /\bcam(?:girl|boy|sex|show|site|s|model|web)\b/i,
    /\bdeepthroat\b/i,
    /\bfetish\b/i,
    /\bbdsm\b/i,
    /\bkink(?:y)?\b/i,
    /\borgasm\b/i,
    /\bincest\b/i,
    /\bpegging\b/i,
    /\bbukkake\b/i,
    /\bgangbang\b/i,
    /\bgloryhole\b/i,
    /\bsquirting\b/i,
    /\banal\b/i,
    /\bfuck(?:ing|er|ers|ed|s)?\b/i,
    /\bsex\.com\b/i,
    /\bdick\s+(?:pic|pics|photo|photos|video|videos|porn|movie|movies|size|rating)\b/i,
    /\bbig\s+dick\b/i,
    /\bboobjob\b/i,
    /\bhorny\b/i,
    /\bnipple\b/i,
    /\bpenis\b/i,
    /\bvagina\b/i,
    /\bmasturbat\w*/i,
    /\bpleasure\s*(?:toy|toys)\b/i,
    /\brule\s*34\b/i,
    /\bfutanari\b/i,
    /\byiff\b/i,
    /\byaoi\b/i,
    /\byuri\b/i,
    /\becchi\b/i,
    /\blewd\b/i,
    /\bdoujin(?:shi)?\b/i,
    /\border\s*brother\b/i,
    /\bstep(?:mom|mum|mother|sis|sister|bro|brother)\s*(?:porn|sex|xxx|nude|video|pics?)\b/i,
    /\bteen\s*(?:porn|sex|xxx|nude|video|pics?)\b/i,
    /\bcollege\s*(?:porn|sex|xxx|nude|video|pics?)\b/i,
    /\bstud\s*porn\b/i,
    /\bwebcam\s*(?:sex|strip|show|shows|model|models)\b/i,
    /\binceste?\b/i,
    /\bnympho\b/i,
    /\bcall\s*girl\b/i,
    /\bdominatrix\b/i,
    /\bpeep\s*show\b/i,
    /\bsensual\s*(?:massage|video|pics?)\b/i,
    /\blive\s*sex\b/i,
    /\bsex\s*stories\b/i,
    /\bsmut\b/i,
    /\buncensored\b/i,
    /\bsoftcore\b/i,
    /\bhardcore\b/i,
    /\bforbidden\s*videos?\b/i
];

const EXPLICIT_KEYWORDS = [
    'porn',
    'pornhub',
    'pornography',
    'porno',
    'pornd',
    'pr0n',
    'pron',
    'p0rn',
    'xxx',
    'xxxl',
    'xxvids',
    'nsfw',
    'hentai',
    'rule34',
    'r34',
    'futa',
    'futanari',
    'yaoi',
    'yuri',
    'oppai',
    'ecchi',
    'lewd',
    'smut',
    'doujin',
    'doujinshi',
    'milf',
    'gilf',
    'pawg',
    'bbw',
    'onlyfans',
    'onlyfanz',
    'onlyfan',
    'fansly',
    'justforfans',
    'coomer',
    'camgirl',
    'camgirls',
    'camgirlz',
    'camboy',
    'camguys',
    'camsex',
    'camshow',
    'camshows',
    'cammodel',
    'cammodels',
    'webcamsex',
    'camtocam',
    'cam2cam',
    'camrecord',
    'adultvideo',
    'adultvideos',
    'adultmovie',
    'adultmovies',
    'adultcontent',
    'adultchat',
    'adultdating',
    'adultsite',
    'sexvideo',
    'sexvideos',
    'sexmovie',
    'sexmovies',
    'sexfilm',
    'sexfilms',
    'sexstory',
    'sexstories',
    'sextape',
    'sextapes',
    'sexchat',
    'sexchats',
    'sexgirl',
    'sexgirls',
    'sexboy',
    'sexboys',
    'sexwork',
    'sexworker',
    'sexworkers',
    'fetish',
    'fetishes',
    'bdsm',
    'kinky',
    'kink',
    'kinkster',
    'kinksters',
    'deepthroat',
    'orgasm',
    'orgasms',
    'pegging',
    'bukkake',
    'gangbang',
    'gloryhole',
    'squirting',
    'squirt',
    'cumshot',
    'cumshots',
    'cumload',
    'jerkoff',
    'jerking',
    'masturbate',
    'masturbation',
    'handjob',
    'handjobs',
    'blowjob',
    'blowjobs',
    'fingering',
    'cunnilingus',
    'stripclub',
    'stripclubs',
    'stripper',
    'strippers',
    'striptease',
    'stripchat',
    'chaturbate',
    'livejasmin',
    'bongacams',
    'myfreecams',
    'spankwire',
    'xhamster',
    'redtube',
    'youporn',
    'spankbang',
    'escortservice',
    'escortservices',
    'escort',
    'escorts',
    'escortdirectory',
    'hooker',
    'hookers',
    'callgirl',
    'callgirls',
    'callboy',
    'callboys',
    'sugarbaby',
    'sugardaddy',
    'sugarmommy',
    'pussy',
    'pussies',
    'cock',
    'cocks',
    'dick',
    'dicks',
    'bigdick',
    'dickpic',
    'dickpics',
    'dickvideo',
    'dickvideos',
    'penis',
    'penises',
    'vagina',
    'vajayjay',
    'boobs',
    'boob',
    'boobies',
    'busty',
    'tits',
    'tit',
    'titties',
    'nipple',
    'nipples',
    'areola',
    'clit',
    'clitoris',
    'erotic',
    'erotica',
    'anal',
    'buttplug',
    'buttplugs',
    'strapon',
    'strapons',
    'dominatrix',
    'submissive',
    'domination',
    'femdom',
    'maledom',
    'peepshow',
    'voyeur',
    'voyeurism',
    'orgy',
    'threesome',
    'foursome',
    'swinger',
    'swingers',
    'swinging',
    'kamasutra',
    'shemale',
    'ladyboy',
    'amateurnudes',
    'amateurgirls',
    'nudography',
    'nudify',
    'naked',
    'nudes',
    'nude',
    'nuder',
    'nudity',
    'topless',
    'toppless',
    'lingerie',
    'boudoir',
    'seduce',
    'seduction',
    'sultry',
    'wetshirt',
    'wetlook',
    'onlyfansleak',
    'leakednudes',
    'feetpics',
    'feetfinder',
    'footfetish',
    'nsfwvideo',
    'nsfwart',
    'uncensored',
    'forbiddenvideos',
    'forbiddenvideo',
    'pleasuretoy',
    'pleasuretoys',
    'bdsmtest',
    'fetlife'
];

const SAFE_CONTEXT_PATTERNS = [
    /\bsex(?:ual)?\s*(?:education|ed|health|reproduction|orientation|harassment|assault|violence|wellness|misconduct|discrimination|awareness|abuse|trafficking|exploitation|prevention)\b/gi,
    /\bsexual\s*(?:assault|harassment|violence|abuse|misconduct|orientation|health|education|reproduction|exploitation|trafficking|awareness|wellness)\b/gi,
    /\bsex\s*(?:offender|offenders|crime|crimes|law|laws|trafficking|education|ed|health|awareness|prevention|therapy|counseling)\b/gi,
    /\bpornograph(?:y|ic)\s*(?:addiction|awareness|education|law|laws|reform|recovery|support|research|study|studies|statistics|prevention|analysis)\b/gi,
    /\badult\s*(?:education|learning|swim|swimming|tickets|supervision|protective\s+services|program|programs|care|day\s*care|support|literacy|class|classes|coloring|colouring|fiction|novel|novels|book|books|choir|league|sports?|lessons?|beverage|beverages)\b/gi,
    /\byoung\s+adult\b/gi,
    /\bteen\s*(?:pregnancy|mental\s*health|support|counseling|counselling|education)\b/gi,
    /\bsex\s*(?:determin(?:ation|ing)|chromosome|differences)\b/gi,
    /\bsexual\s*(?:dimorphism|selection|reproduction|healthcare)\b/gi,
    /\bexplicit\s*(?:lyrics|content\s*filter|consent|bias|instruction|warning|warnings)\b/gi,
    /\bconsent\s*education\b/gi,
    /\bhuman\s*sexuality\s*(?:course|class|education|study|studies)\b/gi
];

const EXPLICIT_TLDS = ['.xxx', '.porn', '.adult', '.sex', '.sexy', '.cam', '.hot'];

const BANNED_DOMAINS = [
    'pornhub.com',
    'xvideos.com',
    'xnxx.com',
    'redtube.com',
    'youporn.com',
    'brazzers.com',
    'onlyfans.com',
    'fansly.com',
    'sex.com',
    'adultfriendfinder.com',
    'stripchat.com',
    'chaturbate.com',
    'livejasmin.com',
    'bongacams.com',
    'myfreecams.com',
    'cam4.com',
    'camwhores.tv',
    'spankbang.com',
    'porn.com',
    'pornmd.com',
    'porntube.com',
    'pornoxo.com',
    'xhamster.com',
    'youjizz.com',
    'tnaflix.com',
    'beeg.com',
    'thothub.to',
    'nudogram.com',
    'slutload.com',
    'hqporner.com',
    'sunporno.com',
    'drtuber.com',
    'motherless.com',
    'efukt.com',
    'rule34.xxx',
    'rule34video.com',
    'rule34hentai.net',
    'rule34.world',
    'rule34porn.net',
    'hentai-foundry.com',
    'gelbooru.com',
    'danbooru.donmai.us',
    'sankakucomplex.com',
    'nhentai.net',
    'pururin.to',
    'fapello.com',
    'fapello.su',
    'sexstories.com',
    'literotica.com',
    'adult-fanfiction.org',
    'gonewildaudio.com',
    'cammodels.com',
    'camsoda.com',
    'cams.com',
    'camster.com',
    'camsextv.com',
    'livecam.com',
    'nudexxx.live',
    'nudostar.com',
    'nsfw.xxx',
    'f95zone.to',
    'eros.com',
    'erosguide.com',
    'adultsearch.com',
    'adultlook.com',
    'switter.at',
    'escortalligator.com',
    'escortbabylon.net',
    'escortdirectory.com',
    'escortads.xxx',
    'fetlife.com',
    'bdsmtest.org',
    'feetfinder.com',
    'camgirlvideos.org',
    'pornpics.com',
    'pornpics.de',
    'pornpics.xxx',
    'sexygirls.com'
];

const EXPLICIT_URL_PATTERNS = [
    /reddit\.com\/r\/[^\s/?#]*(?:nsfw|gonewild|rule34|nsfw_gifs|realgirls|pussy|porn|onoff|gwcouples|gwcumsluts)/i,
    /tumblr\.com\/tagged\/(?:nsfw|porn|lewd|sex|hentai)/i,
    /patreon\.com\/.*(?:lewd|nsfw|onlyfans)/i,
    /twitter\.com\/.*(?:onlyfans|porn|nsfw|lewd)/i,
    /x\.com\/.*(?:onlyfans|porn|nsfw|lewd)/i,
    /fansly\.com/i,
    /coomer\.party/i,
    /leaked\w*\.site/i,
    /spankbang\.com/i,
    /onlyfans\.com/i
];

const EXPLICIT_QUERY_MESSAGE = 'I must decline that request, sir. My safety filters forbid it.';
const EXPLICIT_RESULTS_MESSAGE = 'I located only explicit results, sir, so I withheld them.';

class BraveSearch {
    constructor() {
        this.apiKey = process.env.BRAVE_API_KEY;
        this.endpoint = 'https://api.search.brave.com/res/v1/web/search';

        if (!this.apiKey) {
            console.warn('Brave Search API key not found. Brave web search will be disabled.');
        }
    }

    stripZeroWidth(text = '') {
        return typeof text === 'string'
            ? text.replace(ZERO_WIDTH_CHAR_PATTERN, '')
            : '';
    }

    sanitizeUserQuery(query) {
        if (typeof query !== 'string') {
            return '';
        }

        const stripped = this.stripZeroWidth(query)
            .replace(/[\u0000-\u001F\u007F]/g, ' ');

        const collapsed = stripped
            .replace(/[\s\u00A0]+/g, ' ')
            .trim();

        if (!collapsed) {
            return '';
        }

        const unquoted = collapsed
            .replace(/^["'“”‘’`´]+/, '')
            .replace(/["'“”‘’`´]+$/, '')
            .trim();

        return unquoted;
    }

    prepareQueryForApi(query) {
        return this.sanitizeUserQuery(query);
    }

    extractSearchInvocation(content) {
        if (typeof content !== 'string' || !content.length) {
            return { triggered: false, query: null };
        }

        const pattern = /(?:^|\b)jarvis(?:\s+|[,;:]+\s*)search\b/gi;
        let match;
        let triggered = false;
        let extractedQuery = null;

        while ((match = pattern.exec(content)) !== null) {
            triggered = true;

            const tail = content.slice(match.index + match[0].length);
            if (!tail) {
                continue;
            }

            const trimmedTail = tail.replace(/^[\s"“”'‘’`´.,:;|\-]+/, '');
            const sanitized = this.sanitizeUserQuery(trimmedTail);

            if (sanitized.length === 0) {
                continue;
            }

            extractedQuery = sanitized;
            break;
        }

        return { triggered, query: extractedQuery };
    }

    truncate(text, maxLength) {
        if (!text) return '';
        return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
    }

    normaliseForExplicitCheck(text) {
        if (!text) {
            return [];
        }

        const lowered = text.toLowerCase().replace(ZERO_WIDTH_CHAR_PATTERN, '');
        const confusableStripped = replaceConfusableCharacters(lowered);
        const ascii = confusableStripped.normalize('NFD').replace(/\p{Diacritic}/gu, '');
        const leet = ascii
            .replace(/0/g, 'o')
            .replace(/1/g, 'i')
            .replace(/3/g, 'e')
            .replace(/4/g, 'a')
            .replace(/5/g, 's')
            .replace(/7/g, 't')
            .replace(/8/g, 'b');

        const collapsed = leet.replace(/[^a-z0-9]+/g, '');
        const softCollapsed = leet.replace(/[^a-z0-9]+/g, ' ');

        return Array.from(new Set([
            lowered,
            confusableStripped,
            ascii,
            leet,
            collapsed,
            softCollapsed
        ].filter(Boolean)));
    }

    containsExplicitLanguage(text, options = {}) {
        if (!text) {
            return false;
        }

        const allowEducationalContext = Boolean(options.allowEducationalContext);
        const variants = this.normaliseForExplicitCheck(text);

        const variantsToCheck = (allowEducationalContext
            ? variants.map((variant) =>
                SAFE_CONTEXT_PATTERNS.reduce((cleaned, pattern) => {
                    pattern.lastIndex = 0;
                    return cleaned.replace(pattern, ' ');
                }, variant)
            )
            : variants
        ).map((variant) => variant.replace(/\s+/g, ' ').trim());

        if (variantsToCheck.some((variant) => EXPLICIT_PATTERNS.some((pattern) => pattern.test(variant)))) {
            return true;
        }

        return variantsToCheck.some((variant) =>
            EXPLICIT_KEYWORDS.some((keyword) => variant.includes(keyword))
        );
    }

    getHostname(url) {
        try {
            const { hostname } = new URL(url);
            return hostname;
        } catch (err) {
            return '';
        }
    }

    isExplicitDomain(hostname) {
        if (!hostname) return false;

        const normalizedHost = hostname.toLowerCase();
        const strippedHost = normalizedHost.startsWith('www.') ? normalizedHost.slice(4) : normalizedHost;
        const unicodeHost = decodePunycodeDomain(strippedHost);
        const normalizedStripped = replaceConfusableCharacters(unicodeHost)
            .normalize('NFD')
            .replace(/\p{Diacritic}/gu, '');

        if (BANNED_DOMAINS.some((domain) => strippedHost === domain || strippedHost.endsWith(`.${domain}`))) {
            return true;
        }

        if (EXPLICIT_TLDS.some((tld) => strippedHost.endsWith(tld))) {
            return true;
        }

        if (this.containsExplicitLanguage(normalizedStripped, { allowEducationalContext: false })) {
            return true;
        }

        return false;
    }

    isExplicitQuery(query) {
        const sanitized = this.sanitizeUserQuery(query);
        if (!sanitized) return false;

        const lowered = sanitized.toLowerCase();

        if (this.containsExplicitLanguage(lowered, { allowEducationalContext: true })) {
            return true;
        }

        if (EXPLICIT_URL_PATTERNS.some((pattern) => {
            pattern.lastIndex = 0;
            return pattern.test(lowered);
        })) {
            return true;
        }

        return BANNED_DOMAINS.some((domain) => lowered.includes(domain));
    }

    resultIsExplicit(result) {
        if (!result || typeof result !== 'object') {
            return true;
        }

        if (result.is_family_friendly === false || result.family_friendly === false || result.familyFriendly === false) {
            return true;
        }

        if (result.block && typeof result.block.reason === 'string' && /adult|explicit/i.test(result.block.reason)) {
            return true;
        }

        const url = result.url || '';
        const title = result.title || '';
        const description = result.description || '';
        const displayUrl = result?.meta_url?.displayUrl || '';
        const profileName = result?.profile?.name || '';

        if (EXPLICIT_URL_PATTERNS.some((pattern) => {
            pattern.lastIndex = 0;
            if (pattern.test(url)) {
                return true;
            }
            pattern.lastIndex = 0;
            return pattern.test(displayUrl);
        })) {
            return true;
        }

        if (this.containsExplicitLanguage([title, description, displayUrl, url, profileName].join(' '), { allowEducationalContext: true })) {
            return true;
        }

        if (this.isExplicitDomain(this.getHostname(url))) {
            return true;
        }

        return false;
    }

    normaliseResult(result) {
        const displayUrl = result?.meta_url?.displayUrl || (() => {
            try {
                return new URL(result.url).hostname;
            } catch (err) {
                return result.url;
            }
        })();

        return {
            title: result.title || result.url,
            url: result.url,
            description: result.description || '',
            displayUrl,
            thumbnail: result?.thumbnail?.src || null,
            profileName: result?.profile?.name || null,
            age: result?.page_age || null,
            language: result.language || null
        };
    }

    buildPrimaryDescription(result) {
        const snippetParts = [];

        if (result.description) {
            snippetParts.push(this.truncate(result.description, 350));
        }

        const metaBits = [];
        if (result.displayUrl) metaBits.push(result.displayUrl);
        if (result.profileName) metaBits.push(result.profileName);
        if (result.age) metaBits.push(result.age);
        if (metaBits.length > 0) {
            snippetParts.push(metaBits.join(' • '));
        }

        return snippetParts.join('\n');
    }

    async searchWeb(query) {
        if (!this.apiKey) {
            throw new Error('Brave Search API not configured. Please set BRAVE_API_KEY environment variable.');
        }

        const preparedQuery = this.prepareQueryForApi(query);

        if (!preparedQuery) {
            const error = new Error('Please provide a web search query, sir.');
            error.isSafeSearchBlock = true;
            throw error;
        }

        if (this.isExplicitQuery(preparedQuery)) {
            const error = new Error(EXPLICIT_QUERY_MESSAGE);
            error.isSafeSearchBlock = true;
            throw error;
        }

        const url = new URL(this.endpoint);
        url.searchParams.set('q', preparedQuery);
        url.searchParams.set('count', '5');
        url.searchParams.set('safesearch', 'strict');

        const response = await fetch(url.toString(), {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'JarvisDiscordBot/1.0',
                'X-Subscription-Token': this.apiKey
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Brave Search request failed: ${response.status} ${errorText}`);
        }

        const data = await response.json();
        const results = Array.isArray(data?.web?.results) ? data.web.results : [];

        let filteredOut = 0;

        const safeResults = results
            .filter((result) => {
                const hasUrl = result && typeof result.url === 'string';
                if (!hasUrl) return false;

                const explicit = this.resultIsExplicit(result);
                if (explicit) filteredOut += 1;

                return !explicit;
            })
            .slice(0, 5)
            .map((result) => this.normaliseResult(result));

        if (safeResults.length === 0 && filteredOut > 0) {
            const error = new Error(EXPLICIT_RESULTS_MESSAGE);
            error.isSafeSearchBlock = true;
            throw error;
        }

        return safeResults;
    }

    formatSearchResponse(query, results) {
        if (!results || results.length === 0) {
            return {
                content: `No web results found for "${query}", sir. Perhaps refine the query?`
            };
        }

        const [topResult, ...secondaryResults] = results;

        const embed = {
            color: 0xF97316,
            title: topResult.title,
            url: topResult.url,
            description: this.buildPrimaryDescription(topResult) || topResult.url,
            author: {
                name: `Results for "${this.truncate(query, 70)}"`
            },
            fields: secondaryResults.slice(0, 2).map((result, index) => ({
                name: `${index + 2}. ${result.title}`,
                value: this.truncate([
                    result.description,
                    result.displayUrl || result.url
                ].filter(Boolean).join('\n') || result.url, 1024)
            })),
            footer: {
                text: 'Powered by Brave Search'
            },
            timestamp: new Date().toISOString()
        };

        if (topResult.thumbnail) {
            embed.thumbnail = { url: topResult.thumbnail };
        }

        const buttons = results.slice(0, Math.min(results.length, 5)).map((result, index) => ({
            type: 2,
            style: 5, // Link button
            label: `${index + 1}. ${this.truncate(result.title, 70)}`,
            url: result.url
        }));

        return {
            embeds: [embed],
            components: buttons.length
                ? [{ type: 1, components: buttons }]
                : []
        };
    }

    getExplicitQueryMessage() {
        return EXPLICIT_QUERY_MESSAGE;
    }
}

module.exports = new BraveSearch();
