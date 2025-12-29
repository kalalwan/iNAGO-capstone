from collections import defaultdict
import numpy as np

def rank_restaurants(index, query_vec, top_k=10, top_reviews_per_rest=10):
    sims = index.embeddings @ query_vec

    scores_by_place = defaultdict(list)

    for sim, meta in zip(sims, index.metadata):
        scores_by_place[meta["place_id"]].append(sim)

    avg_scores = {}
    for place_id, scores in scores_by_place.items():
        top_scores = sorted(scores, reverse=True)[:top_reviews_per_rest]
        avg_scores[place_id] = float(np.mean(top_scores))

    ranked = sorted(
        avg_scores.items(),
        key=lambda x: x[1],
        reverse=True
    )

    return ranked[:top_k]