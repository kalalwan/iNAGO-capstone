# DSS Refactoring Plan — iNAGO Eats

> Applying MIE451 Decision Support Systems paradigms to the recommendation engine

## Executive Summary

The iNAGO Eats recommendation system currently uses a **pure dense retrieval** approach (OpenAI embeddings) with hand-crafted soft constraint scoring. This plan refactors the system using proper DSS paradigms from MIE451:

1. **Hybrid Retrieval System** — Sparse (TF-IDF / inverted index) + Dense (embeddings) two-stage retrieval
2. **Per-User Feature Vector Scoring** — Replace group-query embedding with individual user–restaurant feature matching
3. **IDF-Weighted Satisfaction Functions** — Rare constraints count more
4. **Popularity Baseline** — Always compare against a simple baseline
5. **Cold-Start Handling** — Graceful degradation for low-confidence users
6. **Proper IR Evaluation Metrics** — Precision@k, NDCG@k, baseline comparisons

---

## Part 1: Hybrid Retrieval System

### 1.1 Concept (MIE451 — Information Retrieval)

The current system embeds all 356 restaurants and scores them purely by cosine similarity to a synthesized "group query" embedding. Problems:

- **No TF-IDF weighting**: Common tags like "restaurant" count the same as discriminative tags like "halal"
- **No Boolean pre-filtering**: Hard constraints should eliminate candidates *before* scoring
- **Inefficient**: Embeds all restaurants even when only a subset could possibly satisfy constraints

The MIE451 hybrid retrieval approach:

- **Stage 1 (Sparse/Boolean)**: Use an inverted index to rapidly filter candidates by hard constraints and boost by TF-IDF weighted tag matches
- **Stage 2 (Dense/Semantic)**: Apply embedding similarity only to the filtered candidate set

### 1.2 New File: `lib/retrieval/inverted-index.ts`

```typescript
/**
 * Inverted Index for Restaurant Retrieval
 *
 * MIE451 Concept: Information Retrieval with TF-IDF weighting
 *
 * Maps terms (tags, cuisines, locations, features) to the set of
 * restaurants containing that term, along with TF-IDF weights.
 */

import { Restaurant } from '../types';

export interface InvertedIndex {
  termIndex: Map<string, Map<string, number>>;  // term -> { restaurantId -> tf-idf }
  idfValues: Map<string, number>;               // IDF for each term
  documentFrequency: Map<string, number>;        // DF for each term
  totalDocuments: number;
}

/**
 * Build an inverted index from restaurant data
 *
 * Algorithm:
 * 1. For each restaurant, extract all terms (cuisine, tags, location, description keywords)
 * 2. Normalize terms (lowercase, synonym mapping)
 * 3. Calculate term frequency (TF) per restaurant
 * 4. Calculate document frequency (DF) across all restaurants
 * 5. Calculate IDF = log₁₀(N / DF) for each term
 * 6. Store TF-IDF = (1 + log₁₀(TF)) × IDF per restaurant–term pair
 */
export function buildInvertedIndex(restaurants: Restaurant[]): InvertedIndex;

/**
 * Extract searchable terms from a restaurant
 *
 * Extracts from: cuisine (split by comma), tags[], location,
 * description keywords, price level, rating tier
 */
export function extractTerms(restaurant: Restaurant): string[];

/**
 * Normalize a term for indexing
 * - Lowercase, strip punctuation
 * - Synonym map: "bbq" → "barbecue", "veggie" → "vegetarian"
 */
export function normalizeTerm(term: string): string;

/**
 * IDF(t) = log₁₀(N / df_t)
 *
 * "halal" in 5/356 restaurants → IDF = log(356/5) = 1.85 (high)
 * "restaurant" in 300/356     → IDF = log(356/300) = 0.07 (low)
 */
export function calculateIDF(df: number, N: number): number;
```

### 1.3 New File: `lib/retrieval/sparse-retrieval.ts`

```typescript
/**
 * Sparse Retrieval Module
 *
 * MIE451 Concept: Boolean retrieval + TF-IDF scoring
 */

import { InvertedIndex } from './inverted-index';
import { Restaurant, HardConstraint } from '../types';

export interface SparseRetrievalResult {
  restaurantId: string;
  sparseScore: number;
  matchedTerms: string[];
  passesHardConstraints: boolean;
}

/**
 * Retrieve candidates using Boolean filtering + TF-IDF scoring
 *
 * 1. Extract query terms from user constraints
 * 2. Boolean AND for hard constraints (must match)
 * 3. Boolean OR for soft constraints (should match)
 * 4. Score matches using TF-IDF weights
 * 5. Return ranked candidates
 */
export function sparseRetrieve(
  index: InvertedIndex,
  restaurants: Restaurant[],
  hardConstraints: HardConstraint[],
  softTerms: string[],
  limit: number
): SparseRetrievalResult[];

/**
 * Convert a hard constraint to query terms
 *
 * { type: 'dietary', value: 'vegan' } → mustMatch: ["vegan", "plant-based"]
 * { type: 'allergy', value: 'peanut' } → mustNotMatch: ["peanut", "nut"]
 */
export function constraintToTerms(constraint: HardConstraint): {
  mustMatch: string[];
  mustNotMatch: string[];
};

/**
 * Score = Σ(queryWeight × documentTFIDF) over matched terms
 */
export function scoreSparse(
  restaurantId: string,
  queryTerms: string[],
  queryWeights: Map<string, number>,
  index: InvertedIndex
): number;
```

### 1.4 New File: `lib/retrieval/hybrid-retrieval.ts`

```typescript
/**
 * Hybrid Retrieval Pipeline
 *
 * MIE451 Concept: Two-stage retrieval (sparse → dense)
 *
 * Stage 1: Inverted index for fast Boolean filtering + TF-IDF scoring
 * Stage 2: Re-rank top candidates using dense embeddings
 */

import { Restaurant, StructuredUserProfile, ScoredRestaurant } from '../types';

export interface HybridRetrievalConfig {
  sparseTopK: number;    // Candidates from Stage 1 (default 50)
  denseTopK: number;     // Final candidates after Stage 2 (default 15)
  sparseWeight: number;  // Weight for sparse score (default 0.3)
  denseWeight: number;   // Weight for dense score (default 0.7)
}

/**
 * Initialize hybrid retrieval (build inverted index, cache it)
 */
export function initHybridRetrieval(restaurants: Restaurant[]): void;

/**
 * Two-stage hybrid retrieval
 *
 * Stage 1: Sparse retrieval
 *   - Extract hard constraints from all profiles → Boolean AND
 *   - Extract soft constraints as query terms
 *   - Retrieve sparseTopK candidates
 *
 * Stage 2: Dense retrieval
 *   - Build per-user query embeddings (NOT a single group query)
 *   - Score candidates against each user's embedding
 *   - Combine: finalScore = sparseWeight × sparse + denseWeight × dense
 */
export async function hybridRetrieve(
  restaurants: Restaurant[],
  profiles: StructuredUserProfile[],
  config?: Partial<HybridRetrievalConfig>
): Promise<ScoredRestaurant[]>;

/**
 * Get IDF weight for a constraint term (for satisfaction scoring)
 */
export function getConstraintIDF(term: string): number;
```

### 1.5 Integration: `app/api/recommend/route.ts`

```
BEFORE (current):
  1. Build single group query string from all profiles
  2. Embed group query via OpenAI
  3. Embed all 356 restaurants (cached)
  4. Cosine similarity against all restaurants
  5. Top 15 → fairness scoring

AFTER (hybrid):
  1. Init inverted index if not cached
  2. Extract hard constraints from all profiles (Boolean AND)
  3. Stage 1: Sparse retrieve top 50 that pass hard constraints
  4. Stage 2: Dense re-rank using per-user embeddings
  5. Top 15 → fairness scoring with feature vectors
```

---

## Part 2: Per-User Feature Vector Scoring

### 2.1 Concept (MIE451 — Content-Based Filtering)

Current system: synthesizes one "group query" → one embedding → scores restaurants against that.

**Problem**: Loses individual user preferences. We can't properly calculate per-user satisfaction.

MIE451 CBF approach:

- Build a **feature vector** per user (from profile)
- Build a **feature vector** per restaurant (from tags/cuisine/price/location)
- Score each user×restaurant pair via weighted dot product

### 2.2 New File: `lib/scoring/feature-vectors.ts`

```typescript
/**
 * Feature Vector Construction for Content-Based Filtering
 *
 * MIE451 Concept: User/item feature vectors for CBF
 */

import { Restaurant, StructuredUserProfile } from '../types';
import { InvertedIndex } from '../retrieval/inverted-index';

// Fixed-size feature vector (approx 46 dimensions)
//   Cuisine features: ~21 dims (one-hot)
//   Price features: 4 dims
//   Location features: ~9 dims
//   Ambiance features: 5 dims
//   Rating: 1 dim (continuous [0,1])
//   Popularity: 1 dim (continuous [0,1])
//   Dietary accommodations: 5 dims

export type FeatureVector = Float32Array;

/**
 * Build feature vector for a restaurant
 *
 * Categorical features → one-hot encoding
 * Continuous features → normalized [0, 1]
 */
export function buildRestaurantFeatureVector(
  restaurant: Restaurant,
  index: InvertedIndex
): FeatureVector;

/**
 * Build feature vector for a user based on profile
 *
 * Key difference from restaurant vector:
 *   - Cuisine dims are weighted by preference score (not binary)
 *   - All weights multiplied by confidence
 *   - IDF weighting: rare preferences get higher weight
 *
 * Formula per cuisine dim:
 *   weight = preferenceScore × confidence × IDF(cuisine)
 *
 * Example:
 *   "halal" (score 8, confidence 0.9, IDF 1.85) → weight = 13.3
 *   "italian" (score 7, confidence 0.8, IDF 0.85) → weight = 4.8
 *   Halal contributes ~3× more — as it should.
 */
export function buildUserFeatureVector(
  profile: StructuredUserProfile,
  index: InvertedIndex
): FeatureVector;

/**
 * Score a user–restaurant pair via cosine similarity of feature vectors
 *
 * Normalized to [0, 1].
 */
export function scoreUserRestaurant(
  userVector: FeatureVector,
  restaurantVector: FeatureVector
): number;

/**
 * Batch score all restaurants for one user
 */
export function batchScoreRestaurants(
  userVector: FeatureVector,
  restaurantVectors: FeatureVector[]
): number[];
```

### 2.3 Modified: `lib/fairness.ts` — `calculateUserSatisfaction`

```typescript
// CURRENT:
//   Iterates over soft constraints, calls calculateSoftMatch (hand-crafted)
//   Combines with weights
//   Adds bonus

// NEW:
import { buildUserFeatureVector, buildRestaurantFeatureVector, scoreUserRestaurant } from './scoring/feature-vectors';

export function calculateUserSatisfaction(
  restaurant: Restaurant,
  profile: StructuredUserProfile,
  index: InvertedIndex          // ← NEW parameter
): UserSatisfactionResult {
  // Step 1: Hard constraint check (unchanged)
  // Step 2: Feature vector scoring (replaces calculateSoftMatch loop)
  const userVec = buildUserFeatureVector(profile, index);
  const restVec = buildRestaurantFeatureVector(restaurant, index);
  const featureScore = scoreUserRestaurant(userVec, restVec);

  // Step 3: Confidence weighting
  const adjustedScore = featureScore * (0.5 + 0.5 * profile.confidence.overall);
  //   confidence 0.0 → score dampened to 50% (cold user)
  //   confidence 1.0 → score at full strength

  // Step 4: Bonus (unchanged)
  // Step 5: Final = min(1, adjusted * 0.9 + bonus + 0.1)
}
```

---

## Part 3: Popularity Baseline

### 3.1 Concept (MIE451 Module 10 — Start Simple / Baselines)

> "Simple market segmentation + popularity within segments is often hard to beat. Always compare to popularity baselines."

### 3.2 New File: `lib/baselines/popularity-baseline.ts`

```typescript
/**
 * Popularity Baseline for Recommendation
 *
 * MIE451: Module 10 — Start Simple, Always Have Baselines
 */

import { Restaurant, StructuredUserProfile, ScoredRestaurant } from '../types';

/**
 * Popularity score = rating × log₁₀(reviewCount + 1)
 *
 * Balances quality (rating) with evidence (reviews).
 *
 *   4.5★, 1000 reviews → 4.5 × 3.0 = 13.5
 *   4.0★, 100 reviews  → 4.0 × 2.0 = 8.0
 *   5.0★, 10 reviews   → 5.0 × 1.04 = 5.2
 */
export function calculatePopularityScore(restaurant: Restaurant): number;

/**
 * Get popularity baseline recommendation
 *
 * 1. AND all hard constraints from all profiles
 * 2. Filter restaurants satisfying all constraints
 * 3. Sort by popularity score descending
 * 4. Return top K
 */
export function getPopularityBaseline(
  restaurants: Restaurant[],
  profiles: StructuredUserProfile[],
  topK: number
): ScoredRestaurant[];

/**
 * Random baseline (for statistical comparison floor)
 */
export function getRandomBaseline(
  restaurants: Restaurant[],
  profiles: StructuredUserProfile[],
  topK: number
): ScoredRestaurant[];
```

### 3.3 Integration: `app/api/recommend/route.ts` response

```typescript
// Include baseline comparison in every recommendation response:
{
  // ... existing fields ...
  baselines: {
    popularity: {
      restaurant: { name, id },
      nashWelfare: number,
    },
    ourSelection: {
      restaurant: { name, id },
      nashWelfare: number,
    },
    improvement: {
      absoluteDelta: number,
      percentImprovement: number,
    }
  }
}
```

---

## Part 4: Cold-Start Strategy

### 4.1 Concept (MIE451 — Cold-Start Problem)

When a user has confidence < 0.3, their preferences are unknown. The current system treats them equally, which can drag Nash Welfare to zero (geometric mean punishes zeros).

### 4.2 New File: `lib/scoring/cold-start.ts`

```typescript
/**
 * Cold-Start Handling
 *
 * MIE451: Cold-Start Problem in Recommender Systems
 */

import { StructuredUserProfile, Restaurant } from '../types';

export const COLD_START_THRESHOLD = 0.3;

export function isColdStartUser(profile: StructuredUserProfile): boolean;

/**
 * Satisfaction for cold-start user:
 *   coldScore = 0.5 + 0.3 × (popularityNormalized − 0.5)
 *
 * Maps popularity [0,1] → satisfaction [0.35, 0.65]
 * Cold users never have extreme scores.
 */
export function calculateColdStartSatisfaction(
  restaurant: Restaurant,
  profile: StructuredUserProfile
): number;

/**
 * Robust Nash Welfare for groups with cold users
 *
 * 1. Calculate Nash_warm for warm users only
 * 2. Calculate Avg_cold for cold users
 * 3. Nash_adjusted = Nash_warm^w × Avg_cold^(1−w)
 *    where w = #warm / #total
 *
 * Reduces cold-user influence on selection.
 */
export function calculateRobustNashWelfare(
  satisfactions: { userId: string; score: number; isCold: boolean }[]
): number;
```

---

## Part 5: Evaluation Metrics

### 5.1 Concept (MIE451 — IR Evaluation)

Missing from current eval:

- **Precision@K** — Of the top K, how many are "relevant"?
- **NDCG@K** — Ranking quality with logarithmic discount
- **Baseline comparisons** — Improvement over popularity

### 5.2 New File: `lib/eval/metrics.ts`

```typescript
/**
 * Information Retrieval Evaluation Metrics
 *
 * MIE451: Precision, Recall, NDCG, Baseline Comparison
 */

import { ScoredRestaurant, StructuredUserProfile, FairnessResult } from '../types';

export interface EvaluationMetrics {
  precisionAtK: number;
  ndcgAtK: number;
  meanReciprocalRank: number;
  nashWelfare: number;
  utilitarian: number;
  egalitarian: number;
  gini: number;
  nashImprovementOverPopularity: number;
  nashImprovementOverRandom: number;
  hardConstraintViolations: number;
  softConstraintSatisfactionRate: number;
}

/**
 * A restaurant is "relevant" to a user if:
 * 1. All hard constraints satisfied
 * 2. Satisfaction score ≥ 0.5
 */
export function isRelevant(
  restaurant: ScoredRestaurant,
  profile: StructuredUserProfile
): boolean;

/**
 * Precision@K = |relevant in top K| / K
 *
 * For groups: average across users.
 */
export function calculatePrecisionAtK(
  candidates: ScoredRestaurant[],
  profiles: StructuredUserProfile[],
  k: number
): number;

/**
 * DCG@K = Σ_{i=1}^{K} relevance_i / log₂(i + 1)
 * NDCG@K = DCG@K / IDCG@K
 *
 * Relevance = user satisfaction (continuous [0,1]).
 */
export function calculateNDCG(
  candidates: ScoredRestaurant[],
  profiles: StructuredUserProfile[],
  k: number
): number;

/**
 * Compare our selection vs popularity baseline vs random
 */
export function calculateBaselineComparison(
  fairnessResult: FairnessResult,
  popularityBaseline: ScoredRestaurant,
  profiles: StructuredUserProfile[]
): { vsPopularity: number; vsRandom: number };

/**
 * Full scenario evaluation
 */
export function evaluateScenario(
  candidates: ScoredRestaurant[],
  selected: ScoredRestaurant,
  profiles: StructuredUserProfile[],
  fairnessResult: FairnessResult
): EvaluationMetrics;
```

### 5.3 Updated: `app/eval/page.tsx`

Add to the eval dashboard:

- **Summary stats row**: Avg Precision@5, Avg NDCG@5, Avg improvement vs baseline
- **Baseline comparison chart**: For each scenario, bar chart showing Nash(ours) vs Nash(popularity) vs Nash(random)
- **Per-scenario IR metrics**: Precision@5, NDCG@5, MRR in the expanded result view

---

## Part 6: IDF-Weighted Satisfaction Scoring

### 6.1 Concept (MIE451 — TF-IDF in Scoring)

Current `calculateSoftMatch` treats all constraints equally. With IDF weighting:

```
User prefers "halal" (score 8, confidence 0.9)
  IDF("halal") = log₁₀(356 / 5) = 1.85
  Weight = 8 × 0.9 × 1.85 = 13.3

User prefers "italian" (score 7, confidence 0.8)
  IDF("italian") = log₁₀(356 / 50) = 0.85
  Weight = 7 × 0.8 × 0.85 = 4.8

→ Halal preference contributes ~3× more.
```

This is implemented within the feature vector construction (Part 2).

---

## Implementation Order

```
Phase 1: Foundation                (lib/retrieval/)
  1a  inverted-index.ts            Build inverted index
  1b  sparse-retrieval.ts          Boolean filtering + TF-IDF scoring

Phase 2: Feature Vectors           (lib/scoring/)
  2a  feature-vectors.ts           User and restaurant feature vectors
  2b  Modify fairness.ts           Use feature vectors in calculateUserSatisfaction

Phase 3: Baselines                 (lib/baselines/)
  3a  popularity-baseline.ts       Simple popularity recommendation

Phase 4: Cold-Start                (lib/scoring/)
  4a  cold-start.ts                Handle low-confidence users

Phase 5: Hybrid Integration        (lib/retrieval/ + app/api/)
  5a  hybrid-retrieval.ts          Combine sparse + dense retrieval
  5b  Modify recommend/route.ts    Use hybrid pipeline

Phase 6: Evaluation                (lib/eval/ + app/eval/)
  6a  metrics.ts                   IR evaluation metrics (Precision@K, NDCG@K)
  6b  Update eval/page.tsx         Display new metrics + baseline comparisons
```

---

## File Summary

### New Files

| File | Purpose | MIE451 Concept |
|------|---------|----------------|
| `lib/retrieval/inverted-index.ts` | Inverted index + TF-IDF | Information Retrieval |
| `lib/retrieval/sparse-retrieval.ts` | Boolean filtering + TF-IDF scoring | IR Stage 1 |
| `lib/retrieval/hybrid-retrieval.ts` | Two-stage retrieval pipeline | Hybrid Retrieval |
| `lib/scoring/feature-vectors.ts` | User/restaurant feature vectors | Content-Based Filtering |
| `lib/scoring/cold-start.ts` | Cold-start user handling | Cold-Start Problem |
| `lib/baselines/popularity-baseline.ts` | Popularity baseline | Module 10: Baselines |
| `lib/eval/metrics.ts` | IR evaluation metrics | Precision, NDCG |

### Modified Files

| File | Changes | MIE451 Concept |
|------|---------|----------------|
| `app/api/recommend/route.ts` | Use hybrid retrieval, add baselines | Two-Stage Retrieval |
| `lib/fairness.ts` | Feature vector scoring in `calculateUserSatisfaction` | CBF + IDF Weighting |
| `app/eval/page.tsx` | IR metrics, baseline comparison charts | Evaluation |
| `lib/types.ts` | New interfaces for retrieval/eval results | Type Safety |
