/**
 * Discord event handlers — re-exports the merged implementation.
 *
 * Previously this file concatenated part-*.js files and compiled them via
 * module._compile().  The parts have been merged into discord-handlers-impl.js
 * so standard require() (and IDE tooling / stack traces) works normally.
 */
module.exports = require('./discord-handlers-impl');
