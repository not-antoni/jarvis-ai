/**
 * Fun features still used by live slash handlers.
 *
 * Everything else in the old file was dead generator/data sludge with no
 * inbound callers after the current command cleanup.
 */

const shipPrefixes = ['The SS', 'HMS', 'USS', 'The Good Ship', 'RMS', 'Love Boat'];
const shipSuffixes = ['of Love', 'Forever', 'Eternal', 'Supreme', 'of Destiny', 'UwU'];

function randomChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
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
    // Sort IDs so ship(A,B) === ship(B,A)
    const combined = [id1, id2].sort().join('');
    let hash = 0;
    for (let i = 0; i < combined.length; i++) {
        hash = (hash << 5) - hash + combined.charCodeAt(i);
        hash = hash & hash;
    }
    return Math.abs(hash % 101);
}

module.exports = {
    generateShipName,
    calculateCompatibility,
    randomChoice
};
