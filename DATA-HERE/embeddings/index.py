import numpy as np

class EmbeddingIndex:
    def __init__(self):
        self.embeddings = None
        self.metadata = []

    def build(self, embeddings, metadata):
        self.embeddings = embeddings
        self.metadata = metadata

    def save(self, path):
        np.save(path, {
            "embeddings": self.embeddings,
            "metadata": self.metadata
        }, allow_pickle=True)

    def load(self, path):
        data = np.load(path, allow_pickle=True).item()
        self.embeddings = data["embeddings"]
        self.metadata = data["metadata"]
