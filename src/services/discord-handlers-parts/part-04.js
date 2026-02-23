
    // ============ REACTION ROLE HANDLERS ============

    async handleReactionRoleCommand(interaction) {
        return await reactionRoleHandler.handleReactionRoleCommand(this, interaction);
    }

    async handleReactionAdd(reaction, user) {
        return await reactionRoleHandler.handleReactionAdd(this, reaction, user);
    }

    async handleReactionRemove(reaction, user) {
        return await reactionRoleHandler.handleReactionRemove(this, reaction, user);
    }

    async handleTrackedMessageDelete(message) {
        return await reactionRoleHandler.handleTrackedMessageDelete(this, message);
    }

    // ============ MONITOR HANDLER ============

    async handleMonitorCommand(interaction) {
        return await monitorHandler.handleMonitorCommand(interaction);
    }

    // ============ MEDIA HANDLERS ============

    async handleSlashCommandClip(interaction) {
        return await mediaHandlers.handleSlashCommandClip(this, interaction);
    }

    async fetchAttachmentBuffer(attachment) {
        return await mediaHandlers.fetchAttachmentBuffer(this, attachment);
    }

    async fetchImageFromUrl(rawUrl, opts) {
        return await mediaHandlers.fetchImageFromUrl(this, rawUrl, opts);
    }

    async handleCaptionCommand(interaction) {
        return await mediaHandlers.handleCaptionCommand(this, interaction);
    }

    async handleMemeCommand(interaction) {
        return await mediaHandlers.handleMemeCommand(this, interaction);
    }

    // ============ GAME / FUN HANDLERS ============

    async handleCryptoCommand(interaction) {
        return await gameHandlers.handleCryptoCommand(this, interaction);
    }

    async handleSixSevenCommand(interaction) {
        return await gameHandlers.handleSixSevenCommand(this, interaction);
    }

    async handleJokeCommand(interaction) {
        return await gameHandlers.handleJokeCommand(this, interaction);
    }

    async handleFeaturesCommand(interaction) {
        return await gameHandlers.handleFeaturesCommand(this, interaction);
    }

    async handleOptCommand(interaction) {
        return await gameHandlers.handleOptCommand(this, interaction);
    }

    async handleComponentInteraction(interaction) {
        return await gameHandlers.handleComponentInteraction(this, interaction);
    }

    async handleEightBallCommand(interaction) {
        return await gameHandlers.handleEightBallCommand(this, interaction);
    }

    async handleVibeCheckCommand(interaction) {
        return await gameHandlers.handleVibeCheckCommand(this, interaction);
    }

    async handleBonkCommand(interaction) {
        return await gameHandlers.handleBonkCommand(this, interaction);
    }

    async handleTemplateCommand(interaction, templates, title, defaultLine, color, optionName) {
        return await gameHandlers.handleTemplateCommand(this, interaction, templates, title, defaultLine, color, optionName);
    }

    async handleRoastCommand(interaction) {
        return await gameHandlers.handleRoastCommand(this, interaction);
    }

    async handleFlatterCommand(interaction) {
        return await gameHandlers.handleFlatterCommand(this, interaction);
    }

    async handleToastCommand(interaction) {
        return await gameHandlers.handleToastCommand(this, interaction);
    }

    async handleTriviaCommand(interaction) {
        return await gameHandlers.handleTriviaCommand(this, interaction);
    }

    caesarShift(text, shift) {
        return gameHandlers.caesarShift(text, shift);
    }

    async handleCipherCommand(interaction) {
        return await gameHandlers.handleCipherCommand(this, interaction);
    }

    scrambleWord(word) {
        return gameHandlers.scrambleWord(word);
    }

    async handleScrambleCommand(interaction) {
        return await gameHandlers.handleScrambleCommand(this, interaction);
    }

    async handleMissionCommand(interaction) {
        return await gameHandlers.handleMissionCommand(this, interaction);
    }

    // ============ MEMORY / PERSONA HANDLERS ============

    async handleMemoryCommand(interaction) {
        return await memoryHandler.handleMemoryCommand(this, interaction);
    }

    async handlePersonaCommand(interaction) {
        return await memoryHandler.handlePersonaCommand(this, interaction);
    }
