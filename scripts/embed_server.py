"""
轻量 Embedding 服务 — bge-large-zh-v1.5
TS 后端通过 HTTP 调用，不走 Python 子进程

启动: python scripts/embed_server.py
依赖: pip install fastapi uvicorn sentence-transformers
"""

from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

app = FastAPI(title="BGE Embedding Server")
# 模型已通过 ModelScope 下载到本地
MODEL_PATH = "/Users/juliaaa/.cache/modelscope/BAAI/bge-large-zh-v1.5"
model = SentenceTransformer(MODEL_PATH)


class EmbedRequest(BaseModel):
    text: str


@app.post("/embed")
def embed(req: EmbedRequest):
    vec = model.encode(req.text, normalize_embeddings=True)
    return {"embedding": vec.tolist()}


@app.get("/health")
def health():
    return {"ok": True, "dim": model.get_sentence_embedding_dimension()}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765)
