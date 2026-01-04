"""
TERF Wiki Scraper - Fetches all wiki content + images for RAG indexing.
"""
import requests
import json
import time
import os
import re
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urljoin

API_URL = "https://trotywiki.miraheze.org/w/api.php"
OUTPUT_FILE = "data/wiki_pages.json"
IMAGES_DIR = "data/images"
USER_AGENT = "TrotyWikiBot/1.0 (Authorized by owner)"
MAX_WORKERS = 10


def get_all_page_titles():
    """Fetch all page titles with pagination support."""
    titles = []
    params = {
        "action": "query",
        "format": "json",
        "list": "allpages",
        "apnamespace": 0,
        "aplimit": "max"
    }
    
    print("📋 Fetching page list...")
    while True:
        response = requests.get(API_URL, params=params, headers={"User-Agent": USER_AGENT})
        data = response.json()
        
        if "query" in data and "allpages" in data["query"]:
            titles.extend(page["title"] for page in data["query"]["allpages"])
        
        if "continue" in data:
            params["apcontinue"] = data["continue"]["apcontinue"]
        else:
            break
    
    return titles


def clean_content(text):
    """Clean wiki markup artifacts but PRESERVE templates/infoboxes."""
    if not text:
        return ""
    
    # Simplify links: [[Target|Label]] -> Label, [[Target]] -> Target
    # We do this carefully to not break other things
    text = re.sub(r'\[\[(?:[^|\]]*\|)?([^\]]+)\]\]', r'\1', text)
    
    # Remove == Section == markers but keep section names
    text = re.sub(r'={2,}\s*(.+?)\s*={2,}', r'\n## \1\n', text)
    
    # Remove HTML comments <!-- ... -->
    text = re.sub(r'<!--[\s\S]*?-->', '', text)
    
    # Clean up multiple newlines
    text = re.sub(r'\n{3,}', '\n\n', text)
    
    return text.strip()


def get_page_images(title):
    """Get all image URLs from a wiki page."""
    params = {
        "action": "query",
        "format": "json",
        "prop": "images",
        "titles": title,
        "imlimit": "max"
    }
    
    images = []
    try:
        response = requests.get(API_URL, params=params, headers={"User-Agent": USER_AGENT}, timeout=10)
        data = response.json()
        page = next(iter(data["query"]["pages"].values()))
        
        if "images" in page:
            for img in page["images"]:
                img_name = img["title"]
                # Get actual image URL
                img_url = get_image_url(img_name)
                if img_url:
                    images.append({
                        "name": img_name.replace("File:", ""),
                        "url": img_url
                    })
    except Exception as e:
        pass
    
    return images


def get_image_url(file_title):
    """Get direct URL to an image file."""
    params = {
        "action": "query",
        "format": "json",
        "prop": "imageinfo",
        "iiprop": "url",
        "titles": file_title
    }
    
    try:
        response = requests.get(API_URL, params=params, headers={"User-Agent": USER_AGENT}, timeout=10)
        data = response.json()
        page = next(iter(data["query"]["pages"].values()))
        if "imageinfo" in page:
            return page["imageinfo"][0]["url"]
    except:
        pass
    return None


def download_image(img_info, page_id):
    """Download an image to local storage."""
    try:
        url = img_info["url"]
        # Create safe filename
        safe_name = re.sub(r'[^\w\-.]', '_', img_info["name"])
        local_path = os.path.join(IMAGES_DIR, f"{page_id}_{safe_name}")
        
        if os.path.exists(local_path):
            return local_path
        
        response = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=30)
        if response.status_code == 200:
            with open(local_path, "wb") as f:
                f.write(response.content)
            return local_path
    except Exception as e:
        print(f"⚠️ Failed to download {img_info['name']}: {e}")
    return None


def fetch_page_content(title):
    """Fetch a single page with content, categories, and images."""
    params = {
        "action": "query",
        "format": "json",
        "prop": "revisions|categories|info",
        "rvprop": "content",
        "inprop": "url",
        "titles": title
    }
    
    try:
        response = requests.get(API_URL, params=params, headers={"User-Agent": USER_AGENT}, timeout=10)
        data = response.json()
        page = next(iter(data["query"]["pages"].values()))
        
        if "revisions" in page and page["revisions"]:
            page_id = str(page["pageid"])
            # Get raw wikitext
            raw_content = page["revisions"][0]["*"]
            content = clean_content(raw_content)
            
            # Get images
            images = get_page_images(title)
            local_images = []
            
            for img in images:
                local_path = download_image(img, page_id)
                if local_path:
                    local_images.append({
                        "name": img["name"],
                        "url": img["url"],
                        "local": local_path
                    })
            
            categories = [cat["title"].replace("Category:", "") 
                         for cat in page.get("categories", [])]
            
            return {
                "id": page_id,
                "title": page["title"],
                "url": page.get("fullurl", ""),
                "content": content,
                "categories": categories,
                "images": local_images
            }
    except Exception as e:
        print(f"⚠️ Error: {title}: {e}")
    
    return None


def main():
    os.makedirs("data", exist_ok=True)
    os.makedirs(IMAGES_DIR, exist_ok=True)
    
    titles = get_all_page_titles()
    if not titles:
        print("❌ No pages found.")
        return
    
    print(f"✅ Found {len(titles)} pages. Downloading content + images...")
    start = time.time()
    
    # Use less workers for image downloads to avoid rate limits
    with ThreadPoolExecutor(max_workers=5) as executor:
        results = [r for r in executor.map(fetch_page_content, titles) if r]
    
    # Count images
    total_images = sum(len(r.get("images", [])) for r in results)
    
    # Save as clean JSON
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    
    print(f"🎉 Scraped {len(results)} pages + {total_images} images in {time.time() - start:.1f}s")
    print(f"   → {OUTPUT_FILE}")
    print(f"   → {IMAGES_DIR}/")


if __name__ == "__main__":
    main()
