"""
TERF Wiki RAG v2 - Improved retrieval with chunking and better embeddings.
Uses Groq API for generation (lightweight, fast).
"""
import json
import os
import sys
import re
import hashlib
import numpy as np
from pathlib import Path
from sentence_transformers import SentenceTransformer
import requests

# Optional imports - graceful fallback
try:
    import faiss
    HAS_FAISS = True
except ImportError:
    HAS_FAISS = False
    print("⚠️ FAISS not available, using numpy search", file=sys.stderr)

# Load config with environment variable overrides
_config_path = Path(__file__).parent / "config.json"
with open(_config_path, "r") as f:
    CONFIG = json.load(f)

# Override with environment variables if present
if os.environ.get("TERF_GROQ_KEY"):
    CONFIG["groq_api_key"] = os.environ["TERF_GROQ_KEY"]

DATA_FILE = Path(__file__).parent / "data/wiki_pages.json"
INDEX_FILE = Path(__file__).parent / "data/wiki_index.faiss"
CHUNKS_FILE = Path(__file__).parent / "data/wiki_chunks.json"
CACHE_FILE = Path(__file__).parent / "data/answer-cache.json"
DATA_HASH_FILE = Path(__file__).parent / "data/.data_hash"

# Chunking settings
CHUNK_SIZE = 800  # chars per chunk
CHUNK_OVERLAP = 150  # overlap between chunks
MAX_CONTEXT_CHARS = 6000  # max context sent to LLM
TOP_K = 7  # number of chunks to retrieve

# Use faster embedding model (already cached on VPS, 384 dims)
EMBED_MODEL = "sentence-transformers/all-MiniLM-L6-v2"


def chunk_document(doc: dict) -> list:
    """Split a document into overlapping chunks for better retrieval."""
    title = doc["title"]
    content = doc["content"]
    url = doc.get("url", "")
    doc_id = doc.get("id", "")
    
    # If content is short, return as single chunk
    if len(content) <= CHUNK_SIZE:
        return [{
            "title": title,
            "content": content,
            "url": url,
            "doc_id": doc_id,
            "chunk_idx": 0
        }]
    
    chunks = []
    start = 0
    chunk_idx = 0
    
    while start < len(content):
        end = start + CHUNK_SIZE
        
        # Try to break at paragraph or sentence boundary
        if end < len(content):
            # Look for paragraph break
            para_break = content.rfind('\n\n', start + CHUNK_SIZE // 2, end + 100)
            if para_break > start:
                end = para_break
            else:
                # Look for sentence break
                sent_break = content.rfind('. ', start + CHUNK_SIZE // 2, end + 50)
                if sent_break > start:
                    end = sent_break + 1
        
        chunk_text = content[start:end].strip()
        if chunk_text:
            chunks.append({
                "title": title,
                "content": chunk_text,
                "url": url,
                "doc_id": doc_id,
                "chunk_idx": chunk_idx
            })
            chunk_idx += 1
        
        start = end - CHUNK_OVERLAP
        if start >= len(content) - CHUNK_OVERLAP:
            break
    
    return chunks


def compute_data_hash(documents: list) -> str:
    """Compute hash of document data to detect changes."""
    content = json.dumps(documents, sort_keys=True)
    return hashlib.md5(content.encode()).hexdigest()


class WikiRAG:
    def __init__(self):
        print("🔧 Loading embedding model (all-MiniLM-L6-v2)...", file=sys.stderr)
        self.embedder = SentenceTransformer(EMBED_MODEL)
        
        self.chunks = []
        self.chunk_embeddings = None
        self.index = None
        self._title_lookup = {}
        self._cache = self._load_cache()
        
        self._load_or_build_index()
        print(f"✅ Ready! {len(self.chunks)} chunks indexed, {len(self._cache)} cached answers.", file=sys.stderr)
    
    def _load_cache(self) -> dict:
        """Load cache from disk."""
        if CACHE_FILE.exists():
            try:
                with open(CACHE_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
            except:
                return {}
        return {}
    
    def _save_cache(self):
        """Save cache to disk."""
        try:
            # Limit cache size to 300 entries
            if len(self._cache) > 300:
                keys = list(self._cache.keys())
                for key in keys[:len(keys) - 300]:
                    del self._cache[key]
            
            with open(CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump(self._cache, f, ensure_ascii=False)
        except Exception as e:
            print(f"Warning: Failed to save cache: {e}", file=sys.stderr)
    
    def _clear_cache(self):
        """Clear answer cache (called when data changes)."""
        self._cache = {}
        if CACHE_FILE.exists():
            CACHE_FILE.unlink()
        print("🗑️ Answer cache cleared", file=sys.stderr)
    
    def _load_or_build_index(self):
        """Load existing index or build from wiki data."""
        if not DATA_FILE.exists():
            print("❌ No wiki data found. Run scraper first.", file=sys.stderr)
            return
        
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            documents = json.load(f)
        
        # Check if data has changed
        current_hash = compute_data_hash(documents)
        previous_hash = None
        if DATA_HASH_FILE.exists():
            previous_hash = DATA_HASH_FILE.read_text().strip()
        
        # Check if we have cached chunks and index
        chunks_exist = CHUNKS_FILE.exists()
        index_exists = INDEX_FILE.exists() if HAS_FAISS else False
        data_changed = current_hash != previous_hash
        
        if data_changed:
            print("📊 Wiki data changed, rebuilding index...", file=sys.stderr)
            self._clear_cache()
        
        if chunks_exist and not data_changed:
            # Load cached chunks
            with open(CHUNKS_FILE, "r", encoding="utf-8") as f:
                self.chunks = json.load(f)
            print(f"📂 Loaded {len(self.chunks)} cached chunks", file=sys.stderr)
        else:
            # Build chunks from documents
            print("📊 Building document chunks...", file=sys.stderr)
            self.chunks = []
            for doc in documents:
                self.chunks.extend(chunk_document(doc))
            
            # Save chunks
            with open(CHUNKS_FILE, "w", encoding="utf-8") as f:
                json.dump(self.chunks, f, ensure_ascii=False)
            print(f"💾 Saved {len(self.chunks)} chunks", file=sys.stderr)
        
        # Build title lookup for exact matching
        self._title_lookup = {}
        seen_titles = set()
        for i, chunk in enumerate(self.chunks):
            title = chunk["title"]
            if title not in seen_titles:
                normalized = re.sub(r'[.\s\-_]', '', title.lower())
                self._title_lookup[normalized] = i
                self._title_lookup[title.lower()] = i
                seen_titles.add(title)
        
        # Build or load embeddings
        if index_exists and not data_changed and HAS_FAISS:
            self.index = faiss.read_index(str(INDEX_FILE))
            print(f"📂 Loaded FAISS index", file=sys.stderr)
        else:
            self._build_index()
        
        # Save data hash
        DATA_HASH_FILE.write_text(current_hash)
    
    def _build_index(self):
        """Build embeddings and FAISS index from chunks."""
        print("📊 Building vector embeddings...", file=sys.stderr)
        texts = [f"{c['title']}\n{c['content']}" for c in self.chunks]
        self.chunk_embeddings = self.embedder.encode(texts, show_progress_bar=True, convert_to_numpy=True)
        
        if HAS_FAISS:
            dim = self.chunk_embeddings.shape[1]
            self.index = faiss.IndexFlatIP(dim)
            normalized = self.chunk_embeddings.copy()
            faiss.normalize_L2(normalized)
            self.index.add(normalized.astype(np.float32))
            faiss.write_index(self.index, str(INDEX_FILE))
            print(f"💾 FAISS index saved ({len(self.chunks)} chunks)", file=sys.stderr)
        else:
            # Normalize for cosine similarity
            norms = np.linalg.norm(self.chunk_embeddings, axis=1, keepdims=True)
            self.chunk_embeddings = self.chunk_embeddings / norms
            print(f"💾 Numpy embeddings ready ({len(self.chunks)} chunks)", file=sys.stderr)
    
    def _title_match_score(self, query: str, title: str) -> float:
        """Check if query matches title - robust for acronyms and machine names."""
        def normalize(s):
            return re.sub(r'[.\s\-_\'\":;,!?()]', '', s.lower())
        
        query_norm = normalize(query)
        title_norm = normalize(title)
        
        # Exact normalized match
        if query_norm == title_norm:
            return 1.0
        
        # Query contains the full title or vice versa
        if query_norm in title_norm or title_norm in query_norm:
            return 0.8
        
        # Word overlap
        query_words = set(normalize(w) for w in query.split() if len(w) > 2)
        title_words = set(normalize(w) for w in title.split() if len(w) > 1)
        
        matches = query_words & title_words
        if matches:
            return 0.5 + (0.3 * len(matches) / max(len(query_words), 1))
        
        return 0.0
    
    def retrieve(self, query: str, k: int = None) -> list:
        """Hybrid retrieval: direct title match + vector search."""
        k = k or TOP_K
        results = []
        used_chunks = set()
        
        # STEP 1: Direct title lookup (exact match)
        query_norm = re.sub(r'[.\s\-_]', '', query.lower())
        if query_norm in self._title_lookup:
            idx = self._title_lookup[query_norm]
            chunk = self.chunks[idx]
            results.append({
                "title": chunk["title"],
                "content": chunk["content"],
                "url": chunk["url"],
                "score": 2.0
            })
            used_chunks.add(idx)
            
            # Also get other chunks from same document
            for i, c in enumerate(self.chunks):
                if c["title"] == chunk["title"] and i not in used_chunks:
                    results.append({
                        "title": c["title"],
                        "content": c["content"],
                        "url": c["url"],
                        "score": 1.8
                    })
                    used_chunks.add(i)
        
        # Also check each word in query for direct matches
        for word in query.split():
            word_norm = re.sub(r'[.\s\-_]', '', word.lower())
            if len(word_norm) >= 3 and word_norm in self._title_lookup:
                idx = self._title_lookup[word_norm]
                chunk = self.chunks[idx]
                if idx not in used_chunks:
                    results.append({
                        "title": chunk["title"],
                        "content": chunk["content"],
                        "url": chunk["url"],
                        "score": 1.5
                    })
                    used_chunks.add(idx)
        
        # STEP 2: Vector search for remaining slots
        if len(results) < k:
            query_vec = self.embedder.encode([query], convert_to_numpy=True)
            
            if HAS_FAISS and self.index is not None:
                faiss.normalize_L2(query_vec)
                scores, indices = self.index.search(query_vec.astype(np.float32), k * 3)
                search_results = [(indices[0][i], scores[0][i]) for i in range(len(indices[0]))]
            else:
                # Numpy fallback
                query_vec = query_vec / np.linalg.norm(query_vec)
                scores = np.dot(self.chunk_embeddings, query_vec.T).flatten()
                top_indices = np.argsort(scores)[::-1][:k * 3]
                search_results = [(idx, scores[idx]) for idx in top_indices]
            
            for idx, score in search_results:
                if idx < len(self.chunks) and len(results) < k and idx not in used_chunks:
                    chunk = self.chunks[idx]
                    title_boost = self._title_match_score(query, chunk["title"])
                    combined_score = float(score) + (title_boost * 0.5)
                    
                    results.append({
                        "title": chunk["title"],
                        "content": chunk["content"],
                        "url": chunk["url"],
                        "score": combined_score
                    })
                    used_chunks.add(idx)
        
        # Sort by score and limit
        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:k]
    
    def _call_groq(self, prompt: str) -> str:
        """Call Groq API for chat completion."""
        api_key = CONFIG.get("groq_api_key") or os.environ.get("TERF_GROQ_KEY")
        if not api_key:
            return "Error: No Groq API key configured."
        
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        data = {
            "model": CONFIG.get("groq_model", "llama-3.1-8b-instant"),
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.7,
            "max_tokens": 800
        }
        
        try:
            response = requests.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers=headers,
                json=data,
                timeout=30
            )
            response.raise_for_status()
            return response.json()["choices"][0]["message"]["content"]
        except requests.exceptions.Timeout:
            return "Error: Groq API timed out. Please try again."
        except Exception as e:
            return f"Error calling Groq API: {str(e)}"
    
    def generate_answer(self, question: str, context: str) -> str:
        """Generate answer using Groq API."""
        prompt = f"""You are a wiki expert assistant. Answer the question using ONLY the provided wiki context below.

CONTEXT FORMAT:
- The context includes raw wikitext with templates like {{{{Infobox | key = value}}}}.
- Parse these templates to extract data (power, heat, recipes, etc.).
- [[Link]] means a wiki link to another page.
- ## Header means a section header.

RULES:
1. ONLY use information from the wiki context provided.
2. Extract and quote specific values (power, heat, recipes) exactly as found.
3. If the information is partially available, share what you found and note what's missing.
4. If the answer is COMPLETELY missing from context, say "This specific information is not in the wiki pages I found. The wiki may have more details at [relevant page link]."
5. Be concise but complete.

Wiki Context:
{context}

Question: {question}

Answer:"""
        
        return self._call_groq(prompt)
    
    def answer(self, question: str) -> tuple:
        """Full RAG pipeline: retrieve and answer with caching."""
        # Check cache first
        cache_key = question.lower().strip()
        if cache_key in self._cache:
            cached = self._cache[cache_key]
            return (cached["answer"], cached["sources"])
        
        # Retrieve relevant chunks
        docs = self.retrieve(question)
        
        # Build context with more content
        context_parts = []
        total_chars = 0
        for d in docs:
            chunk_text = f"### {d['title']}\nURL: {d['url']}\n{d['content']}"
            if total_chars + len(chunk_text) > MAX_CONTEXT_CHARS:
                break
            context_parts.append(chunk_text)
            total_chars += len(chunk_text)
        
        context = "\n\n---\n\n".join(context_parts)
        
        # Generate answer
        answer = self.generate_answer(question, context)
        
        # Cache result
        self._cache[cache_key] = {
            "answer": answer,
            "sources": [{"title": d["title"], "url": d["url"]} for d in docs]
        }
        self._save_cache()
        
        return (answer, docs)


def main():
    rag = WikiRAG()
    
    print(f"\n🎮 TERF Wiki RAG v2 - Using Groq API")
    print("Type 'quit' to exit.\n")
    
    while True:
        question = input("❓ You: ").strip()
        if question.lower() in ("quit", "exit", "q"):
            break
        if not question:
            continue
        
        answer, sources = rag.answer(question)
        print(f"\n🤖 Assistant: {answer}")
        if sources:
            print(f"📚 Sources: {', '.join(s['title'] for s in sources[:5])}")
        print()


if __name__ == "__main__":
    main()
