#!/usr/bin/env python3
"""
TERF Wiki CLI - Lightweight wrapper for Node.js integration.
Outputs JSON to stdout for parsing.
Usage: python cli.py --query "What is STFR"
"""
import sys
import os
import json
import argparse

# Change to script directory for relative imports
os.chdir(os.path.dirname(os.path.abspath(__file__)))

def main():
    parser = argparse.ArgumentParser(description="TERF Wiki RAG CLI")
    parser.add_argument("--query", "-q", required=True, help="Question to answer")
    args = parser.parse_args()
    
    try:
        # Import here to delay heavy loading until needed
        from rag import WikiRAG
        
        # Initialize RAG (models are cached after first load)
        rag = WikiRAG()
        
        # Get answer
        answer, sources = rag.answer(args.query)
        
        # Output JSON
        result = {
            "success": True,
            "answer": answer,
            "sources": [{"title": s["title"], "url": s["url"]} for s in sources]
        }
        print(json.dumps(result))
        
    except Exception as e:
        result = {
            "success": False,
            "error": str(e)
        }
        print(json.dumps(result))
        sys.exit(1)

if __name__ == "__main__":
    main()
