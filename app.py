from fastapi import FastAPI, Request
from transformers import AutoTokenizer, AutoModelForCausalLM
import torch, os

app = FastAPI()

# Hugging Face auth
HF_TOKEN = os.getenv("HF_TOKEN")

MODEL_REPO = "meta-llama/Llama-3.1-8B-Instruct"
tokenizer = AutoTokenizer.from_pretrained(MODEL_REPO, token=HF_TOKEN)
model = AutoModelForCausalLM.from_pretrained(
    MODEL_REPO,
    torch_dtype=torch.float16,
    device_map="auto",
    offload_folder="offload",
    token=HF_TOKEN
)

SYSTEM_PROMPT = """SYSTEM: You are J.A.R.V.I.S.... (rest of your big prompt)"""

memory = []
def add_memory(entry):
    if len(memory) >= 80:
        memory.pop(0)
    memory.append(entry)

@app.post("/chat")
async def chat_api(request: Request):
    data = await request.json()
    user = data.get("message", "")

    add_memory(f"User: {user}")
    memory_context = "\n".join(memory[-80:])

    prompt = SYSTEM_PROMPT + "\n\n" + memory_context + f"\nUser: {user}\nAssistant:"
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)

    outputs = model.generate(
        **inputs,
        max_new_tokens=120,
        temperature=0.7,
        top_p=0.9,
        do_sample=True,
        pad_token_id=tokenizer.eos_token_id
    )

    reply = tokenizer.decode(outputs[0], skip_special_tokens=True).split("Assistant:")[-1].strip()
    add_memory(f"Assistant: {reply}")
    return {"reply": reply}
