const play = require('./play');
const skip = require('./skip');
const pause = require('./pause');
const resume = require('./resume');
const stop = require('./stop');
const queue = require('./queue');
const loop = require('./loop');
const leave = require('./leave');

// Lavalink removed - using yt-dlp for music playback
const commandList = [play, skip, pause, resume, stop, queue, loop, leave];
const commandMap = new Map(commandList.map(command => [command.data.name, command]));

module.exports = {
    commandList,
    commandMap
};
