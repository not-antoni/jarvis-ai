/**
 * Image Generator Service
 * Generates dynamic images for the bot (Leaderboards, Rank Cards, etc.)
 */

const { createCanvas, loadImage, registerFont } = require('canvas');
const path = require('path');
const fs = require('fs');

// Try to register font if available, otherwise rely on system fonts
try {
    // You might want to bundle a font like 'Roboto-Bold.ttf' in a 'assets/fonts' folder
    // registerFont(path.join(__dirname, '../../assets/fonts/Roboto-Bold.ttf'), { family: 'Roboto' });
} catch (e) {
    // Ignore font errors
}

class ImageGenerator {
    constructor() {
        this.width = 800;
        this.height = 600; // Minimum height, can expand
    }

    /**
     * Generate Leaderboard Image
     * @param {Array} users - Array of user objects { rank, username, balance, avatar, hasVipBadge, hasGoldenName }
     * @returns {Promise<Buffer>} - PNG Buffer
     */
    async generateLeaderboardImage(users) {
        const rowHeight = 80;
        const headerHeight = 120;
        const padding = 20;

        // Dynamic height based on user count (min 600)
        const totalHeight = Math.max(this.height, headerHeight + (users.length * rowHeight) + padding);

        const canvas = createCanvas(this.width, totalHeight);
        const ctx = canvas.getContext('2d');

        // --- Background ---
        // Dark tech gradient
        const gradient = ctx.createLinearGradient(0, 0, 0, totalHeight);
        gradient.addColorStop(0, '#0f0c29');
        gradient.addColorStop(0.5, '#302b63');
        gradient.addColorStop(1, '#24243e');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, this.width, totalHeight);

        // Tech overlap pattern (simple grid)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
        ctx.lineWidth = 1;
        for (let i = 0; i < this.width; i += 40) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i, totalHeight);
            ctx.stroke();
        }
        for (let i = 0; i < totalHeight; i += 40) {
            ctx.beginPath();
            ctx.moveTo(0, i);
            ctx.lineTo(this.width, i);
            ctx.stroke();
        }

        // --- Header ---
        ctx.fillStyle = '#FFD700'; // Gold
        ctx.shadowColor = 'rgba(255, 215, 0, 0.5)';
        ctx.shadowBlur = 15;
        ctx.font = 'bold 40px Sans';
        ctx.textAlign = 'center';
        ctx.fillText('STARK INDUSTRIES', this.width / 2, 50);

        ctx.fillStyle = '#FFFFFF';
        ctx.shadowColor = 'rgba(0, 212, 255, 0.5)';
        ctx.shadowBlur = 10;
        ctx.font = '30px Sans';
        ctx.fillText('TOP EARNERS', this.width / 2, 90);

        // Reset shadow
        ctx.shadowBlur = 0;

        // --- Rows ---
        let y = headerHeight;

        for (const user of users) {
            const isTop3 = user.rank <= 3;

            // Row Background (zebra striping / highlight top 3)
            if (isTop3) {
                const rowGrad = ctx.createLinearGradient(0, y, this.width, y);
                rowGrad.addColorStop(0, 'rgba(255, 215, 0, 0.1)'); // Gold tint
                rowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
                ctx.fillStyle = rowGrad;
                ctx.fillRect(10, y, this.width - 20, rowHeight - 10);
            } else {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
                ctx.fillRect(10, y, this.width - 20, rowHeight - 10);
            }

            // Rank
            ctx.font = 'bold 30px Sans';
            ctx.textAlign = 'center';
            if (user.rank === 1) ctx.fillStyle = '#FFD700';
            else if (user.rank === 2) ctx.fillStyle = '#C0C0C0';
            else if (user.rank === 3) ctx.fillStyle = '#CD7F32';
            else ctx.fillStyle = '#FFFFFF';

            ctx.fillText(`#${user.rank}`, 60, y + 50);

            // Avatar (Circle)
            try {
                // If avatar URL is provided
                if (user.avatar) {
                    const avatar = await loadImage(user.avatar);
                    const avatarSize = 60;
                    const avatarX = 110;
                    const avatarY = y + 5;

                    ctx.save();
                    ctx.beginPath();
                    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2, true);
                    ctx.closePath();
                    ctx.clip();
                    ctx.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize);
                    ctx.restore();

                    // Border around avatar
                    ctx.beginPath();
                    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2, true);
                    ctx.lineWidth = 2;
                    ctx.strokeStyle = isTop3 ? ctx.fillStyle : '#555'; // Use rank color
                    ctx.stroke();
                }
            } catch (err) {
                // Fallback circle if image load fails
                ctx.beginPath();
                ctx.arc(140, y + 35, 30, 0, Math.PI * 2);
                ctx.fillStyle = '#333';
                ctx.fill();
            }

            // Username
            ctx.textAlign = 'left';
            ctx.font = 'bold 24px Sans';
            ctx.fillStyle = user.hasGoldenName ? '#FFD700' : '#FFFFFF';

            let nameText = user.username;
            if (user.hasVipBadge) nameText = '⭐ ' + nameText;

            ctx.fillText(nameText, 190, y + 45);

            // Balance
            ctx.textAlign = 'right';
            ctx.font = 'bold 24px Sans';
            ctx.fillStyle = '#00d4ff'; // Tech blue

            // compact format
            const formattedBalance = this.formatNumber(user.balance);
            ctx.fillText(`${formattedBalance} SB`, this.width - 40, y + 45);

            y += rowHeight;
        }

        // Footer
        ctx.fillStyle = '#888';
        ctx.font = '14px Sans';
        ctx.textAlign = 'center';
        ctx.fillText(`Generated by Jarvis • ${new Date().toLocaleTimeString()}`, this.width / 2, totalHeight - 10);

        return canvas.toBuffer();
    }

    formatNumber(num) {
        if (!num) return '0';
        if (num >= 1e15) return (num / 1e15).toFixed(2) + 'Q';
        if (num >= 1e12) return (num / 1e12).toFixed(2) + 'T';
        if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
        if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
        if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
        return num.toLocaleString();
    }
}

module.exports = new ImageGenerator();
