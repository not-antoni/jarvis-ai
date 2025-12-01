const play = require('./play');
const skip = require('./skip');
const pause = require('./pause');
const resume = require('./resume');
const stop = require('./stop');
const queue = require('./queue');
const lavalink = require('./lavalink');

const commandList = [play, skip, pause, resume, stop, queue, lavalink];
const commandMap = new Map(commandList.map((command) => [command.data.name, command]));

module.exports = {
    commandList,
    commandMap
};

