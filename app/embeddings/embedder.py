
from fastembed import TextEmbedding

MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"

model = TextEmbedding(model_name=MODEL_NAME)


def generate_embeddings(texts: list[str]):
    if not texts:
        return []

    embeddings = list(model.embed(texts))

    return [embedding.tolist() for embedding in embeddings]
