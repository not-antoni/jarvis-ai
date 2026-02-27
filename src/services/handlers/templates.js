'use strict';

/**
 * Static template data for Discord game/social handlers.
 * Extracted from discord-handlers-impl.js constructor to reduce file size.
 */

const roastTemplates = [
    'Deploying shade cannons on {target}. Try not to melt, sir.',
    '{target}, even my error logs have more direction.',
    '{target}, if brilliance were a drive, you\u2019re stuck in neutral.',
    '{target}, I\u2019ve met loading bars with more resolve.',
    'I ran the numbers, {target}. Comedy requires a punchline\u2014you are optional.'
];

const flatterTemplates = [
    '{target}, your presence calibrates the whole grid.',
    '{target}, even Stark\u2019s ego flinches when you walk in.',
    'I logged your stride, {target}. It ranks among the top five trajectories.',
    '{target}, the servers purr a little smoother when you\u2019re nearby.',
    'Consider this official: {target} remains the premium upgrade.'
];

const toastTemplates = [
    'A toast to {target}: may your glitches be charming and your victories loud.',
    'Raise a glass for {target}; brilliance executed with reckless elegance.',
    'To {target}: proof that chaos, when curated, is unstoppable.',
    'Celebrating {target}\u2014the software patch the universe didn\u2019t deserve.',
    'Here\u2019s to {target}; long may your legend crash their humble firewalls.'
];

const triviaQuestions = [
    {
        question: 'Which Stark suit first featured full nanotech deployment?',
        choices: ['Mark 42', 'Mark 46', 'Mark 50', 'Mark 85'],
        answer: 'Mark 50'
    },
    {
        question: 'What element did Tony synthesize to replace palladium?',
        choices: ['Vibranium', 'Badassium', 'Chromium', 'Proteanium'],
        answer: 'Badassium'
    },
    {
        question: 'Which protocol locks down the Avengers Tower?',
        choices: ['Protocol House Party', 'Protocol Barn Door', 'Protocol Sky Shield', 'Protocol Jarvis Prime'],
        answer: 'Protocol Barn Door'
    },
    {
        question: 'Who reprogrammed Vision\u2019s mind stone interface besides Stark?',
        choices: ['Banner', 'Shuri', 'Pym', 'Cho'],
        answer: 'Banner'
    }
];

const cipherPhrases = [
    'Arc reactor diagnostics nominal',
    'Stark Expo security override',
    'Deploy the Hall of Armor',
    'Engage satellite uplink now',
    'Initiate Mark Seven extraction'
];

const scrambleWords = [
    'repulsor',
    'vibranium',
    'arcforge',
    'nanotech',
    'ultrasonic',
    'starkware'
];

const missions = [
    'Share a photo of your current setup\u2014Jarvis will rate the chaos.',
    'Teach the channel one obscure fact. Bonus points for science fiction.',
    'Designate a teammate and compliment their latest win.',
    'Queue up a nostalgic MCU moment and drop the timestamp.',
    'Build a playlist with five tracks that motivate your inner Avenger.',
    'Swap desktop wallpapers for the day and show your new look.',
    'Document a mini DIY project and share progress before midnight.',
    'Run a five-minute stretch break and ping the squad to join.'
];

module.exports = {
    roastTemplates,
    flatterTemplates,
    toastTemplates,
    triviaQuestions,
    cipherPhrases,
    scrambleWords,
    missions
};
