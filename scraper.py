import urllib
import urllib.parse
import urllib.request
import re
import jsonlines
import json
import sys

def get_page(url, max_retries=3):
    for attempt in range(max_retries):
        try:
            opener = urllib.request.build_opener()
            opener.addheaders = [
                (
                    "User-Agent",
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
                )
            ]
            urllib.request.install_opener(opener)
            
            # Add timeout to prevent hanging
            response = urllib.request.urlopen(url, timeout=30)
            return response.read()
        except Exception as e:
            print(f"Error fetching {url} (attempt {attempt + 1}/{max_retries}): {e}")
            if attempt < max_retries - 1:
                import time
                time.sleep(2)  # Wait before retry
            else:
                print(f"Failed to fetch {url} after {max_retries} attempts")
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
    content = re.sub(r'\[\[File:(?:[^\s]|[\s])+\]\]', '', content)  # Remove file links
    content = re.sub(r'\{\{(?:Machine|STFRCustom|TERF_Logistics_Machine_Infobox_Template|Block|Liquid|Addon|(?:The M.C.F.R))([^\}]+)\}\}', '\1', content)
    content = re.sub(r'\|([^\=\|]]+)\=', '\n: ', content)  # Replace infobox parameters.
    content = re.sub(r'===([^=]+)===', r'###\1', content)  # Replace heading 3s
    content = re.sub(r'==([^=]+)==', r'##\1', content)  # Replace heading 2s
    content = re.sub(r'=([^=]+)=', r'#\1', content)  # Replace heading 1s
    content = re.sub(r'<big>((?:[^\s]|[\s])+)</big>', r'##\1', content)  # Replace big tags
    content = re.sub(r'<small>((?:[^\s]|[\s])+)</small>', r'-#\1', content)  # Replace small tags
    content = re.sub(r'\[http[^\s]+\s([^\s]]+)\]', r'\1', content)  # Replace external links with text
    content = re.sub(r'\[http[^\s]]+\]', '', content)  # Remove external links without text
    content = re.sub(r'<br\s?/?>', '', content)  # Repmove HTML line breaks.
    content = re.sub(r'\'\'\'\'\'([^\']+?)\'\'\'\'', r'***\1***', content)  # Replace bold italics
    content = re.sub(r'\'\'\'([^\']+?)\'\'\'', r'**\1**', content)  # Replace bold
    content = re.sub(r'\'\'([^\']+?)\'\'', r'*\1*', content)  # Replace italics
    content = re.sub(r'\[\[Category:(?:[^\s]|[\s])+\]\]', '', content) # Remove categories
    def wikilinkparsel(match):
        return f"[{match.group(2)}]({wikilink}{match.group(1).replace(' ', '_')})"
    def wikilinkparses(match):
        return f"[{match.group(1)}]({wikilink}{match.group(1).replace(' ', '_')})"
    content = re.sub(r'\[\[([^\|]+?)\|([^\|]+?)\]\]', wikilinkparsel, content)  # Replace piped links
    content = re.sub(r'\[\[([^\|]+?)\]\]', wikilinkparses, content)  # Replace unpiped links
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

    if use_new_wiki:
        start_marker = '<div id="mw-content-text" class="mw-body-content">'
        end_marker = '</ul></div></div></div>\n</div></div>'
    else:
        start_marker = '<div class="category-page__members">'
        end_marker = '					</li>\n			</ul>\n		</div>\n	</div>'

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
        links = re.findall(r'<a href=\"/wiki/([^\"]+)\" title=\"[^\"]+\">', content)
    else:
        links = re.findall(r'<a href=\"/wiki/([^\"]+)\"', content)
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

def get_wiki_search_content(search_query, use_new_wiki=True):
    if use_new_wiki:
        base_url = "https://trotywiki.miraheze.org/w/"
        search_url = base_url + "index.php?search=" + urllib.parse.quote(search_query) + "&title=Special%3ASearch"
    else:
        base_url = "https://terf.fandom.com/wiki/"
        search_url = base_url + "Special:Search?scope=internal&navigationSearch=true&query=" + urllib.parse.quote(search_query)
    HTMLBC = get_page(search_url)

    if HTMLBC is None:
        print(f"Page Special:Search not found. It may not exist.")
        return None
    
    HTMLStr = HTMLBC.decode("utf8")

    if use_new_wiki:
        start_marker = '<div class="mw-search-results-container">'
        end_marker = '</li></ul></div>'
    else:
        start_marker = '<div class="unified-search__layout__main">'
        end_marker = '<div class="unified-search__pagination">\n									</div>\n					</div>'
    
    start_index = HTMLStr.find(start_marker)
    if start_index == -1:
        print(f"Could not find search results. None present?")
        return None
    end_index = HTMLStr.find(end_marker, start_index)
    if end_index == -1:
        print(f"Found invalid search results. None present?")
        return None

    return HTMLStr[start_index + len(start_marker):end_index]

def parse_search_markup(content, use_new_wiki=True):
    if use_new_wiki:
        links = re.findall(r'<a href="/wiki/([^\"]+)" title="[^\"]+" data-serp-pos="[0-9]+">', content)
    else:
        links = re.findall(r'<a href="https://terf.fandom.com/wiki/([^\"]+)"', content)
    return (None, links)

def scrape_wiki_pages(starting_page_title, use_new_wiki=True, no_link_repeat=False, is_search_query=False):
    try:
        if use_new_wiki:
            wikilink = "https://trotywiki.miraheze.org/wiki/"
        else:
            wikilink = "https://terf.fandom.com/wiki/"
        page_contents = {}
        page_queue = [starting_page_title]
        page_queue_index = 0
        max_pages = 20  # Limit to prevent infinite loops
        processed_pages = 0
        
        while page_queue_index < len(page_queue) and processed_pages < max_pages:
            if page_queue_index >= len(page_queue):
                break
            current_page_title = page_queue[page_queue_index]
            
            try:
                if current_page_title in page_contents:
                    page_queue_index += 1
                    print(f"Found duplicate queue data. {current_page_title} appears twice or more!")
                    continue
                if current_page_title.lower() == "troty_energy_research_facility_wiki":
                    page_queue_index += 1
                    print(f"Skipping main page. ({current_page_title})")
                    continue
                    
                print(f"Scraping page: {current_page_title}")
                processed_pages += 1
                
                # Initialize variables
                raw_content = None
                raw_category_content = None
                raw_special_content = None
                raw_search_content = None
                
                try:
                    if current_page_title.startswith("Category:"):
                        raw_category_content = get_wiki_category_content(current_page_title, use_new_wiki)
                        raw_content = get_wiki_page_content(current_page_title, use_new_wiki)
                    elif current_page_title.startswith("Special:AllPages"):
                        raw_special_content = get_wiki_special_content(current_page_title, use_new_wiki)
                    elif is_search_query and page_queue_index == 0:
                        raw_search_content = get_wiki_search_content(current_page_title, use_new_wiki)
                    else:
                        raw_content = get_wiki_page_content(current_page_title, use_new_wiki)
                except Exception as e:
                    print(f"Error fetching content for {current_page_title}: {e}")
                    page_queue_index += 1
                    continue
                
                # Handle None content gracefully
                if current_page_title.startswith("Category:"):
                    if raw_category_content is None:
                        print(f"{current_page_title} category content returned an error. Data may be incomplete.")
                        raw_category_content = ""
                    if raw_content is None:
                        print(f"{current_page_title} page content returned an error. Data may be incomplete.")
                        raw_content = ""
                elif current_page_title.startswith("Special:AllPages"):
                    if raw_special_content is None:
                        print(f"{current_page_title} special content returned an error. Data may be incomplete.")
                        raw_special_content = ""
                elif is_search_query and page_queue_index == 0:
                    if raw_search_content is None:
                        print(f"{current_page_title} search content returned an error. Data may be incomplete.")
                        raw_search_content = ""
                else:
                    if raw_content is None:
                        print(f"{current_page_title} page content returned an error. Data may be incomplete.")
                        raw_content = ""
                
                # Parse content
                try:
                    if current_page_title.startswith("Category:"):
                        parsed_content, page_links = parse_wiki_markup(raw_content, wikilink)
                        links = parse_category_markup(raw_category_content)[1]
                        links.extend(page_links)
                    elif current_page_title.startswith("Special:AllPages"):
                        parsed_content, links = parse_special_markup(raw_special_content)
                    elif is_search_query and page_queue_index == 0:
                        parsed_content, links = parse_search_markup(raw_search_content, use_new_wiki)
                    else:
                        parsed_content, links = parse_wiki_markup(raw_content, wikilink)
                except Exception as e:
                    print(f"Error parsing content for {current_page_title}: {e}")
                    page_queue_index += 1
                    continue
                
                # Handle redirects and search queries
                if len(links) == 1 and parsed_content is None and not (is_search_query and page_queue_index == 0):
                    if links and links[0] not in page_queue and links[0] not in page_contents:
                        page_queue.append(links[0])
                    page_queue_index += 1
                    print(f"{current_page_title} is a redirect to {links[0]}.")
                    continue
                elif is_search_query and page_queue_index == 0:
                    # Add all search results to the queue, not just the first one
                    for link in links:
                        if link not in page_queue and link not in page_contents:
                            page_queue.append(link)
                    page_queue_index += 1
                    print(f"{current_page_title} is a search query. Found {len(links)} results.")
                    continue
                
                # Store page content
                if parsed_content and parsed_content.strip():
                    page_contents[current_page_title] = parsed_content
                
                # Add links to queue
                if no_link_repeat:
                    page_queue_index += 1
                    continue
                    
                for link in links:
                    if link not in page_queue and link not in page_contents:
                        page_queue.append(link)
                page_queue_index += 1
                
            except Exception as e:
                print(f"Error processing page {current_page_title}: {e}")
                page_queue_index += 1
                continue
                
        return page_contents
        
    except Exception as e:
        print(f"Critical error in scrape_wiki_pages: {e}")
        return {}

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

def scrape_and_save(starting_page_title, use_new_wiki=True, reset_file=True, no_link_repeat=False, is_search_query=False):
    pages = scrape_wiki_pages(starting_page_title, use_new_wiki, no_link_repeat, is_search_query)
    pages = formatJson(pages)
    
    # Output JSONL to stdout for Node.js integration
    for page in pages:
        print(json.dumps(page))
    
    # Also save to file as backup (optional)
    if reset_file:
        with jsonlines.open('data.jsonl', 'w') as writer:
            writer.write_all(pages)
    else:
        with jsonlines.open('data.jsonl', 'a') as writer:
            writer.write_all(pages)

if __name__ == "__main__":
    try:
        if len(sys.argv) <= 1:
            print("Usage: python scraper.py <StartingPageTitle> [--old-wiki] [--no-reset] [--no-link-repeat] [--search-query]")
            sys.exit(1)
        starting_page = sys.argv[1]
        use_new_wiki = True
        reset_file = True
        no_link_repeat = False
        is_search_query = False
        
        # Parse arguments with error handling
        try:
            if len(sys.argv) >= 3:
                if sys.argv[2] == '--old-wiki':
                    use_new_wiki = False
                elif sys.argv[2] == '--no-reset':
                    reset_file = False
                elif sys.argv[2] == '--no-link-repeat':
                    no_link_repeat = True
                elif sys.argv[2] == '--search-query':
                    is_search_query = True
                else:
                    print("Unknown option:", sys.argv[2])
                    print("Usage: python scraper.py <StartingPageTitle> [--old-wiki] [--no-reset] [--no-link-repeat] [--search-query]")
                    sys.exit(1)
            if len(sys.argv) >= 4:
                if sys.argv[3] == '--old-wiki':
                    use_new_wiki = False
                elif sys.argv[3] == '--no-reset':
                    reset_file = False
                elif sys.argv[3] == '--no-link-repeat':
                    no_link_repeat = True
                elif sys.argv[3] == '--search-query':
                    is_search_query = True
                else:
                    print("Unknown option:", sys.argv[3])
                    print("Usage: python scraper.py <StartingPageTitle> [--old-wiki] [--no-reset] [--no-link-repeat] [--search-query]")
                    sys.exit(1)
            if len(sys.argv) >= 5:
                if sys.argv[4] == '--old-wiki':
                    use_new_wiki = False
                elif sys.argv[4] == '--no-reset':
                    reset_file = False
                elif sys.argv[4] == '--no-link-repeat':
                    no_link_repeat = True
                elif sys.argv[4] == '--search-query':
                    is_search_query = True
                else:
                    print("Unknown option:", sys.argv[4])
                    print("Usage: python scraper.py <StartingPageTitle> [--old-wiki] [--no-reset] [--no-link-repeat] [--search-query]")
                    sys.exit(1)
            if len(sys.argv) == 6:
                if sys.argv[5] == '--old-wiki':
                    use_new_wiki = False
                elif sys.argv[5] == '--no-reset':
                    reset_file = False
                elif sys.argv[5] == '--no-link-repeat':
                    no_link_repeat = True
                elif sys.argv[5] == '--search-query':
                    is_search_query = True
                else:
                    print("Unknown option:", sys.argv[5])
                    print("Usage: python scraper.py <StartingPageTitle> [--old-wiki] [--no-reset] [--no-link-repeat] [--search-query]")
                    sys.exit(1)
        except Exception as e:
            print(f"Error parsing arguments: {e}")
            sys.exit(1)
        
        # Execute scraping with comprehensive error handling
        try:
            scrape_and_save(starting_page, use_new_wiki, reset_file, no_link_repeat, is_search_query)
        except Exception as e:
            print(f"Error during scraping: {e}")
            # Try to output at least some basic data
            try:
                basic_data = [{"title": "Error", "content": f"Scraping failed: {str(e)}"}]
                for item in basic_data:
                    print(json.dumps(item))
            except:
                pass
            sys.exit(1)
            
    except Exception as e:
        print(f"Critical error in main: {e}")
        # Last resort - output empty result
        try:
            empty_data = [{"title": "Error", "content": "Critical error occurred"}]
            for item in empty_data:
                print(json.dumps(item))
        except:
            pass
        sys.exit(1)