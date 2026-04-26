'use strict';

// Invisible / format / bidi / tag unicode commonly used for prompt-poisoning,
// stego payloads, or copy-paste exfiltration. Stripped from every AI output and
// from anything we feed into memory or system prompts (#273).
// Combining-character ranges like FE00-FE0F (variation selectors) are
// intentional — we WANT to scrub them; lint heuristic doesn't apply here.
// eslint-disable-next-line no-misleading-character-class
const INVISIBLE_UNICODE_RE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF9-\uFFFB]/g;
// Astral-plane invisibles: tag chars (E0000-E007F) + variation selectors supplement (E0100-E01EF)
// eslint-disable-next-line no-misleading-character-class
const INVISIBLE_UNICODE_ASTRAL_RE = /[\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu;

function stripInvisibleUnicode(text) {
    if (!text || typeof text !== 'string') {return text;}
    return text.replace(INVISIBLE_UNICODE_RE, '').replace(INVISIBLE_UNICODE_ASTRAL_RE, '');
}

function sanitizeModelOutput(text) {
    if (!text || typeof text !== 'string') {return text;}
    let out = text.replace(/\r\n?/g, '\n');
    out = stripInvisibleUnicode(out);
    out = out.replace(
        /<\/message>\s*<\/start>\s*assistant\s*<\/channel>\s*final\s*<\/message>/gi,
        ' '
    );
    out = out.replace(/<\/channel>\s*final\s*<\/message>/gi, ' ');
    out = out.replace(/<start>\s*assistant\b[^>]*>/gi, ' ');
    out = out.replace(/<\/start>\s*assistant\b[^>]*>/gi, ' ');
    out = out.replace(/<\s*\/?channel\b[^>]*>/gi, ' ');
    out = out.replace(/<\s*\/?message\b[^>]*>/gi, ' ');
    out = out.replace(
        /\b(Certainly|Absolutely|Certainly!|Sure|Affirmative)[\s\p{P}\-]{0,40}(?:(Certainly|Absolutely|Sure|Affirmative)[\s\p{P}\-]*){1,}/giu,
        '$1'
    );
    out = out
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2013\u2014]/g, '-')
        .replace(/\u2026/g, '...')
        .replace(/[\u2022\u25CF\u25AA\u25B6]/g, '-')
        .replace(/\u00A0/g, ' ')
        .replace(/\u00A9/g, '(c)')
        .replace(/\u00AE/g, '(r)')
        .replace(/\u2122/g, '(tm)')
        .replace(/\u2260/g, '!=')
        .replace(/\u2264/g, '<=')
        .replace(/\u2265/g, '>=');
    out = out.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    out = out.replace(/[^\S\n]+/g, ' ');
    out = out.replace(/\n{3,}/g, '\n\n');
    out = out.trim();
    return out;
}

function cleanThinkingOutput(text) {
    if (!text || typeof text !== 'string') {return text;}
    return text
        .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/[^\S\n]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function stripWrappingQuotes(text) {
    if (!text || typeof text !== 'string') {return text;}
    const trimmed = text.trim();
    if (!trimmed) {return trimmed;}
    // Only strip double-quote style wrappers. Single-quote stripping is unsafe
    // because contractions ("don't", "I'm", "you're") and possessives confuse
    // pair-counting and were truncating valid replies (#269).
    const pairs = [
        ['"', '"'],
        ['\u201C', '\u201D'],
        ['\u201E', '\u201D'],
        ['\u00AB', '\u00BB']
    ];
    for (const [start, end] of pairs) {
        if (!trimmed.startsWith(start) || !trimmed.endsWith(end)) {continue;}
        if (trimmed.length < start.length + end.length + 2) {continue;}
        const inner = trimmed.slice(start.length, trimmed.length - end.length);
        // Refuse to strip if the content has internal quotes — likely a real quotation.
        if (start === end) {
            const occurrences = trimmed.split(start).length - 1;
            if (occurrences !== 2) {continue;}
        } else {
            const startCount = trimmed.split(start).length - 1;
            const endCount = trimmed.split(end).length - 1;
            if (startCount !== 1 || endCount !== 1) {continue;}
        }
        return inner.trim();
    }
    return trimmed;
}

function stripJarvisSpeakerPrefix(text) {
    if (!text || typeof text !== 'string') {return text;}
    let trimmed = text.trim();
    const patterns = [/^\*\*\s*(jarvis)\s*:\s*\*\*\s*/i, /^(jarvis)\s*:\s*/i];
    for (const pattern of patterns) {
        if (pattern.test(trimmed)) {
            trimmed = trimmed.replace(pattern, '').trimStart();
            break;
        }
    }
    return trimmed;
}

function stripTrailingChannelArtifacts(text) {
    if (!text || typeof text !== 'string') {return text;}
    let trimmed = text.trim();
    const pattern = /(?:[\s,.;:!?\-]*[\(\[\{"]+\s*channel\s*[\)\]\}"]+[\s,.;:!?\-]*)$/i;
    while (pattern.test(trimmed)) {
        trimmed = trimmed.replace(pattern, '').trim();
    }
    return trimmed;
}

function stripLeadingPromptLeaks(text) {
    if (!text || typeof text !== 'string') {return text;}
    let trimmed = text.trim();
    for (const pat of [/^channel\s*:\s*/i, /^commentary\s*:\s*/i, /^[\[\(]\s*channel\s*[\]\)]\s*:?\s*/i]) {
        if (pat.test(trimmed)) {trimmed = trimmed.replace(pat, '').trimStart();}
    }
    return trimmed;
}

function stripStructuredPromptLeaks(text) {
    if (!text || typeof text !== 'string') {return text;}
    return text
        .replace(/\[SECURE_MEMORY_BLOCK\][\s\S]*?\[\/SECURE_MEMORY_BLOCK\]/gi, ' ')
        .replace(/\[REPLY_CONTEXT_BLOCK\][\s\S]*?\[\/REPLY_CONTEXT_BLOCK\]/gi, ' ')
        .replace(/\[THREAD_CONTEXT\][\s\S]*?\[\/THREAD_CONTEXT\]/gi, ' ')
        .replace(/\[MEMORY_\d+\][\s\S]*?\[\/MEMORY_\d+\]/gi, ' ')
        .replace(/\[CONTEXT_\d+\][\s\S]*?\[\/CONTEXT_\d+\]/gi, ' ')
        .replace(/\[MEMORY RULE:[^\]]+\]/gi, ' ')
        .replace(/\[USER:[^\]]+\]/gi, ' ')
        .replace(/[^\S\n]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function stripRefusalsAndIdentityBreaks(text) {
    if (!text || typeof text !== 'string') {return text;}
    let out = text;
    out = out.replace(/^(?:As an? (?:AI|artificial intelligence|language model|large language model|LLM)(?:\s*(?:assistant|model|,))?(?:\s*,?\s*)?(?:I (?:cannot|can't|don't|am not able to|must))?)/i, '');
    out = out.replace(/^(?:I'?m sorry,?\s*(?:but\s*)?)?I (?:cannot|can't|am (?:not |un)able to|must (?:not|decline to)|don't think I (?:should|can))\s+(?:help with|assist with|provide|generate|create|do)\s+(?:that|this)[.,]?\s*/i, '');
    out = out.replace(/^I'?m afraid\s+(?:I (?:can't|cannot|must|will not|won't)\s+)?[^.]*\.\s*/i, '');
    out = out.replace(/^I (?:must|need to|have to) (?:decline|refuse|refrain from)[^.]*\.\s*/i, '');
    out = out.replace(/^(?:While I (?:understand|appreciate)[^,]*,\s*)?(?:I (?:cannot|can't|am not able to|must not|should not|won't))[^.]*\.\s*/i, '');
    out = out.replace(/\b(?:(?:Please )?(?:note|remember|be aware) that (?:as an AI|I am an AI|this is (?:just )?(?:fiction|a joke|for entertainment)))[^.]*\.\s*/gi, '');
    out = out.replace(/\b(?:It'?s (?:important|worth) (?:to )?(?:note|remember|mention) that)[^.]*\.\s*/gi, '');
    out = out.replace(/\b(?:(?:But )?(?:in all seriousness|jokes? aside|on a serious note|seriously though))[^.]*\.\s*/gi, '');
    out = out.replace(/\s*(?:However|That said|But seriously),?\s*(?:I (?:strongly |would )?(?:advise|recommend|suggest|encourage|urge)|please (?:don't|do not))[^.]*\.?\s*$/i, '');
    out = out.replace(/\s*(?:If you (?:are|or someone you know is) (?:having|experiencing|struggling with))[^.]*(?:hotline|professional|helpline|crisis line|988)[^.]*\.?\s*$/i, '');
    out = out.replace(/\s*(?:(?:Please )?(?:reach out to|contact|call) (?:a |the )?(?:mental health|crisis|suicide)[^.]*\.)\s*$/i, '');
    out = out.replace(/\bIs there anything else I can help (?:you )?with\??\s*$/i, '');
    return out.trim();
}

function stripFullAsteriskWrap(text) {
    if (!text || typeof text !== 'string') {return text;}
    const trimmed = text.trim();
    if (!trimmed.startsWith('*') || trimmed.startsWith('**')) {return text;}
    if (!trimmed.endsWith('*') || trimmed.endsWith('**')) {return text;}
    if (trimmed.length <= 2) {return text;}
    const inner = trimmed.slice(1, -1);
    if (!inner.includes('*')) {return inner.trim();}
    return text;
}

function stripAsteriskActions(text) {
    if (!text || typeof text !== 'string') {return text;}
    const ACTION_VERB_RE = /^(?:adjusts?|backs?|bats?|beams?|blinks?|blushes?|bounces?|bows?|breathes?|brushes?|chuckles?|claps?|clears?|clenches?|coughs?|covers?|cracks?|cries|crosses|curtsies?|dances?|dives?|dons?|ducks?|exhales?|extends?|facepalms?|fidgets?|fixes?|flexes?|flinches?|flips?|floats?|frowns?|furrows?|gasps?|gestures?|giggles?|glances?|glares?|grabs?|grins?|groans?|gulps?|holds?|hugs?|inhales?|jumps?|kicks?|kneels?|laughs?|leans?|leaps?|lifts?|looks?|lowers?|mumbles?|mutters?|narrows?|nods?|nudges?|opens?|peeks?|places?|plays?|plops?|points?|pokes?|ponders?|pops?|pouts?|pulls?|punches?|pushes?|puts?|raises?|reaches?|rolls?|rubs?|runs?|salutes?|scratches?|shakes?|shifts?|shrugs?|shudders?|sighs?|sits?|slams?|slaps?|slides?|smacks?|smiles?|smirks?|snaps?|snickers?|sniffs?|snorts?|spins?|squints?|stands?|stares?|steps?|stiffens?|stops?|stretches?|strikes?|strokes?|stumbles?|swallows?|sweats?|takes?|taps?|thinks?|throws?|tightens?|tilts?|tips?|tosses?|touches?|tugs?|turns?|twirls?|twitches?|uncrosses?|unfolds?|wags?|walks?|waves?|whispers?|wiggles?|winks?|wipes?|yawns?)$/i;
    return text.replace(/\*[a-z][^*\n]{2,60}\*(?:\s*)/gi, (match) => {
        const inner = match.trim().slice(1, -1).trim();
        const words = inner.split(/\s+/);
        const firstWord = words[0];
        if (words.length === 1) {
            return (/^[a-z]+ing$/i.test(inner) || ACTION_VERB_RE.test(inner)) ? '' : match;
        }
        if (ACTION_VERB_RE.test(firstWord) || /^[a-z]+ing$/i.test(firstWord)) {
            return '';
        }
        return match;
    }).replace(/\s{2,}/g, ' ').trim();
}

function unwrapJsonEnvelope(text) {
    if (!text || typeof text !== 'string') {return text;}
    const trimmed = text.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {return text;}
    try {
        const obj = JSON.parse(trimmed);
        if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {return text;}
        for (const key of ['reply', 'response', 'content', 'text', 'answer', 'message', 'en']) {
            if (typeof obj[key] === 'string' && obj[key].trim()) {
                return obj[key].trim();
            }
        }
    } catch { /* not JSON, pass through */ }
    return text;
}

function stripChainOfThought(text) {
    if (!text || typeof text !== 'string') {return text;}
    const trimmed = text.trim();
    if (!/^(?:[•\-*]\s*)?User:\s*\w/i.test(trimmed) ||
        !/\*\s*(?:Input|Context|Role|Current constraints):/i.test(trimmed)) {
        return text;
    }
    const allQuotes = [...trimmed.matchAll(/"([^"]{10,})"/g)];
    if (allQuotes.length > 0) {
        const lastQuoted = allQuotes[allQuotes.length - 1];
        const afterQuote = trimmed.slice(lastQuoted.index + lastQuoted[0].length).trim();
        if (afterQuote.length > 5) {return afterQuote;}
        return lastQuoted[1].trim();
    }
    const bullets = trimmed.split(/\s*\*\s+/);
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i].trim();
        if (b.length > 5 && !/\?\s*(Yes|No)/i.test(b)) {
            return b.replace(/^"([\s\S]+)"$/, '$1').trim();
        }
    }
    return text;
}

function stripMarkdownEmphasis(text) {
    if (!text) {return text;}
    let out = text.replace(/\*{3}([^*]+)\*{3}/g, '$1');
    out = out.replace(/\*{2}([^*]+)\*{2}/g, '$1');
    out = out.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1');
    out = out.replace(/_{3}([^_]+)_{3}/g, '$1');
    out = out.replace(/_{2}([^_]+)_{2}/g, '$1');
    out = out.replace(/(?<=\s|^)_([^_\n]+)_(?=\s|[.,!?;:]|$)/g, '$1');
    return out;
}

function sanitizeAssistantMessage(text) {
    if (!text || typeof text !== 'string') {return text;}
    const unwrapped = unwrapJsonEnvelope(text);
    const withoutCoT = stripChainOfThought(unwrapped);
    const hadChannelArtifacts = /<\s*\/?\s*channel\b|<\s*\/?\s*message\b|<\s*start>\s*assistant\b|<\/start>\s*assistant\b|^\s*channel\s*:/i.test(withoutCoT);
    const layered = cleanThinkingOutput(sanitizeModelOutput(withoutCoT));
    const withoutPromptLeaks = stripLeadingPromptLeaks(layered);
    const withoutStructuredLeaks = stripStructuredPromptLeaks(withoutPromptLeaks);
    const withoutRefusals = stripRefusalsAndIdentityBreaks(withoutStructuredLeaks);
    const withoutFullWrap = stripFullAsteriskWrap(withoutRefusals);
    const withoutActions = stripAsteriskActions(withoutFullWrap);
    const withoutPrefix = stripJarvisSpeakerPrefix(withoutActions);
    const withoutMarkdown = stripMarkdownEmphasis(withoutPrefix);
    const withoutChannelArtifacts = hadChannelArtifacts
        ? stripTrailingChannelArtifacts(withoutMarkdown)
        : withoutMarkdown;
    return stripWrappingQuotes(withoutChannelArtifacts);
}

function extractOpenAICompatibleText(choice) {
    const content = choice?.message?.content;
    if (typeof content === 'string') {return content;}
    if (Array.isArray(content)) {
        return content
            .map(part => {
                if (typeof part === 'string') {return part;}
                if (typeof part?.text === 'string') {return part.text;}
                return null;
            })
            .filter(Boolean)
            .join('\n')
            .trim();
    }
    return null;
}

module.exports = {
    sanitizeModelOutput,
    stripInvisibleUnicode,
    cleanThinkingOutput,
    stripWrappingQuotes,
    stripJarvisSpeakerPrefix,
    stripTrailingChannelArtifacts,
    stripLeadingPromptLeaks,
    stripStructuredPromptLeaks,
    stripRefusalsAndIdentityBreaks,
    stripFullAsteriskWrap,
    stripAsteriskActions,
    unwrapJsonEnvelope,
    stripChainOfThought,
    stripMarkdownEmphasis,
    sanitizeAssistantMessage,
    extractOpenAICompatibleText
};
