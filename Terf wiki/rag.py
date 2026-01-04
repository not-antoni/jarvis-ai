"""
TERF Wiki RAG - Dual-model system with FunctionGemma + Groq/Local LLM.
- FunctionGemma: Decides when to search the wiki
- Groq API (llama-3.1-8b) or local Gemma3: Generates answers
"""
import json
import os
import re
import torch
import faiss
import requests
import numpy as np
from pathlib import Path
from functools import lru_cache
from sentence_transformers import SentenceTransformer
from transformers import AutoTokenizer, AutoModelForCausalLM

# Load config with environment variable overrides
_config_path = Path(__file__).parent / "config.json"
with open(_config_path, "r") as f:
    CONFIG = json.load(f)

# Override with environment variables if present
if os.environ.get("TERF_GROQ_KEY"):
    CONFIG["groq_api_key"] = os.environ["TERF_GROQ_KEY"]

DATA_FILE = Path(__file__).parent / "data/wiki_pages.json"
INDEX_FILE = Path(__file__).parent / "data/wiki_index.faiss"


class WikiRAG:
    def __init__(self):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = torch.float32
        
        print("🔧 Loading embedding model...")
        self.embedder = SentenceTransformer(CONFIG["embed_model"])
        
        # Optionally load FunctionGemma
        self.use_function_model = CONFIG.get("use_function_model", True)
        if self.use_function_model:
            print("🔧 Loading FunctionGemma (tool calling)...")
            self.func_tokenizer = AutoTokenizer.from_pretrained(CONFIG["function_model"])
            self.func_model = AutoModelForCausalLM.from_pretrained(
                CONFIG["function_model"], torch_dtype=dtype
            ).to(self.device)
        else:
            print("🔧 FunctionGemma disabled")
            self.func_tokenizer = None
            self.func_model = None
        
        # Only load local chat model if not using Groq
        self.use_groq = CONFIG.get("use_groq_api", True)
        if not self.use_groq:
            print("🔧 Loading local Gemma3 (conversation)...")
            self.chat_tokenizer = AutoTokenizer.from_pretrained(CONFIG["local_chat_model"])
            self.chat_model = AutoModelForCausalLM.from_pretrained(
                CONFIG["local_chat_model"], torch_dtype=dtype
            ).to(self.device)
        else:
            print(f"🔧 Using Groq API ({CONFIG['groq_model']})")
            self.chat_tokenizer = None
            self.chat_model = None
        
        self.documents = []
        self.index = None
        self._cache_file = Path(__file__).parent / "data/answer-cache.json"
        self._cache = self._load_cache()
        self._load_or_build_index()
        print(f"✅ Ready! {len(self.documents)} documents indexed, {len(self._cache)} cached answers.")
    
    def _load_cache(self) -> dict:
        """Load cache from disk."""
        if self._cache_file.exists():
            try:
                with open(self._cache_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except:
                return {}
        return {}
    
    def _save_cache(self):
        """Save cache to disk."""
        try:
            with open(self._cache_file, "w", encoding="utf-8") as f:
                json.dump(self._cache, f, ensure_ascii=False)
        except Exception as e:
            print(f"Warning: Failed to save cache: {e}")
    
    def _load_or_build_index(self):
        """Load existing index or build from wiki data."""
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            self.documents = json.load(f)
        
        # Build title lookup for exact matching
        self._title_lookup = {}
        for i, doc in enumerate(self.documents):
            title = doc["title"]
            # Map normalized versions to document index
            normalized = re.sub(r'[.\s\-_]', '', title.lower())
            self._title_lookup[normalized] = i
            self._title_lookup[title.lower()] = i
        
        if Path(INDEX_FILE).exists():
            self.index = faiss.read_index(INDEX_FILE)
        else:
            self._build_index()
    
    def _build_index(self):
        """Build FAISS index from documents."""
        print("📊 Building vector index...")
        texts = [f"{d['title']}\n{d['content']}" for d in self.documents]
        embeddings = self.embedder.encode(texts, show_progress_bar=True)
        
        dim = embeddings.shape[1]
        self.index = faiss.IndexFlatIP(dim)
        faiss.normalize_L2(embeddings)
        self.index.add(embeddings.astype(np.float32))
        
        faiss.write_index(self.index, INDEX_FILE)
        print(f"💾 Index saved to {INDEX_FILE}")
    
    def _title_match_score(self, query: str, title: str) -> float:
        """Check if query matches title - robust for acronyms and machine names."""
        # Normalize everything: lowercase, remove dots/spaces/punctuation
        def normalize(s):
            return re.sub(r'[.\s\-_\'\":;,!?()]', '', s.lower())
        
        query_norm = normalize(query)
        title_norm = normalize(title)
        
        # Exact normalized match (stfr == S.T.F.R. == STFR)
        if query_norm == title_norm:
            return 1.0
        
        # Query contains the full title or vice versa
        if query_norm in title_norm or title_norm in query_norm:
            return 0.8
        
        # Split into words and check for matches
        query_words = set(normalize(w) for w in query.split() if len(w) > 2)
        title_words = set(normalize(w) for w in title.split() if len(w) > 1)
        
        # Any word from query matches title words
        matches = query_words & title_words
        if matches:
            return 0.5 + (0.3 * len(matches) / max(len(query_words), 1))
        
        # Fuzzy: check if any query word is substring of any title word
        for qw in query_words:
            for tw in title_words:
                if len(qw) >= 3 and (qw in tw or tw in qw):
                    return 0.4
        
        return 0.0
    
    def retrieve(self, query: str, k: int = None) -> list:
        """Hybrid retrieval: direct title match + vector search."""
        k = k or CONFIG.get("top_k", 3)
        results = []
        used_titles = set()
        
        # STEP 1: Direct title lookup (exact match)
        query_norm = re.sub(r'[.\s\-_]', '', query.lower())
        if query_norm in self._title_lookup:
            idx = self._title_lookup[query_norm]
            doc = self.documents[idx]
            results.append({
                "title": doc["title"],
                "content": doc["content"][:1200],
                "url": doc["url"],
                "score": 2.0  # Highest priority
            })
            used_titles.add(doc["title"])
        
        # Also check each word in query for direct matches
        for word in query.split():
            word_norm = re.sub(r'[.\s\-_]', '', word.lower())
            if len(word_norm) >= 3 and word_norm in self._title_lookup:
                idx = self._title_lookup[word_norm]
                doc = self.documents[idx]
                if doc["title"] not in used_titles:
                    results.append({
                        "title": doc["title"],
                        "content": doc["content"][:1200],
                        "url": doc["url"],
                        "score": 1.5
                    })
                    used_titles.add(doc["title"])
        
        # STEP 2: Vector search for remaining slots
        if len(results) < k:
            query_vec = self.embedder.encode([query])
            faiss.normalize_L2(query_vec)
            scores, indices = self.index.search(query_vec.astype(np.float32), k * 3)
            
            for i, idx in enumerate(indices[0]):
                if idx < len(self.documents) and len(results) < k:
                    doc = self.documents[idx]
                    if doc["title"] not in used_titles:
                        vector_score = float(scores[0][i])
                        title_boost = self._title_match_score(query, doc["title"])
                        combined_score = vector_score + (title_boost * 0.5)
                        
                        results.append({
                            "title": doc["title"],
                            "content": doc["content"][:1200],
                            "url": doc["url"],
                            "score": combined_score
                        })
                        used_titles.add(doc["title"])
        
        # Sort by score
        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:k]
    
    def should_search(self, question: str) -> tuple:
        """Always search for TERF questions - skip function calling overhead."""
        # Simple keyword check - faster than model inference
        terf_keywords = ['terf', 'reactor', 'machine', 'multiblock', 'power', 'build', 
                         'stfr', 's.t.f.r', 'dem', 'd.e.m', 'crr', 'c.r.r', 'mcfr',
                         'turbine', 'furnace', 'fabricator', 'breaker', 'generator',
                         'fluid', 'pipe', 'energy', 'startup', 'meltdown', 'coolant']
        
        query_lower = question.lower()
        for kw in terf_keywords:
            if kw in query_lower:
                return True, "wiki_search"
        
        # Default: search anyway for wiki bot
        return True, "wiki_search"
    
    def _call_groq(self, prompt: str) -> str:
        """Call Groq API for chat completion."""
        headers = {
            "Authorization": f"Bearer {CONFIG['groq_api_key']}",
            "Content-Type": "application/json"
        }
        data = {
            "model": CONFIG["groq_model"],
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.7,
            "max_tokens": 512
        }
        
        response = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers=headers,
            json=data,
            timeout=30
        )
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"]
    
    def _call_local(self, prompt: str) -> str:
        """Use local Gemma3 model for generation."""
        inputs = self.chat_tokenizer(prompt, return_tensors="pt").to(self.device)
        with torch.no_grad():
            outputs = self.chat_model.generate(
                **inputs, max_new_tokens=300, temperature=0.7, do_sample=True,
                pad_token_id=self.chat_tokenizer.eos_token_id
            )
        response = self.chat_tokenizer.decode(outputs[0], skip_special_tokens=True)
        if prompt in response:
            response = response[len(prompt):].strip()
        return response
    
    def generate_answer(self, question: str, context: str) -> str:
        """Generate answer using Groq API or local model."""
        prompt = f"""You are a wiki assistant. Your ONLY job is to summarize and quote from the wiki context below.

STRICT RULES:
1. ONLY use information from the wiki context provided
2. DO NOT make up or infer any information not explicitly stated
3. If the answer is not in the wiki context, say "This information is not available in the wiki."
4. Quote specific details like power values, recipes, and instructions exactly as written

Wiki context:
{context}

Question: {question}

Answer using ONLY the wiki context above (no external knowledge):"""
        
        if self.use_groq:
            return self._call_groq(prompt)
        else:
            return self._call_local(prompt)
    
    def answer(self, question: str) -> tuple:
        """Full RAG pipeline: retrieve and answer with disk caching."""
        # Check cache first (normalize query)
        cache_key = question.lower().strip()
        if cache_key in self._cache:
            cached = self._cache[cache_key]
            # Reconstruct tuple from cached dict
            return (cached["answer"], cached["sources"])
        
        # Retrieve and generate
        docs = self.retrieve(question)
        context = "\n\n".join([f"### {d['title']}\n{d['content']}" for d in docs])
        
        answer = self.generate_answer(question, context)
        
        # Cache result as dict (JSON-serializable)
        # Limit to 200 entries
        if len(self._cache) >= 200:
            # Remove oldest entry
            oldest_key = next(iter(self._cache))
            del self._cache[oldest_key]
        
        self._cache[cache_key] = {
            "answer": answer,
            "sources": [{"title": d["title"], "url": d["url"]} for d in docs]
        }
        self._save_cache()
        
        return (answer, docs)


def main():
    rag = WikiRAG()
    
    mode = "Groq API" if rag.use_groq else "Local Gemma3"
    print(f"\n🎮 TERF Wiki RAG - Using {mode}")
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
            print(f"📚 Sources: {', '.join(s['title'] for s in sources)}")
        print()


if __name__ == "__main__":
    main()
