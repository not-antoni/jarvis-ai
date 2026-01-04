"""
TERF Wiki Discord Bot - Answers questions using RAG in DMs.
Command: !terf <question>
"""
import json
import discord
from discord.ext import commands
import asyncio
import warnings
warnings.filterwarnings('ignore')

from rag import WikiRAG

# Load config
with open("config.json", "r") as f:
    CONFIG = json.load(f)

# Bot setup
intents = discord.Intents.default()
intents.message_content = True  # Required for server commands
intents.dm_messages = True

bot = commands.Bot(command_prefix="!", intents=intents)

# Global RAG instance (loaded on startup)
rag = None


@bot.event
async def on_ready():
    global rag
    print(f"🤖 Loading RAG system...")
    rag = WikiRAG()
    print(f"✅ Bot ready as {bot.user}")
    print(f"   Listening for !terf commands in DMs")


@bot.command(name="terf")
async def terf_command(ctx, *, question: str = None):
    """Answer TERF wiki questions. Usage: !terf <question>"""
    
    # Only respond in DMs
    if not isinstance(ctx.channel, discord.DMChannel):
        return
    
    if not question:
        await ctx.reply("❓ Usage: `!terf <your question>`\nExample: `!terf What is the Arc Furnace?`")
        return
    
    if not rag:
        await ctx.reply("⏳ Still loading, please wait...")
        return
    
    # Show typing indicator while processing
    async with ctx.typing():
        try:
            # Run RAG in thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            answer, sources = await loop.run_in_executor(None, rag.answer, question)
            
            # Format response
            response = f"**Answer:**\n{answer}"
            
            if sources:
                source_links = "\n".join([f"• [{s['title']}]({s['url']})" for s in sources[:3]])
                response += f"\n\n**Sources:**\n{source_links}"
            
            # Discord message limit is 2000 chars
            if len(response) > 1900:
                response = response[:1900] + "..."
            
            await ctx.reply(response)
            
        except Exception as e:
            await ctx.reply(f"❌ Error: {str(e)[:200]}")


@bot.event
async def on_message(message):
    # Ignore bot's own messages
    if message.author == bot.user:
        return
    
    # Process commands
    await bot.process_commands(message)


def main():
    print("🚀 Starting TERF Wiki Bot...")
    bot.run(CONFIG["discord_token"])


if __name__ == "__main__":
    main()
