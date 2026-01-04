const t = require('./t');

const commandList = [t];
const commandMap = new Map(commandList.map(command => [command.data.name, command]));

module.exports = {
    commandList,
    commandMap
};
