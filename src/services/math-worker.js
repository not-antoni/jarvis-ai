const { parentPort } = require('worker_threads');
const { solveMath } = require('./math-engine');

if (!parentPort) {
    throw new Error('math-worker must be run as a worker thread');
}

parentPort.on('message', ({ rawInput }) => {
    Promise.resolve()
        .then(() => solveMath(rawInput))
        .then(result => {
            parentPort.postMessage({ success: true, result });
        })
        .catch(error => {
            parentPort.postMessage({
                success: false,
                error: error?.message || 'Math evaluation failed.'
            });
        });
});
