/**
 * Hybrid Retrieval Pipeline
 *
 * MIE451 Concept: Two-stage retrieval (Module 1 + Module 5)
 *
 * Combines sparse (Boolean + TF-IDF) and dense (embedding) retrieval
 * into a unified pipeline with reciprocal rank fusion.
 *
 * Pipeline stages:
 *   Stage 1 (Sparse): Fast candidate filtering via inverted index
 *     - Boolean AND for hard constraints
 *     - TF-IDF scoring for soft preference terms
 *   Stage 2 (Dense): Neural embedding re-ranking
 *     - OpenAI text-embedding-3-small for query + restaurant vectors
 *     - Cosine similarity scoring
 *   Fusion: Reciprocal Rank Fusion (RRF) to merge ranked lists
 *
 * Why hybrid?
 *   - Sparse catches exact term matches (e.g., "halal", "vegan")
 *   - Dense captures semantic similarity (e.g., "cozy" ≈ "intimate")
 *   - RRF lets both contribute without calibrating score scales
 */

import { Restaurant, StructuredUserProfile, ScoredRestaurant } from '../types';
import { InvertedIndex, buildInvertedIndex } from './inverted-index';
import { sparseRetrieve, SparseRetrievalResult } from './sparse-retrieval';
import {
  buildUserFeatureVector,
  buildRestaurantFeatureVector,
  batchScoreRestaurants,
} from '../scoring/feature-vectors';
import { cosineSimilarity } from '../utils';

// ============================================
// Types
// ============================================

export interface HybridRetrievalConfig {
  /** Number of candidates from sparse retrieval */
  sparseTopK: number;
  /** Number of candidates from dense retrieval */
  denseTopK: number;
  /** Final number of candidates to return */
  finalTopK: number;
  /** RRF constant (higher = less weight on top ranks) */
  rrfK: number;
  /** Weight for sparse vs dense in RRF (0-1, 1 = all sparse) */
  sparseWeight: number;
}

export const DEFAULT_CONFIG: HybridRetrievalConfig = {
  sparseTopK: 50,
  denseTopK: 30,
  finalTopK: 15,
  rrfK: 60,
  sparseWeight: 0.4,
};

export interface HybridResult {
  /** Final scored and ranked restaurants */
  candidates: ScoredRestaurant[];
  /** The inverted index (reuse for fairness scoring) */
  index: InvertedIndex;
  /** Diagnostics for evaluation */
  diagnostics: {
    sparseCount: number;
    denseCount: number;
    fusedCount: number;
    sparseOnlyCount: number;
    denseOnlyCount: number;
    overlapCount: number;
  };
}

// ============================================
// Singleton Index Cache
// ============================================

let cachedIndex: InvertedIndex | null = null;

/**
 * Get or build the inverted index for the restaurant corpus.
 * Cached across requests (module-level singleton in serverless).
 */
export function getOrBuildIndex(restaurants: Restaurant[]): InvertedIndex {
  if (!cachedIndex) {
    console.log('[Hybrid] Building inverted index for', restaurants.length, 'restaurants...');
    cachedIndex = buildInvertedIndex(restaurants);
    console.log('[Hybrid] Index built:', cachedIndex.termIndex.size, 'terms');
  }
  return cachedIndex;
}

// ============================================
// Stage 1: Sparse Retrieval
// ============================================

/**
 * Run sparse retrieval using the inverted index.
 * Returns ranked list of restaurant IDs with TF-IDF scores.
 */
function runSparseStage(
  index: InvertedIndex,
  restaurants: Restaurant[],
  profiles: StructuredUserProfile[],
  topK: number
): Map<string, { rank: number; score: number }> {
  const results = sparseRetrieve(index, restaurants, profiles, topK);

  const ranked = new Map<string, { rank: number; score: number }>();
  results.forEach((r, i) => {
    ranked.set(r.restaurantId, { rank: i + 1, score: r.sparseScore });
  });

  return ranked;
}

// ============================================
// Stage 2: Dense Retrieval
// ============================================

/**
 * Run dense retrieval using feature vector cosine similarity.
 *
 * Per-user scoring: each restaurant gets a score per user via CBF vectors,
 * then we take the geometric mean across users (Nash-style aggregation).
 * This ensures the dense stage itself is fairness-aware.
 */
function runDenseStage(
  index: InvertedIndex,
  restaurants: Restaurant[],
  profiles: StructuredUserProfile[],
  topK: number
): Map<string, { rank: number; score: number }> {
  // Build user feature vectors
  const userVectors = profiles.map(p => buildUserFeatureVector(p, index));

  // Build restaurant feature vectors
  const restVectors = restaurants.map(r => buildRestaurantFeatureVector(r, index));

  // Score each restaurant for each user
  const userScores: number[][] = userVectors.map(uv => batchScoreRestaurants(uv, restVectors));

  // Aggregate per-restaurant: geometric mean of user scores (Nash-style)
  const aggregatedScores: { id: string; score: number }[] = restaurants.map((r, rIdx) => {
    const scores = userScores.map(us => Math.max(us[rIdx], 0.001));
    const geoMean = Math.pow(
      scores.reduce((prod, s) => prod * s, 1),
      1 / scores.length
    );
    return { id: r.id, score: geoMean };
  });

  // Sort by score descending
  aggregatedScores.sort((a, b) => b.score - a.score);

  const ranked = new Map<string, { rank: number; score: number }>();
  aggregatedScores.slice(0, topK).forEach((r, i) => {
    ranked.set(r.id, { rank: i + 1, score: r.score });
  });

  return ranked;
}

// ============================================
// Stage 2b: Dense Retrieval with Embeddings
// ============================================

/**
 * Dense retrieval using pre-computed OpenAI embeddings.
 * Falls back to feature vector scoring if embeddings unavailable.
 */
function runEmbeddingDenseStage(
  restaurants: Restaurant[],
  queryVector: number[],
  restaurantEmbeddings: { id: string; embedding: number[] }[],
  topK: number
): Map<string, { rank: number; score: number }> {
  const scored = restaurantEmbeddings.map(re => ({
    id: re.id,
    score: cosineSimilarity(queryVector, re.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);

  const ranked = new Map<string, { rank: number; score: number }>();
  scored.slice(0, topK).forEach((r, i) => {
    ranked.set(r.id, { rank: i + 1, score: r.score });
  });

  return ranked;
}

// ============================================
// Reciprocal Rank Fusion (RRF)
// ============================================

/**
 * Merge two ranked lists using Reciprocal Rank Fusion.
 *
 * MIE451 Module 1: Combining ranked retrieval results
 *
 * RRF score for document d:
 *   RRF(d) = w_sparse / (k + rank_sparse(d)) + w_dense / (k + rank_dense(d))
 *
 * Properties:
 *   - No need to normalize scores across retrieval methods
 *   - k dampens the influence of top-ranked documents
 *   - Documents appearing in both lists get boosted
 */
function reciprocalRankFusion(
  sparseRanked: Map<string, { rank: number; score: number }>,
  denseRanked: Map<string, { rank: number; score: number }>,
  config: HybridRetrievalConfig
): Map<string, number> {
  const rrfScores = new Map<string, number>();
  const k = config.rrfK;
  const ws = config.sparseWeight;
  const wd = 1 - ws;

  // All unique document IDs from both lists
  const allIds = new Set([...sparseRanked.keys(), ...denseRanked.keys()]);

  for (const id of allIds) {
    let score = 0;

    if (sparseRanked.has(id)) {
      score += ws / (k + sparseRanked.get(id)!.rank);
    }

    if (denseRanked.has(id)) {
      score += wd / (k + denseRanked.get(id)!.rank);
    }

    rrfScores.set(id, score);
  }

  return rrfScores;
}

// ============================================
// Main Hybrid Pipeline
// ============================================

/**
 * Run the full hybrid retrieval pipeline.
 *
 * This is the primary entry point for the recommendation system.
 * It handles both cases:
 *   1. With embeddings (OpenAI API available): sparse + embedding dense + RRF
 *   2. Without embeddings (fallback): sparse + feature vector dense + RRF
 */
export function hybridRetrieve(
  restaurants: Restaurant[],
  profiles: StructuredUserProfile[],
  config: HybridRetrievalConfig = DEFAULT_CONFIG,
  embeddingData?: {
    queryVector: number[];
    restaurantEmbeddings: { id: string; embedding: number[] }[];
  }
): HybridResult {
  const index = getOrBuildIndex(restaurants);

  // Stage 1: Sparse retrieval
  const sparseRanked = runSparseStage(index, restaurants, profiles, config.sparseTopK);

  // Stage 2: Dense retrieval
  let denseRanked: Map<string, { rank: number; score: number }>;

  if (embeddingData) {
    // Use OpenAI embeddings for dense stage
    denseRanked = runEmbeddingDenseStage(
      restaurants,
      embeddingData.queryVector,
      embeddingData.restaurantEmbeddings,
      config.denseTopK
    );
  } else {
    // Use feature vector CBF for dense stage
    denseRanked = runDenseStage(index, restaurants, profiles, config.denseTopK);
  }

  // Stage 3: Reciprocal Rank Fusion
  const rrfScores = reciprocalRankFusion(sparseRanked, denseRanked, config);

  // Sort by RRF score
  const sortedIds = [...rrfScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, config.finalTopK);

  // Build restaurant lookup
  const restaurantMap = new Map(restaurants.map(r => [r.id, r]));

  // Map to ScoredRestaurant with RRF score
  const candidates: ScoredRestaurant[] = sortedIds
    .map(([id, score]) => {
      const restaurant = restaurantMap.get(id);
      if (!restaurant) return null;
      return { ...restaurant, score };
    })
    .filter((r): r is ScoredRestaurant => r !== null);

  // Diagnostics
  const sparseIds = new Set(sparseRanked.keys());
  const denseIds = new Set(denseRanked.keys());
  const overlap = [...sparseIds].filter(id => denseIds.has(id));

  return {
    candidates,
    index,
    diagnostics: {
      sparseCount: sparseIds.size,
      denseCount: denseIds.size,
      fusedCount: candidates.length,
      sparseOnlyCount: [...sparseIds].filter(id => !denseIds.has(id)).length,
      denseOnlyCount: [...denseIds].filter(id => !sparseIds.has(id)).length,
      overlapCount: overlap.length,
    },
  };
}
