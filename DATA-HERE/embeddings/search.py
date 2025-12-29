import numpy as np

class EmbeddingSearch:
    def __init__(self, index):
        self.index = index

    def search(self, query_embedding, top_k=10):
        sims = self.index.embeddings @ query_embedding
        top_idx = np.argsort(sims)[::-1][:top_k]

        return [
            {
                "score": sims[i],
                "meta": self.index.metadata[i]
            }
            for i in top_idx
        ]
