/**
 * Image Generator Service
 * Generates dynamic images for the bot (Leaderboards, Rank Cards, etc.)
 */

const { createCanvas, loadImage, registerFont } = require('canvas');
const GifEncoder = require('gif-encoder-2');
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

        // Preload all avatars in parallel with timeout for speed
        const avatarPromises = users.map(async (user) => {
            if (!user.avatar) return null;
            try {
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('timeout')), 2000)
                );
                return await Promise.race([loadImage(user.avatar), timeoutPromise]);
            } catch {
                return null;
            }
        });
        const avatarImages = await Promise.all(avatarPromises);

        for (let i = 0; i < users.length; i++) {
            const user = users[i];
            const avatarImg = avatarImages[i];
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

            // Avatar (Circle) - use preloaded image
            const avatarSize = 60;
            const avatarX = 110;
            const avatarY = y + 5;

            if (avatarImg) {
                ctx.save();
                ctx.beginPath();
                ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2, true);
                ctx.closePath();
                ctx.clip();
                ctx.drawImage(avatarImg, avatarX, avatarY, avatarSize, avatarSize);
                ctx.restore();

                // Border around avatar
                ctx.beginPath();
                ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2, true);
                ctx.lineWidth = 2;
                ctx.strokeStyle = isTop3 ? (user.rank === 1 ? '#FFD700' : user.rank === 2 ? '#C0C0C0' : '#CD7F32') : '#555';
                ctx.stroke();
            } else {
                // Fallback circle if no avatar
                ctx.beginPath();
                ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
                ctx.fillStyle = '#333';
                ctx.fill();
            }

            // Username
            ctx.textAlign = 'left';
            ctx.font = 'bold 24px Sans';

            // Gold for VIPs or Golden Name owners
            if (user.hasVipBadge || user.hasGoldenName) {
                ctx.fillStyle = '#FFD700';
                ctx.shadowColor = 'rgba(255, 215, 0, 0.6)'; // Glow for VIPs
                ctx.shadowBlur = 10;
            } else {
                ctx.fillStyle = '#FFFFFF';
                ctx.shadowBlur = 0;
            }

            // Remove emoji characters that might cause rendering issues on VPS
            // and don't add the star prefix
            let nameText = user.username.replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g, '');

            ctx.fillText(nameText, 190, y + 45);
            ctx.shadowBlur = 0; // Reset shadow for next items

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

    /**
     * Generate Animated Leaderboard GIF
     * @param {Array} users 
     * @returns {Promise<Buffer>}
     */
    async generateLeaderboardGif(users) {
        const rowHeight = 80;
        const headerHeight = 120;
        const padding = 20;
        // Optimize: Reduce width for faster generation
        const width = 600;
        const totalHeight = Math.max(this.height, headerHeight + (users.length * rowHeight) + padding);

        // Preload avatars (same as static)
        const avatarPromises = users.map(async (user) => {
            if (!user.avatar) return null;
            try {
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('timeout')), 2000)
                );
                return await Promise.race([loadImage(user.avatar), timeoutPromise]);
            } catch { return null; }
        });
        const avatarImages = await Promise.all(avatarPromises);

        // Pre-calculate truncated names to save CPU in loop
        const tempCanvas = createCanvas(width, 100);
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.font = 'bold 24px Sans';

        const truncatedNames = users.map(user => {
            let name = user.username.replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g, '');
            const maxNameWidth = 220;
            if (tempCtx.measureText(name).width > maxNameWidth) {
                while (tempCtx.measureText(name + '...').width > maxNameWidth && name.length > 0) {
                    name = name.slice(0, -1);
                }
                name += '...';
            }
            return name;
        });

        // Setup GIF Encoder
        const encoder = new GifEncoder(width, totalHeight);
        encoder.start();
        encoder.setRepeat(0);   // Loop forever
        encoder.setDelay(100);  // 100ms

        // OPTIMIZATION: Lower quality number is SLOWER (1 is best/slowest, 20 is fast/decent)
        // Changed from 5 to 20 to speed up encoding significantly
        encoder.setQuality(20);

        // Generate 10 frames (1 second loop) - Faster than 15
        const totalFrames = 10;
        const canvas = createCanvas(width, totalHeight);
        const ctx = canvas.getContext('2d');

        for (let frame = 0; frame < totalFrames; frame++) {
            // --- Background ---
            // Subtle shifting gradient
            const shift = (frame / totalFrames);
            const gradient = ctx.createLinearGradient(0, 0, 0, totalHeight);
            // Slight color pulse
            gradient.addColorStop(0, '#0f0c29');
            gradient.addColorStop(0.5 + (Math.sin(frame * 0.5) * 0.05), '#302b63');
            gradient.addColorStop(1, '#24243e');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, width, totalHeight);

            // Grid
            ctx.strokeStyle = `rgba(255, 255, 255, ${0.03 + (Math.sin(frame * 0.5) * 0.01)})`; // Pulse grid opacity
            ctx.lineWidth = 1;
            for (let i = 0; i < width; i += 40) {
                ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, totalHeight); ctx.stroke();
            }
            for (let i = 0; i < totalHeight; i += 40) {
                ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(width, i); ctx.stroke();
            }

            // --- Header ---
            // Title Glow Pulse
            const titleGlow = 15 + (Math.sin(frame * 0.5) * 5);
            ctx.fillStyle = '#FFD700';
            ctx.shadowColor = 'rgba(255, 215, 0, 0.5)';
            ctx.shadowBlur = titleGlow;
            ctx.font = 'bold 40px Sans';
            ctx.textAlign = 'center';
            ctx.fillText('STARK INDUSTRIES', width / 2, 50);

            ctx.fillStyle = '#FFFFFF';
            ctx.shadowColor = 'rgba(0, 212, 255, 0.5)';
            ctx.shadowBlur = 10;
            ctx.font = '30px Sans';
            ctx.fillText('TOP EARNERS', width / 2, 90);
            ctx.shadowBlur = 0;

            // --- Rows ---
            let y = headerHeight;
            for (let i = 0; i < users.length; i++) {
                const user = users[i];
                const avatarImg = avatarImages[i];
                const isTop3 = user.rank <= 3;

                // Row Background
                if (isTop3) {
                    // Shimmer effect moves across top 3 rows
                    const rowGrad = ctx.createLinearGradient(0, y, width, y);
                    const shimmerPos = (frame / totalFrames); // 0 to 1

                    rowGrad.addColorStop(0, 'rgba(255, 215, 0, 0.1)');
                    // Moving highlight
                    rowGrad.addColorStop(Math.max(0, Math.min(1, shimmerPos)), 'rgba(255, 215, 0, 0.3)');
                    rowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
                    ctx.fillStyle = rowGrad;
                    ctx.fillRect(10, y, width - 20, rowHeight - 10);
                } else {
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
                    ctx.fillRect(10, y, width - 20, rowHeight - 10);
                }

                // Rank
                ctx.font = 'bold 30px Sans';
                ctx.textAlign = 'center';
                // Rank color logic
                if (user.rank === 1) ctx.fillStyle = '#FFD700';
                else if (user.rank === 2) ctx.fillStyle = '#C0C0C0';
                else if (user.rank === 3) ctx.fillStyle = '#CD7F32';
                else ctx.fillStyle = '#FFFFFF';

                ctx.fillText(`#${user.rank}`, 60, y + 50);

                // Avatar
                const avatarSize = 60;
                const avatarX = 110;
                const avatarY = y + 5;
                if (avatarImg) {
                    ctx.save();
                    ctx.beginPath(); ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2, true);
                    ctx.closePath(); ctx.clip();
                    ctx.drawImage(avatarImg, avatarX, avatarY, avatarSize, avatarSize);
                    ctx.restore();
                    // Border
                    ctx.beginPath(); ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2, true);
                    ctx.lineWidth = 2;
                    ctx.strokeStyle = isTop3 ? (user.rank === 1 ? '#FFD700' : user.rank === 2 ? '#C0C0C0' : '#CD7F32') : '#555';
                    ctx.stroke();
                } else {
                    ctx.beginPath(); ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
                    ctx.fillStyle = '#333'; ctx.fill();
                }

                // Username
                ctx.textAlign = 'left';
                ctx.font = 'bold 24px Sans';
                if (user.hasVipBadge || user.hasGoldenName) {
                    ctx.fillStyle = '#FFD700';
                    // Pulsing Glow for VIPs
                    const glow = 10 + (Math.sin(frame * 0.8) * 5);
                    ctx.shadowColor = 'rgba(255, 215, 0, 0.8)';
                    ctx.shadowBlur = glow;
                } else {
                    ctx.fillStyle = '#FFFFFF';
                    ctx.shadowBlur = 0;
                }
                const nameText = truncatedNames[i];
                ctx.fillText(nameText, 190, y + 45);
                ctx.shadowBlur = 0; // Reset

                // Balance
                ctx.textAlign = 'right';
                ctx.font = 'bold 24px Sans';
                ctx.fillStyle = '#00d4ff';
                const formattedBalance = this.formatNumber(user.balance);
                ctx.fillText(`${formattedBalance} SB`, width - 40, y + 45);

                y += rowHeight;
            }

            // Footer
            ctx.fillStyle = '#888';
            ctx.font = '14px Sans';
            ctx.textAlign = 'center';
            ctx.fillText(`Generated by Jarvis • ${new Date().toLocaleTimeString()}`, width / 2, totalHeight - 10);

            encoder.addFrame(ctx);
        }

        encoder.finish();
        return encoder.out.getData();
    }

    /**
     * Generate Profile Card Image (Static)
     * @param {Object} user - { username, balance, avatar, rank, totalEarned, winRate }
     * @returns {Promise<Buffer>}
     */
    async generateProfileImage(user) {
        const width = 800;
        const height = 400;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        // --- Background ---
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, '#141E30');
        gradient.addColorStop(1, '#243B55');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);

        // Tech Hexagons/Grid
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.lineWidth = 1;
        for (let i = 0; i < width; i += 50) {
            ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, height); ctx.stroke();
        }

        // --- Card Header "ACCESS GRANTED" ---
        ctx.fillStyle = '#00ffaa';
        ctx.font = '16px Sans';
        ctx.textAlign = 'right';
        ctx.fillText('STARK IDENTITY CARD // VERIFIED', width - 30, 30);

        // --- Avatar ---
        const avatarSize = 150;
        const avatarX = 50;
        const avatarY = height / 2 - avatarSize / 2;

        try {
            if (user.avatar) {
                const avatar = await loadImage(user.avatar);
                ctx.save();
                ctx.beginPath();
                ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
                ctx.closePath();
                ctx.clip();
                ctx.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize);
                ctx.restore();

                // Avatar Hologram Ring
                ctx.beginPath();
                ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2 + 10, 0, Math.PI * 2);
                ctx.lineWidth = 3;
                ctx.strokeStyle = '#00d4ff'; // Cyan
                ctx.shadowColor = '#00d4ff';
                ctx.shadowBlur = 15;
                ctx.stroke();
                ctx.shadowBlur = 0;
            }
        } catch (e) {
            // Fallback
            ctx.beginPath();
            ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
            ctx.fillStyle = '#333';
            ctx.fill();
        }

        // --- User Info ---
        const textX = 250;

        // Name
        ctx.textAlign = 'left';
        ctx.font = 'bold 45px Sans';
        ctx.fillStyle = '#FFFFFF';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 4;
        const safeName = user.username.replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g, '');
        ctx.fillText(safeName, textX, 120);
        ctx.shadowBlur = 0;

        // Rank Badge
        if (user.rank) {
            ctx.fillStyle = '#FFD700'; // Gold
            ctx.font = 'bold 24px Sans';
            ctx.fillText(`RANK #${user.rank}`, textX, 160);
        }

        // Stats Block
        const statsY = 230;

        // Balance
        ctx.fillStyle = '#888';
        ctx.font = '20px Sans';
        ctx.fillText('CURRENT BALANCE', textX, statsY);

        ctx.fillStyle = '#00d4ff';
        ctx.font = 'bold 50px Sans';
        ctx.fillText(this.formatNumber(user.balance) + ' SB', textX, statsY + 50);

        // Sidebar Stats
        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.fillRect(550, 100, 2, 200); // Divider

        const rightX = 580;
        ctx.fillStyle = '#aaa';
        ctx.font = '18px Sans';
        ctx.fillText('TOTAL EARNED', rightX, 150);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 24px Sans';
        ctx.fillText(this.formatNumber(user.totalEarned || 0), rightX, 180);

        ctx.fillStyle = '#aaa';
        ctx.font = '18px Sans';
        ctx.fillText('WIN RATE', rightX, 240);
        ctx.fillStyle = (user.winRate > 50 ? '#2ecc71' : '#e74c3c'); // Green/Red
        ctx.font = 'bold 24px Sans';
        ctx.fillText((user.winRate || 0) + '%', rightX, 270);

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
