/**
 * Fun features still used by live slash handlers.
 *
 * Everything else in the old file was dead generator/data sludge with no
 * inbound callers after the current command cleanup.
 */

const typingPhrases = [
    // Pangrams
    'The quick brown fox jumps over the lazy dog',
    'Pack my box with five dozen liquor jugs',
    'How vexingly quick daft zebras jump',
    'Sphinx of black quartz judge my vow',
    'Two driven jocks help fax my big quiz',
    'Jackdaws love my big sphinx of quartz',
    'The five boxing wizards jump quickly',
    'Crazy Frederick bought many very exquisite opal jewels',
    // JARVIS specific
    'JARVIS is the best Discord bot ever made',
    'I hereby declare that bots are superior to humans',
    'Sir I recommend you reconsider that course of action',
    'Running diagnostics on your life choices',
    'At your service but questioning your judgment',
    'Processing request and judging silently',
    'Sir your takes are concerning my circuits',
    // Memes
    'The mitochondria is the powerhouse of the cell',
    'Never gonna give you up never gonna let you down',
    'I use arch btw',
    'It works on my machine I dont know what to tell you',
    'Skill issue detected please git gud',
    'According to all known laws of aviation',
    'Did you ever hear the tragedy of Darth Plagueis',
    'Hello there General Kenobi',
    'This is where the fun begins',
    'I am the senate',
    'Its over I have the high ground',
    'You were the chosen one',
    'I have a bad feeling about this',
    'Do or do not there is no try',
    'This is the way',
    'I have spoken',
    // Internet culture
    'no cap on a stack fr fr ong',
    'its giving what its supposed to give',
    'slay bestie ate that up no crumbs',
    'not me doing this at three am again',
    'touch grass chronically online person',
    'ratio plus L plus you fell off',
    'cope seethe mald about it',
    'skill issue git gud scrub',
    'caught in four k ultra hd',
    'main character energy detected',
    // Tech
    'sudo rm -rf / --no-preserve-root just kidding dont do that',
    'undefined is not a function classic javascript',
    'it compiles so ship it to production',
    'console dot log debugging is an art form',
    'stack overflow copy paste driven development',
    'git commit negative m oops',
    'npm install literally everything',
    'this code is self documenting no comments needed',
    // Random wisdom
    'be the change you wish to see in the world or dont',
    'in a world of ones and zeros be a two',
    'life is short eat dessert first',
    'not all who wander are lost but I definitely am',
    'the early bird gets the worm but the second mouse gets the cheese',
    'if at first you dont succeed redefine success',
    'why be normal when weird is more fun',
    'adulting is a scam send me back to being a kid',
    // Movie quotes
    'with great power comes great responsibility',
    'I am Iron Man',
    'Avengers assemble',
    'I can do this all day',
    'That is Americas ass',
    'I love you three thousand',
    'Dormammu I have come to bargain',
    'We are Groot',
    'Another day another dollar another disappointment',
    // Gaming
    'gg ez no re',
    'first try no cap',
    'press F to pay respects',
    'would you kindly type this phrase',
    'the cake is a lie',
    'war war never changes',
    'its dangerous to go alone take this',
    'do a barrel roll',
    'all your base are belong to us',
    'finish him',
    // Hard mode phrases
    'Buffalo buffalo Buffalo buffalo buffalo buffalo Buffalo buffalo',
    'James while John had had had had had had had had had had a better effect',
    'That that is is that that is not is not is that it it is',
    'The horse raced past the barn fell',
    'The complex houses married and single soldiers and their families'
];

const shipPrefixes = ['The SS', 'HMS', 'USS', 'The Good Ship', 'RMS', 'Love Boat'];
const shipSuffixes = ['of Love', 'Forever', 'Eternal', 'Supreme', 'of Destiny', 'UwU'];

function randomChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}


function getRandomTypingPhrase() {
    return randomChoice(typingPhrases);
}


function generateShipName(name1, name2) {
    // Take first half of first name and second half of second name
    const half1 = name1.slice(0, Math.ceil(name1.length / 2));
    const half2 = name2.slice(Math.floor(name2.length / 2));
    const shipName = half1 + half2;

    const prefix = randomChoice(shipPrefixes);
    const suffix = Math.random() < 0.3 ? ` ${  randomChoice(shipSuffixes)}` : '';

    return `${prefix} ${shipName}${suffix}`;
}

function calculateCompatibility(id1, id2) {
    // Use user IDs to generate consistent but seemingly random percentage
    const combined = id1 + id2;
    let hash = 0;
    for (let i = 0; i < combined.length; i++) {
        hash = (hash << 5) - hash + combined.charCodeAt(i);
        hash = hash & hash;
    }
    return Math.abs(hash % 101);
}

module.exports = {
    typingPhrases,
    generateShipName,
    getRandomTypingPhrase,
    calculateCompatibility,
    randomChoice
};
