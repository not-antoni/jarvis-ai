const { GiveawaysManager } = require('discord-giveaways');
const path = require('path');
const fs = require('fs');

class GiveawayService extends GiveawaysManager {
    // This function is called when the manager needs to get all giveaways which are stored in the database.
    async getAllGiveaways() {
        // Check if file exists
        const storagePath = path.join(__dirname, '../../giveaways.json');
        if (!fs.existsSync(storagePath)) {
            fs.writeFileSync(storagePath, '[]', 'utf-8');
            return [];
        }
        return JSON.parse(fs.readFileSync(storagePath, 'utf-8'));
    }

    // This function is called when a giveaway needs to be saved in the database.
    async saveGiveaway(messageId, giveawayData) {
        const storagePath = path.join(__dirname, '../../giveaways.json');
        const giveaways = await this.getAllGiveaways();
        giveaways.push(giveawayData);
        fs.writeFileSync(storagePath, JSON.stringify(giveaways, null, 2), 'utf-8');
        return true;
    }

    // This function is called when a giveaway needs to be edited in the database.
    async editGiveaway(messageId, giveawayData) {
        const storagePath = path.join(__dirname, '../../giveaways.json');
        const giveaways = await this.getAllGiveaways();
        const newGiveaways = giveaways.filter((giveaway) => giveaway.messageId !== messageId);
        newGiveaways.push(giveawayData);
        fs.writeFileSync(storagePath, JSON.stringify(newGiveaways, null, 2), 'utf-8');
        return true;
    }

    // This function is called when a giveaway needs to be deleted from the database.
    async deleteGiveaway(messageId) {
        const storagePath = path.join(__dirname, '../../giveaways.json');
        const giveaways = await this.getAllGiveaways();
        const newGiveaways = giveaways.filter((giveaway) => giveaway.messageId !== messageId);
        fs.writeFileSync(storagePath, JSON.stringify(newGiveaways, null, 2), 'utf-8');
        return true;
    }
}

let manager = null;

module.exports = {
    init: (client) => {
        if (!manager) {
            manager = new GiveawayService(client, {
                storage: false, // We handle storage manually to ensure path correctness
                updateCountdownEvery: 5000,
                default: {
                    botsCanWin: false,
                    embedColor: '#FF0000',
                    embedColorEnd: '#000000',
                    reaction: '🎉'
                }
            });
        }
        return manager;
    },
    getManager: () => manager
};
