import urllib
import urllib.parse
import urllib.request
import re
import sys

# Only import jsonlines when needed for file operations
try:
    import jsonlines
    JSONLINES_AVAILABLE = True
except ImportError:
    JSONLINES_AVAILABLE = False

def get_page(url):
    try:
        opener = urllib.request.build_opener()
        opener.addheaders = [
            (
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
            )
        ]
        urllib.request.install_opener(opener)
        response = urllib.request.urlopen(url)
        return response.read()
    except Exception as e:
        print(f"Error fetching {url}: {e}")
        return None
    
def get_wiki_page_content(page_title, use_new_wiki=True):
    if use_new_wiki:
        base_url = "https://trotywiki.miraheze.org/wiki/"
    else:
        base_url = "https://terf.fandom.com/wiki/"
    page_url = base_url + urllib.parse.quote(page_title)
    edit_url = page_url + "?action=edit"
    HTMLBC = get_page(edit_url)

    if HTMLBC is None:
        print(f"Page {page_title} not found. It may not exist.")
        return None
    
    HTMLStr = HTMLBC.decode("utf8")

    start_marker = 'name="wpTextbox1">'
    end_marker = '</textarea>'

    start_index = HTMLStr.find(start_marker)
    if start_index == -1:
        print(f"Text content not found in the page for {page_title}.")
        return None
    
    end_index = HTMLStr.find(end_marker, start_index)
    if end_index == -1:
        print(f"Found invalid text content in the page for {page_title}.")
        return None
    
    return HTMLStr[start_index + len(start_marker):end_index]

def parse_wiki_markup(content, wikilink):
    links = re.findall(r'\[\[([^\|])(?:|[^\|])?\]\]', content)
    if content.find('#REDIRECT') != -1:
        print("This page is a redirect.")
        return (None, [re.sub(r'\[\[|\]\]', '', content[content.find('#REDIRECT') + len('#REDIRECT '):content.find(']]')])])
    
    # Remove template syntax and HTML entities
    content = re.sub(r'\[\[File:(?:[^\s]|[\s])+\]\]', '', content)  # Remove file links
    content = re.sub(r'\{\{[^}]+\}\}', '', content)  # Remove all template syntax {{...}}
    content = re.sub(r'&lt;', '<', content)  # Decode HTML entities
    content = re.sub(r'&gt;', '>', content)
    content = re.sub(r'&amp;', '&', content)
    content = re.sub(r'&quot;', '"', content)
    
    # Remove HTML tags and their content
    content = re.sub(r'<[^>]+>', '', content)  # Remove all HTML tags
    
    # Clean up wiki markup
    content = re.sub(r'\|([^\=\|]]+)\=', '\n: ', content)  # Replace infobox parameters.
    content = re.sub(r'===([^=]+)===', r'###\1', content)  # Replace heading 3s
    content = re.sub(r'==([^=]+)==', r'##\1', content)  # Replace heading 2s
    content = re.sub(r'=([^=]+)=', r'#\1', content)  # Replace heading 1s
    content = re.sub(r'<big>((?:[^\s]|[\s])+)</big>', r'##\1', content)  # Replace big tags
    content = re.sub(r'<small>((?:[^\s]|[\s])+)</small>', r'-#\1', content)  # Replace small tags
    content = re.sub(r'\[http[^\s]+\s([^\s]]+)\]', r'\1', content)  # Replace external links with text
    content = re.sub(r'\[http[^\s]]+\]', '', content)  # Remove external links without text
    content = re.sub(r'<br\s?/?>', '', content)  # Remove HTML line breaks.
    content = re.sub(r'\'\'\'\'\'([^\']+?)\'\'\'\'', r'***\1***', content)  # Replace bold italics
    content = re.sub(r'\'\'\'([^\']+?)\'\'\'', r'**\1**', content)  # Replace bold
    content = re.sub(r'\'\'([^\']+?)\'\'', r'*\1*', content)  # Replace italics
    content = re.sub(r'\[\[Category:(?:[^\s]|[\s])+\]\]', '', content) # Remove categories
    
    # Handle wiki links
    def wikilinkparsel(match):
        return f"[{match.group(2)}]({wikilink}{match.group(1).replace(' ', '_')})"
    def wikilinkparses(match):
        return f"[{match.group(1)}]({wikilink}{match.group(1).replace(' ', '_')})"
    content = re.sub(r'\[\[([^\|]+?)\|([^\|]+?)\]\]', wikilinkparsel, content)  # Replace piped links
    content = re.sub(r'\[\[([^\|]+?)\]\]', wikilinkparses, content)  # Replace unpiped links
    
    # Final cleanup
    content = re.sub(r'\u0001', '', content)  # Remove \u0001 characters
    content = re.sub(r'^[\s]+', '', content)  # Remove leading spaces
    content = re.sub(r'[\s]+$', '', content)  # Remove trailing spaces
    content = re.sub(r'[\s]+', ' ', content)  # Normalize whitespace
    
    return (content, links)

def get_wiki_category_content(page_title, use_new_wiki=True):
    if use_new_wiki:
        base_url = "https://trotywiki.miraheze.org/wiki/"
    else:
        base_url = "https://terf.fandom.com/wiki/"
    page_url = base_url + urllib.parse.quote(page_title)
    HTMLBC = get_page(page_url)

    if HTMLBC is None:
        print(f"Page {page_title} not found. It may not exist.")
        return None
    
    HTMLStr = HTMLBC.decode("utf8")

    start_marker = '<div id="mw-content-text" class="mw-body-content">'
    if use_new_wiki:
        end_marker = '</ul></div></div></div>\n</div></div>'
    else:
        end_marker = '</li>\n			</ul>\n		</div>\n	</div>'

    start_index = HTMLStr.find(start_marker)
    if start_index == -1:
        print(f"Text content not found in the page for {page_title}.")
        return None
    
    end_index = HTMLStr.find(end_marker, start_index)
    if end_index == -1:
        print(f"Found invalid text content in the page for {page_title}.")
        return None
    
    return HTMLStr[start_index + len(start_marker):end_index]

def parse_category_markup(content, use_new_wiki=True):
    if use_new_wiki:
        links = re.findall(r'<a href="/wiki/([^\"]+)" title="[^\"]+">', content)
    else:
        links = re.findall(r'<a href="/wiki/([^\"]+)" class="category-page__member-link" title="[^\"]+">', content)
    return (None, links)

def get_wiki_special_content(page_title, use_new_wiki=True):
    if use_new_wiki:
        base_url = "https://trotywiki.miraheze.org/wiki/"
    else:
        base_url = "https://terf.fandom.com/wiki/"
    page_url = base_url + urllib.parse.quote(page_title)
    HTMLBC = get_page(page_url)

    if HTMLBC is None:
        print(f"Page {page_title} not found. It may not exist.")
        return None
    
    HTMLStr = HTMLBC.decode("utf8")

    start_marker = '<div class="mw-allpages-body">'
    end_marker = '</li>\n</ul></div>'
    
    start_index = HTMLStr.find(start_marker)
    if start_index == -1:
        print(f"Text content not found in the page for {page_title}.")
        return None
    
    end_index = HTMLStr.find(end_marker, start_index)
    if end_index == -1:
        print(f"Found invalid text content in the page for {page_title}.")
        return None

    return HTMLStr[start_index + len(start_marker):end_index]

def parse_special_markup(content):
    links = re.findall(r'<a href="/wiki/([^\"]+)" title="[^\"]+">', content)
    return (None, links)

def scrape_wiki_pages(starting_page_title, use_new_wiki=True, no_link_repeat=False):
    if use_new_wiki:
        wikilink = "https://trotywiki.miraheze.org/wiki/"
    else:
        wikilink = "https://terf.fandom.com/wiki/"
    page_contents = {}
    page_queue = [starting_page_title]
    page_queue_index = 0
    while page_queue_index < len(page_queue):
        if page_queue_index >= len(page_queue):
            break
        current_page_title = page_queue[page_queue_index]
        # print(page_contents)
        # print(current_page_title)
        # print(page_queue)
        # print(page_queue_index)
        if current_page_title in page_contents:
            page_queue_index += 1
            print(f"Found duplicate queue data. {current_page_title} appears twice or more!")
            continue
        if current_page_title.lower() == "troty_energy_research_facility_wiki":
            page_queue_index += 1
            print(f"Skipping main page. ({current_page_title})")
            continue
        print(f"Scraping page: {current_page_title}")
        if current_page_title.startswith("Category:"):
            raw_category_content = get_wiki_category_content(current_page_title, use_new_wiki)
        if current_page_title.startswith("Special:AllPages"):
            raw_special_content = get_wiki_special_content(current_page_title, use_new_wiki)
        else:
            raw_content = get_wiki_page_content(current_page_title, use_new_wiki)
        if current_page_title.startswith("Category:"):
            if raw_category_content is None:
                print(f"{current_page_title} returned an error. Data may be incomplete.")
                raw_category_content = ""
        if current_page_title.startswith("Special:AllPages"):
            if raw_special_content is None:
                print(f"{current_page_title} returned an error. Data may be incomplete.")
                raw_special_content = ""
        else:
            if raw_content is None:
                print(f"{current_page_title} returned an error. Data may be incomplete.")
                raw_content = ""
        if current_page_title.startswith("Category:"):
            parsed_content, page_links = parse_wiki_markup(raw_content, wikilink)
            links = parse_category_markup(raw_category_content)[1]
            links.extend(page_links)
        elif current_page_title.startswith("Special:AllPages"):
            parsed_content, links = parse_special_markup(raw_special_content)
        else:
            parsed_content, links = parse_wiki_markup(raw_content, wikilink)
        if len(links) == 1 and parsed_content is None:
            if links and links[0] not in page_queue and links[0] not in page_contents:
                page_queue.append(links[0])
            page_queue_index += 1
            print(f"{current_page_title} is a redirect to {links[0]}.")
            page_contents
            continue
        page_contents[current_page_title] = parsed_content
        if no_link_repeat:
            page_queue_index += 1
            continue
        for link in links:
            if link not in page_queue and link not in page_contents:
                page_queue.append(link)
        page_queue_index += 1
    return page_contents

def formatJson(pages):
    json_list = []
    for title, content in pages.items():
        if content is None or content.strip() == "":
            continue
        json_list.append({
            "title": title.replace('_', ' '),
            "content": content
        })
    return json_list

def search_wiki_page(search_query, use_new_wiki=True):
    """Search for a page using the wiki's search functionality"""
    if use_new_wiki:
        base_url = "https://trotywiki.miraheze.org/wiki/"
        search_url = f"https://trotywiki.miraheze.org/w/index.php?search={urllib.parse.quote(search_query)}&title=Special%3ASearch&go=Go"
    else:
        base_url = "https://terf.fandom.com/wiki/"
        search_url = f"https://terf.fandom.com/wiki/Special:Search?search={urllib.parse.quote(search_query)}"
    
    HTMLBC = get_page(search_url)
    if HTMLBC is None:
        print(f"Search failed for query: {search_query}")
        return None
    
    HTMLStr = HTMLBC.decode("utf8")
    
    # Look for the first result link in the search results
    if use_new_wiki:
        # Try multiple patterns for Miraheze search results
        patterns = [
            r'<a href="/wiki/([^"]+)" title="[^"]*"[^>]*class="mw-search-result-heading"',
            r'<a href="/wiki/([^"]+)"[^>]*class="mw-search-result-heading"',
            r'<a href="/wiki/([^"]+)"[^>]*class="mw-search-result-title"',
            r'href="/wiki/([^"]+)"[^>]*>.*?{re.escape(search_query)}',
            r'href="/wiki/([^"]+)"[^>]*>.*?{search_query.lower()}'
        ]
    else:
        # Fandom search result pattern
        patterns = [
            r'<a href="/wiki/([^"]+)" title="[^"]*"[^>]*class="unified-search__result__title"',
            r'href="/wiki/([^"]+)"[^>]*class="unified-search__result__title"'
        ]
    
    matches = []
    for pattern in patterns:
        matches = re.findall(pattern, HTMLStr, re.IGNORECASE)
        if matches:
            break
    
    if matches:
        # Return the first search result
        result_title = urllib.parse.unquote(matches[0]).replace('_', ' ')
        print(f"Search '{search_query}' found: {result_title}")
        return result_title
    else:
        print(f"No search results found for: {search_query}")
        return None

def scrape_and_return_content(starting_page_title, use_new_wiki=True, no_link_repeat=False, search_query=None):
    # If search_query is provided, search for the page first
    if search_query:
        found_page = search_wiki_page(search_query, use_new_wiki)
        if found_page:
            starting_page_title = found_page
        else:
            # If search fails, try using the search query as a page title directly
            print(f"Search failed for '{search_query}', trying as direct page title")
            starting_page_title = search_query.replace(' ', '_')
    
    # Scrape the pages and get the content directly
    pages = scrape_wiki_pages(starting_page_title, use_new_wiki, no_link_repeat)
    
    # Return the first page's content directly (for single page scraping)
    if pages:
        first_page_title = list(pages.keys())[0]
        first_page_content = pages[first_page_title]
        if first_page_content:
            return first_page_title, first_page_content
        else:
            return first_page_title, "No content found for this page."
    else:
        # If no pages found, return a helpful message
        if search_query:
            return f"Search Results for '{search_query}'", f"Sorry, I couldn't find any content for '{search_query}'. The page might not exist or the wiki might be unavailable."
        else:
            return "No Results", "No pages were scraped."

def scrape_and_save(starting_page_title, use_new_wiki=True, reset_file=True, no_link_repeat=False, search_query=None):
    if not JSONLINES_AVAILABLE:
        print("Error: jsonlines module not available for file operations")
        return
    
    # If search_query is provided, search for the page first
    if search_query:
        found_page = search_wiki_page(search_query, use_new_wiki)
        if found_page:
            starting_page_title = found_page
        else:
            print(f"Search failed for '{search_query}', using original page title: {starting_page_title}")
    
    pages = scrape_wiki_pages(starting_page_title, use_new_wiki, no_link_repeat)
    pages = formatJson(pages)
    if reset_file:
        with jsonlines.open('data.jsonl', 'w') as writer:
            writer.write_all(pages)
    else:
        with jsonlines.open('data.jsonl', 'a') as writer:
            writer.write_all(pages)

if __name__ == "__main__":
    if len(sys.argv) <= 1:
        print("Usage: python scraper.py <StartingPageTitle> [--old-wiki] [--no-reset] [--no-link-repeat] [--search-query <query>] [--live-output]")
        sys.exit(1)
    
    starting_page = sys.argv[1]
    use_new_wiki = True
    reset_file = True
    no_link_repeat = False
    search_query = None
    live_output = False
    
    # Parse command line arguments
    i = 2
    while i < len(sys.argv):
        arg = sys.argv[i]
        
        if arg == '--old-wiki':
            use_new_wiki = False
        elif arg == '--no-reset':
            reset_file = False
        elif arg == '--no-link-repeat':
            no_link_repeat = True
        elif arg == '--search-query':
            if i + 1 < len(sys.argv):
                search_query = sys.argv[i + 1]
                i += 1  # Skip the next argument as it's the query value
            else:
                print("Error: --search-query requires a query value")
                print("Usage: python scraper.py <StartingPageTitle> [--old-wiki] [--no-reset] [--no-link-repeat] [--search-query <query>] [--live-output]")
                sys.exit(1)
        elif arg == '--live-output':
            live_output = True
        else:
            print("Unknown option:", arg)
            print("Usage: python scraper.py <StartingPageTitle> [--old-wiki] [--no-reset] [--no-link-repeat] [--search-query <query>] [--live-output]")
            sys.exit(1)
        
        i += 1
    
    if live_output:
        # For live output (Discord chat), return content directly
        title, content = scrape_and_return_content(starting_page, use_new_wiki, no_link_repeat, search_query)
        print(f"TITLE:{title}")
        print(f"CONTENT:{content}")
    else:
        # For file output (legacy behavior)
        scrape_and_save(starting_page, use_new_wiki, reset_file, no_link_repeat, search_query)