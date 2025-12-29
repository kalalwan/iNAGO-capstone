from sentence_transformers import SentenceTransformer
import torch

class ReviewEmbedder:
    def __init__(self, model_name="all-MiniLM-L6-v2"):
        device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model = SentenceTransformer(model_name, device=device)

    def embed(self, texts):
        return self.model.encode(
            texts,
            batch_size=128,
            convert_to_numpy=True,
            normalize_embeddings=True,
            show_progress_bar=True
        )
