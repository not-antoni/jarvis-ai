"""
TERF Wiki Auto-Updater - Checks for wiki changes and updates data if needed.
Run periodically (e.g., via cron) to keep data fresh.
"""
import requests
import json
import hashlib
import os
from scraper import main as run_scraper

API_URL = "https://trotywiki.miraheze.org/w/api.php"
DATA_FILE = "data/wiki_pages.json"
HASH_FILE = "data/.wiki_hash"
USER_AGENT = "TrotyWikiBot/1.0 (Authorized by owner)"


def get_wiki_revision_hash():
    """Get a hash of recent wiki changes to detect updates."""
    params = {
        "action": "query",
        "format": "json",
        "list": "recentchanges",
        "rclimit": 50,
        "rcprop": "ids|timestamp"
    }
    
    try:
        response = requests.get(API_URL, params=params, headers={"User-Agent": USER_AGENT}, timeout=10)
        data = response.json()
        
        if "query" in data and "recentchanges" in data["query"]:
            # Create hash from recent change IDs and timestamps
            changes = data["query"]["recentchanges"]
            content = json.dumps(changes, sort_keys=True)
            return hashlib.md5(content.encode()).hexdigest()
    except Exception as e:
        print(f"⚠️ Error checking wiki: {e}")
    
    return None


def check_and_update():
    """Check if wiki has changed and update data if needed."""
    print("🔍 Checking for wiki updates...")
    
    current_hash = get_wiki_revision_hash()
    if not current_hash:
        print("❌ Could not check wiki status")
        return False
    
    # Load previous hash
    previous_hash = None
    if os.path.exists(HASH_FILE):
        with open(HASH_FILE, "r") as f:
            previous_hash = f.read().strip()
    
    if current_hash == previous_hash:
        print("✅ Wiki is up to date, no changes needed")
        return False
    
    # Wiki has changed - run scraper
    print("📥 Wiki has changed! Updating data...")
    run_scraper()
    
    # Save new hash
    with open(HASH_FILE, "w") as f:
        f.write(current_hash)
    
    # Delete FAISS index to force rebuild
    index_file = "data/wiki_index.faiss"
    if os.path.exists(index_file):
        os.remove(index_file)
        print("🗑️ Cleared vector index (will rebuild on next bot start)")
    
    print("✅ Data updated successfully!")
    return True


if __name__ == "__main__":
    check_and_update()
