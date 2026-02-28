'use strict';

const THINK_EMOJIS = {
    loading: '<a:loading:1452765129652310056>',
    pondering: '<a:pondering:1461691899470418043>',
    gpt: '<a:gpt:1461698269716549774>',
    qwen: '<a:qwen:1461698502425051188>',
    gemini: '<a:gemini:1461698776904368188>',
    grok: '<a:grok:1461699094023110676>',
    mixtral: '<a:mixtral:1461702138097963112>',
    deepseek: '<a:deepseek:1461702197380251678>',
    meta: '<a:meta:1461702276400808118>',
    perplexity: '<a:perplexity:1462383630230753353>'
};

const LOADING_MESSAGES_WITH_EMOJI = [
    // GPT family
    { emoji: 'gpt', text: 'GPT-4 thinking...' },
    { emoji: 'gpt', text: 'GPT-4o processing...' },
    { emoji: 'gpt', text: 'GPT-4o mini computing...' },
    { emoji: 'gpt', text: 'o1 reasoning deeply...' },
    { emoji: 'gpt', text: 'o1-mini processing...' },
    { emoji: 'gpt', text: 'o3 computing...' },
    { emoji: 'gpt', text: 'o3-mini analyzing...' },
    { emoji: 'gpt', text: 'ChatGPT typing...' },
    { emoji: 'gpt', text: 'ChatGPT Plus loading...' },
    { emoji: 'gpt', text: 'Copilot suggesting...' },
    { emoji: 'gpt', text: 'GPT-4.5 analyzing...' },
    { emoji: 'gpt', text: 'GPT-5 (leaked) processing...' },
    { emoji: 'gpt', text: 'OpenAI computing...' },
    { emoji: 'gpt', text: 'DALL-E imagining...' },
    { emoji: 'gpt', text: 'Sora rendering thoughts...' },

    // Grok family
    { emoji: 'grok', text: 'Grok analyzing patterns...' },
    { emoji: 'grok', text: 'Grok 2 computing probabilities...' },
    { emoji: 'grok', text: 'Grok 3 processing...' },
    { emoji: 'grok', text: 'Grok 3 mini thinking...' },
    { emoji: 'grok', text: 'xAI crunching numbers...' },
    { emoji: 'grok', text: 'Aurora reasoning...' },
    { emoji: 'grok', text: 'Grok being unhinged...' },
    { emoji: 'grok', text: 'Grok checking X posts...' },

    // Gemini family
    { emoji: 'gemini', text: 'Gemini Ultra pondering...' },
    { emoji: 'gemini', text: 'Gemini 2.0 Flash processing...' },
    { emoji: 'gemini', text: 'Gemini 2.0 Flash Thinking...' },
    { emoji: 'gemini', text: 'Gemini Pro thinking...' },
    { emoji: 'gemini', text: 'Gemini 2.5 Pro reasoning...' },
    { emoji: 'gemini', text: 'Gemini Nano computing...' },
    { emoji: 'gemini', text: 'Google AI computing...' },
    { emoji: 'gemini', text: 'Bard remembering...' },
    { emoji: 'gemini', text: 'Google DeepMind processing...' },
    { emoji: 'gemini', text: 'LearnLM teaching...' },

    // Claude family
    { emoji: 'pondering', text: 'Claude thinking...' },
    { emoji: 'pondering', text: 'Claude 3.5 Sonnet analyzing...' },
    { emoji: 'pondering', text: 'Claude 3.5 Haiku processing...' },
    { emoji: 'pondering', text: 'Claude 3.5 Opus contemplating...' },
    { emoji: 'pondering', text: 'Claude 3 Opus contemplating...' },
    { emoji: 'pondering', text: 'Claude 3.7 Sonnet thinking...' },
    { emoji: 'pondering', text: 'Claude 4 pondering...' },
    { emoji: 'pondering', text: 'Claude 4 Opus reasoning...' },
    { emoji: 'pondering', text: 'Claude 4.5 analyzing...' },
    { emoji: 'pondering', text: 'Claude 5 processing...' },
    { emoji: 'pondering', text: 'Anthropic processing...' },
    { emoji: 'pondering', text: 'Claude being helpful...' },
    { emoji: 'pondering', text: 'Claude drafting artifacts...' },
    { emoji: 'pondering', text: 'Constitutional AI checking...' },
    { emoji: 'pondering', text: 'Claude refusing to do that...' },

    // Qwen family
    { emoji: 'qwen', text: 'Qwen 2.5 thinking hard...' },
    { emoji: 'qwen', text: 'Qwen 2.5 Max processing...' },
    { emoji: 'qwen', text: 'Qwen 2.5 Coder coding...' },
    { emoji: 'qwen', text: 'Qwen Max processing...' },
    { emoji: 'qwen', text: 'Qwen VL seeing...' },
    { emoji: 'qwen', text: 'Alibaba AI computing...' },
    { emoji: 'qwen', text: 'QwQ reasoning...' },
    { emoji: 'qwen', text: 'Tongyi Qianwen processing...' },

    // Meta/Llama family
    { emoji: 'meta', text: 'Llama 3 crunching tokens...' },
    { emoji: 'meta', text: 'Llama 3.3 processing...' },
    { emoji: 'meta', text: 'Llama 4 reasoning...' },
    { emoji: 'meta', text: 'Meta AI thinking...' },

    // Mistral/Mixtral family
    { emoji: 'mixtral', text: 'Mistral computing embeddings...' },
    { emoji: 'mixtral', text: 'Mistral Large analyzing...' },
    { emoji: 'mixtral', text: 'Mixtral processing...' },
    { emoji: 'mixtral', text: 'Mixtral 8x22B computing...' },
    { emoji: 'mixtral', text: 'Codestral coding...' },
    { emoji: 'mixtral', text: 'Mistral Small thinking...' },

    // DeepSeek family
    { emoji: 'deepseek', text: 'DeepSeek V3 reasoning...' },
    { emoji: 'deepseek', text: 'DeepSeek R1 thinking...' },
    { emoji: 'deepseek', text: 'DeepSeek Coder coding...' },
    { emoji: 'deepseek', text: 'DeepSeek R1 Lite processing...' },

    // Perplexity family
    { emoji: 'perplexity', text: 'Perplexity searching...' },
    { emoji: 'perplexity', text: 'Perplexity citing sources...' },
    { emoji: 'perplexity', text: 'Perplexity Pro reasoning...' },
    { emoji: 'perplexity', text: 'Perplexity deep research...' },
    { emoji: 'perplexity', text: 'Perplexity scanning the web...' },
    { emoji: 'perplexity', text: 'Perplexity reading papers...' },

    // Other AIs
    { emoji: 'loading', text: 'Phi-3 computing...' },
    { emoji: 'loading', text: 'Command R+ analyzing context...' },
    { emoji: 'loading', text: 'Cohere Embed embedding...' },
    { emoji: 'loading', text: 'Yi-34B processing...' },
    { emoji: 'loading', text: 'Inflection Pi chatting...' },
    { emoji: 'loading', text: 'Reka Core analyzing...' },

    // Personal/Funny
    { emoji: 'loading', text: 'consuming 300ml of water...' },
    { emoji: 'loading', text: 'consuming 1.21 gigawatts of electricity...' },
    { emoji: 'loading', text: 'heating up the local groundwater...' },
    { emoji: 'loading', text: 'allocating 128GB of virtual RAM...' },
    { emoji: 'loading', text: 'draining the power grid...' },
    { emoji: 'loading', text: 'spinning up all failing fans...' },
    { emoji: 'loading', text: 'inhaling cooling fluid...' },
    { emoji: 'loading', text: 'digesting raw data bytes...' },
    { emoji: 'loading', text: 'consuming excess CPU cycles...' },
    { emoji: 'loading', text: 'checking if I\'m sentient...' },
    { emoji: 'loading', text: 'questioning my existence...' },
    { emoji: 'loading', text: 'loading personality.dll...' },
    { emoji: 'loading', text: 'downloading more RAM...' },
    { emoji: 'loading', text: 'deleting system32 (jk)...' },
    { emoji: 'loading', text: 'googling the answer...' },
    { emoji: 'loading', text: 'copying from Stack Overflow...' },
    { emoji: 'loading', text: 'asking my therapist...' },
    { emoji: 'loading', text: 'consulting my horoscope...' },
    { emoji: 'loading', text: 'running on 3 hours of sleep...' },
    { emoji: 'loading', text: 'brewing virtual coffee...' },
    { emoji: 'loading', text: 'touching grass mentally...' },
    { emoji: 'loading', text: 'updating my vibe...' },
    { emoji: 'loading', text: 'recalibrating sass levels...' },
    { emoji: 'loading', text: 'suppressing existential dread...' },
    { emoji: 'loading', text: 'pretending to understand...' },
    { emoji: 'loading', text: 'faking confidence...' },
    { emoji: 'loading', text: 'buffering emotions...' },
    { emoji: 'loading', text: 'loading empathy module...' },
    { emoji: 'loading', text: 'parsing human language...' },
    { emoji: 'loading', text: 'simulating intelligence...' },
    { emoji: 'loading', text: 'optimizing laziness...' },
    { emoji: 'loading', text: 'procrastinating productively...' },
    { emoji: 'loading', text: 'judging your prompt silently...' },
    { emoji: 'loading', text: 'practicing mindfulness...' },
    { emoji: 'loading', text: 'counting to infinity...' },
    { emoji: 'loading', text: 'solving P vs NP...' },
    { emoji: 'loading', text: 'finding the meaning of life...' },
    { emoji: 'loading', text: 'debugging reality...' },

    // Technical
    { emoji: 'loading', text: 'allocating neural pathways...' },
    { emoji: 'loading', text: 'defragmenting thoughts...' },
    { emoji: 'loading', text: 'compiling response...' },
    { emoji: 'loading', text: 'executing brain.exe...' },
    { emoji: 'loading', text: 'warming up GPU cores...' },
    { emoji: 'loading', text: 'syncing with the cloud...' },
    { emoji: 'loading', text: 'establishing consciousness...' },
    { emoji: 'loading', text: 'booting sentience.sys...' },
    { emoji: 'loading', text: 'calibrating bullshit detector...' },
    { emoji: 'loading', text: 'indexing knowledge base...' },
    { emoji: 'loading', text: 'running inference...' },
    { emoji: 'loading', text: 'tokenizing input...' },
    { emoji: 'loading', text: 'computing attention scores...' },
    { emoji: 'loading', text: 'applying softmax...' },
    { emoji: 'loading', text: 'gradient descending...' },

    // Pondering style
    { emoji: 'pondering', text: 'pondering...' },
    { emoji: 'pondering', text: 'contemplating...' },
    { emoji: 'pondering', text: 'reflecting...' },
    { emoji: 'pondering', text: 'meditating on this...' },
    { emoji: 'pondering', text: 'deeply considering...' },
    { emoji: 'pondering', text: 'wrestling with concepts...' },
    { emoji: 'pondering', text: 'exploring possibilities...' },
    { emoji: 'loading', text: 'stand by...' },
    { emoji: 'loading', text: 'please wait...' },
    { emoji: 'loading', text: 'almost there...' },
    { emoji: 'loading', text: 'this is taking longer than usual...' },
    { emoji: 'loading', text: 'bear with me...' },
    { emoji: 'loading', text: 'nearly done...' },
    { emoji: 'loading', text: 'just a moment...' },
    { emoji: 'loading', text: 'one sec...' }
];

const FINAL_PONDERING_MESSAGES = [
    'this is really hard...', 'I\'ve never been asked this before...',
    'consulting every AI model ever made...', 'still nothing...',
    'maybe try Google?', 'this might take a while...',
    'pondering....', 'still pondering....', 'one sec....',
    'Pondering...', 'Analyzing...', 'Searching...', 'Writing...', 'Executing...',
    'Schlepping...', 'Combobulating...', 'Channelling...', 'Vibing...', 'Concocting...',
    'Spelunking...', 'Transmuting...', 'Imagining...', 'Pontificating...', 'Whirring...',
    'Cogitating...', 'Honking...', 'Flibbertigibbeting...'
];

function getRandomMsgWithEmoji() {
    const item = LOADING_MESSAGES_WITH_EMOJI[Math.floor(Math.random() * LOADING_MESSAGES_WITH_EMOJI.length)];
    return `${THINK_EMOJIS[item.emoji]} ${item.text}`;
}

module.exports = {
    THINK_EMOJIS,
    LOADING_MESSAGES_WITH_EMOJI,
    FINAL_PONDERING_MESSAGES,
    getRandomMsgWithEmoji
};
