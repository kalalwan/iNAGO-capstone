# iNAGO Eats: Decision Support System Architecture

## A Taxonomical Technical Reference

---

## Table of Contents

1. [System Classification](#1-system-classification)
2. [Data Layer: Corpus and Schema](#2-data-layer-corpus-and-schema)
3. [Input Subsystem: Preference Elicitation](#3-input-subsystem-preference-elicitation)
4. [Knowledge Base: User Profile Model](#4-knowledge-base-user-profile-model)
5. [Constraint Taxonomy and Extraction](#5-constraint-taxonomy-and-extraction)
6. [Retrieval Subsystem: Hybrid Two-Stage Pipeline](#6-retrieval-subsystem-hybrid-two-stage-pipeline)
7. [Scoring Subsystem: Content-Based Filtering](#7-scoring-subsystem-content-based-filtering)
8. [Aggregation Subsystem: Group Fairness](#8-aggregation-subsystem-group-fairness)
9. [Selection Subsystem: Pareto-Nash Optimization](#9-selection-subsystem-pareto-nash-optimization)
10. [Cold-Start Handling](#10-cold-start-handling)
11. [Explanation and Output Subsystem](#11-explanation-and-output-subsystem)
12. [Feedback Loop: Critique and Re-Recommendation](#12-feedback-loop-critique-and-re-recommendation)
13. [Evaluation Framework](#13-evaluation-framework)
14. [Complete Pipeline Execution Trace](#14-complete-pipeline-execution-trace)
15. [Module Dependency Map](#15-module-dependency-map)

---

## 1. System Classification

### 1.1 DSS Taxonomy Position

iNAGO Eats is a **model-driven, multi-stakeholder group decision support system** for restaurant selection. Under Sprague and Carlson's DSS taxonomy, it is classified as:

| Dimension | Classification |
|---|---|
| **DSS Type** | Model-driven (optimization-based selection) |
| **User Count** | Multi-user / Group DSS (GDSS) |
| **Decision Type** | Semi-structured (preferences are subjective; constraints are objective) |
| **Domain** | Restaurant recommendation in Toronto |
| **Interaction Model** | Conversational elicitation with iterative critique |

### 1.2 Core Design Principles

The system operates under three governing principles:

1. **Hard constraints are inviolable.** A restaurant that violates any user's dietary restriction or allergy receives a satisfaction score of zero. No optimization can override this.

2. **Fairness is the objective function.** The system does not maximize aggregate satisfaction (utilitarian). It maximizes Nash Welfare — the geometric mean of individual satisfactions — which inherently penalizes inequality.

3. **Retrieval precedes scoring.** The system uses a two-stage architecture where a fast retrieval phase narrows 356 restaurants to ~15 candidates before the expensive fairness computation runs. This is a direct application of the inverted-index-then-rerank paradigm from information retrieval.

### 1.3 Theoretical Foundations (MIE451 Mapping)

| System Component | MIE451 Module | Concept |
|---|---|---|
| Inverted Index | 1.4 | Boolean retrieval, posting lists |
| TF-IDF Weighting | 1.10–1.11 | Log-frequency TF, IDF for rare term amplification |
| Cosine Similarity | 1.12 | Vector space model |
| Precision@K, NDCG@K | 1.14 | IR evaluation metrics |
| Feature Vectors (CBF) | 5.2 | Content-based filtering |
| Cold-Start Problem | 5.4, 5.8 | Popularity fallback for unknown users |
| Popularity Baseline | 10 | "Always compare to baselines" |
| Nash Welfare | 9 | Social choice theory for group fairness |
| Reciprocal Rank Fusion | 1 (extended) | Combining ranked retrieval results |

---

## 2. Data Layer: Corpus and Schema

### 2.1 Restaurant Corpus

**Source file:** `lib/data.ts`

The corpus consists of **356 Toronto restaurants** stored as a static JSON array (`RESTAURANTS`). Each restaurant is a document in the information retrieval sense.

### 2.2 Restaurant Schema

**Type definition:** `lib/types.ts:17–34`

```
Restaurant {
  id: string               // Unique identifier (e.g., "pai-northern-thai")
  name: string             // Display name
  cuisine: string          // Primary cuisine (may be comma-separated: "Japanese, Sushi Bars")
  price: string            // Price level: "$", "$$", "$$$", "$$$$", or "CA$X–Y"
  rating: number           // Yelp rating (1.0–5.0)
  reviewCount: number      // Number of Yelp reviews
  description: string      // Free-text description
  location: string         // Area within Toronto (e.g., "Entertainment District, Downtown Core")
  address: string          // Street address
  phone: string            // Contact number
  website: string          // Restaurant website URL
  yelp_url: string         // Yelp listing URL
  tags: string[]           // Array of categorical labels (e.g., ["japanese", "sushi", "trendy"])
  images: string[]         // Image URLs
  lat: number              // Latitude for distance calculation
  lon: number              // Longitude for distance calculation
}
```

### 2.3 Corpus Statistics

| Metric | Value |
|---|---|
| Total restaurants | 356 |
| Distinct cuisines | ~45 |
| Distinct tags | ~200 (166 with frequency ≤ 5) |
| Price distribution | $: 174, $$: 70, $$$: 46, $$$$: 16, CA$ formats: ~50 |
| Location distribution | Downtown Core: 87, Entertainment District: 22, others distributed |
| Rating range | 1.0–5.0 (median ~4.0) |

The high number of rare tags (166 with DF ≤ 5) is significant because IDF amplification gives these terms high discriminative power in the retrieval stage.

---

## 3. Input Subsystem: Preference Elicitation

The system uses a **three-layer preference extraction architecture** that processes natural language messages from group chat.

### 3.1 Layer 1: Local Regex Extraction (No API)

**Source:** `lib/profile-utils.ts:28–161` — `extractLocalPreferences()`

The first extraction layer uses regular expression pattern matching to extract structured preferences from free text. This runs on every message with zero latency and no API cost.

**Extraction categories and patterns:**

| Category | Pattern Examples | Output |
|---|---|---|
| Dietary | `/\b(vegan\|plant-based\|no animal products?)\b/` | `{ type: 'vegan', strictness: 'strict'\|'flexible' }` |
| Allergies | `/\b(allergic to\|allergy to)\s+(\w+)/gi` | `allergies: ['peanuts']` |
| Cuisines | Exact match against 32-item cuisine vocabulary | `cuisines: ['thai', 'japanese']` |
| Cuisine dislikes | `/\b(don't like\|hate\|dislike)\s+(\w+)/gi` | `cuisineDislikes: ['sushi']` |
| Price | `/\b(cheap\|budget\|affordable)\b/` → `$` | `price: '$'` |
| Location | Exact match against 18 Toronto neighborhoods | `location: ['downtown']` |
| Ambiance | Keyword → category mapping (e.g., "chill" → "casual") | `ambiance: ['casual']` |
| Negations | `/\b(no\|don't want\|avoid)\s+(\w+)/gi` | `negations: ['seafood']` |

**Strictness detection:** The system promotes dietary restrictions to `strict` when the message contains reinforcement words: `strict`, `always`, `must`, `need`, `can't eat`, `cannot eat`, `allergic`.

### 3.2 Layer 2: LLM Extraction (GPT-3.5-Turbo)

**Source:** `app/api/analyze/route.ts:66–133`

When local extraction is insufficient (determined by `needsAPIExtraction()`), the system calls GPT-3.5-Turbo-0125 with JSON mode to extract nuanced preferences.

**API invocation criteria** (`lib/profile-utils.ts:166–191`):
- Local extraction found nothing, but the message has > 5 words
- Message contains complex language: `but`, `except`, `unless`, `prefer`, `rather`, `depends`
- Message is long (> 20 words) AND complex

**API call is debounced** at 2-second intervals to prevent rapid redundant calls.

The LLM receives the full conversation history and returns a structured JSON object per user. Results are merged into existing profiles via `updateProfile()`.

### 3.3 Layer 3: Conversation Engine Elicitation

**Source:** `lib/conversation-engine.ts:111–198` — `processMessage()`

The conversation engine actively drives elicitation by generating targeted questions for users with low confidence scores.

**Conversation phases:**

```
greeting → elicitation → clarification → ready → recommendation → critique → comparison
                ↑___________________________|           |________________↑
```

**Elicitation question generation** (`generateElicitationQuestions()`, line 204):

The system identifies which users have low confidence in specific dimensions and generates prioritized questions:

| Confidence Dimension | Threshold | Priority Formula | Example Question |
|---|---|---|---|
| Cuisine | < 0.3 | `10 - conf × 10` | "What type of food are you in the mood for?" |
| Dietary | < 0.3 | `9 - conf × 10` | "Do you have any dietary restrictions?" |
| Budget | < 0.3 | `7 - conf × 10` | "What's your budget range?" |
| Location | < 0.3 | `5 - conf × 10` | "Any preference for which part of the city?" |

Questions are triggered every 3 turns if low-confidence users remain.

### 3.4 Layer 4: Restaurant Q&A Module

**Source:** `lib/restaurant-qa.ts`

When a user asks a question (detected by `detectQuestion()` — checks for question words, question marks, or implicit question phrases), the system answers using the restaurant corpus directly, without an API call.

**Restaurant resolution order:**
1. Exact name match in message text
2. Partial name match (first word of restaurant name, > 3 chars)
3. Pronoun reference ("that place", "the restaurant", "it") → resolves to most recent recommendation

**Question categories handled:** price, location/distance, cuisine/food type, rating/quality, features (parking, outdoor, vegan, etc.), general info.

---

## 4. Knowledge Base: User Profile Model

### 4.1 Profile Schema

**Type definition:** `lib/types.ts:108–165`

Each user's knowledge state is encoded as a `StructuredUserProfile`:

```
StructuredUserProfile {
  id: string
  name: string
  color: string                           // UI color for chat bubbles

  dietary: {
    restrictions: DietaryRestriction[]    // [{type: 'vegan', strictness: 'strict'}]
    allergies: string[]                   // ['peanuts', 'shellfish']
    religious: 'halal' | 'kosher' | null
    medicalConditions: string[]
  }

  cuisinePreferences: {
    favorites: CuisinePreference[]        // [{cuisine:'thai', score:8, frequency:3}]
    dislikes: string[]                    // ['sushi']
    adventurousness: number               // 1–5 scale
  }

  budget: {
    preferred: '$' | '$$' | '$$$' | '$$$$' | null
    maxAcceptable: '$' | '$$' | '$$$' | '$$$$' | null
    flexibility: number                   // 1–5 (higher = more flexible on price)
  }

  location: {
    preferredAreas: string[]              // ['downtown', 'kensington']
    maxDistance: number                    // km
    hasTransportation: boolean
  }

  diningStyle: {
    preferredAmbiance: ('casual'|'upscale'|'trendy'|'quiet'|'lively')[]
    groupSizePreference: 'intimate' | 'medium' | 'large' | null
    timePreference: 'lunch' | 'dinner' | 'late-night' | 'any'
  }

  history: {
    visitedRestaurants: string[]
    ratings: Record<string, number>
    lastUpdated: number                   // epoch timestamp
    totalInteractions: number
  }

  confidence: {
    dietary: number                       // 0.0 – 1.0
    cuisine: number                       // 0.0 – 1.0
    budget: number                        // 0.0 – 1.0
    location: number                      // 0.0 – 1.0
    overall: number                       // arithmetic mean of the four above
  }
}
```

### 4.2 Confidence Model

The confidence model tracks how much the system knows about each user across four dimensions. Confidence is updated incrementally:

| Event | Confidence Change |
|---|---|
| New dietary restriction added | `dietary = max(current, 0.6)` |
| Dietary restriction reinforced | `dietary += 0.15` (capped at 1.0) |
| Allergy mentioned | `dietary += 0.2` |
| Cuisine preference mentioned | `cuisine += 0.1` |
| Price preference stated | `budget += 0.2` |
| Location preference stated | `location += 0.15` |

**Overall confidence** = arithmetic mean of the four dimension-specific confidences.

### 4.3 Temporal Decay

**Source:** `lib/profile-utils.ts:299–310`

Cuisine preference scores decay over time using exponential decay:

```
score_new = score × 0.95^(weeks_since_last_mention)
```

Preferences with score < 1.0 after decay are removed entirely. This ensures the system forgets stale preferences while remembering recently reinforced ones.

---

## 5. Constraint Taxonomy and Extraction

### 5.1 Three-Tier Constraint Classification

**Source:** `lib/fairness.ts:42–125` — `extractConstraints()`

The system classifies every user preference into one of three constraint tiers:

#### Tier 1: Hard Constraints (Boolean, inviolable)

Hard constraints are pass/fail. A restaurant that fails any hard constraint for any user receives a satisfaction score of **zero**.

| Source | Constraint Type | Example |
|---|---|---|
| `dietary.restrictions` where `strictness === 'strict'` | `dietary` | `{type:'dietary', value:'vegan'}` |
| `dietary.allergies` | `allergy` | `{type:'allergy', value:'peanut'}` |
| `dietary.religious` | `dietary` | `{type:'dietary', value:'halal'}` |

**Hard constraint checking** (`restaurantSatisfiesHard()`, line 134):

| Constraint | Matching Logic |
|---|---|
| Vegan | Tags contain "vegan" OR cuisine contains "vegan" OR description contains "vegan" |
| Vegetarian | Same as vegan, PLUS accepts "vegetarian" tag/cuisine/description |
| Halal | Tags contain "halal" OR description contains "halal" |
| Kosher | Tags contain "kosher" OR description contains "kosher" |
| Gluten-free | Tags contain "gluten" OR description contains "gluten-free" |
| Nut allergy | Restaurant does NOT have "nut" in tags AND does NOT mention "peanut"/"tree nut" in description |

#### Tier 2: Soft Constraints (Weighted, gradual)

Soft constraints contribute proportionally to satisfaction. Each has a weight (1–5) reflecting importance.

| Source | Constraint Type | Weight Formula |
|---|---|---|
| `cuisinePreferences.favorites` (top 5) | `cuisine` | `ceil(score / 2)` → 1–5 |
| `cuisinePreferences.dislikes` | `cuisine` (negative) | Fixed weight 3 |
| `budget.preferred` | `price` | `6 - flexibility` → 1–5 |
| `location.preferredAreas` | `location` | Fixed weight 2 |
| `diningStyle.preferredAmbiance` | `ambiance` | Fixed weight 1 |
| Flexible dietary restrictions | `cuisine` | Fixed weight 3 |

**Soft match scoring** (`calculateSoftMatch()`, line 190):

| Type | Scoring Logic |
|---|---|
| Cuisine (positive) | 1.0 if exact match in tags/cuisine; 0.7 if related (e.g., "sushi" related to "japanese"); 0 otherwise |
| Cuisine (negative, `not-X`) | 1.0 if restaurant does NOT contain X; 0 if it does |
| Price | `max(0, 1 - |wanted - actual| × 0.3)` where price levels are mapped to integers 1–4 |
| Location | 1.0 if exact match; 0.8 if "downtown" matches "core"/"central"; 0.2 base |
| Ambiance | 0.8 if price proxy matches ($ = casual, $$$+ = upscale); 0.5 otherwise |

**Cuisine relation graph** (used for partial matches):
```
asian → [chinese, japanese, thai, korean, vietnamese, sushi]
sushi → [japanese]
bbq → [american, smokehouse, grill]
italian → [pizza, pasta]
mexican → [latin, tacos]
```

#### Tier 3: Bonus Constraints (Binary, additive)

Bonus constraints add +0.1 each to the final score if present.

| Type | Detection Logic |
|---|---|
| Outdoor seating | Tags contain "patio"/"outdoor" OR description contains "patio"/"outdoor" |
| Parking | Description contains "parking" |
| Late-night | Tags contain "late" OR description contains "late night" |

---

## 6. Retrieval Subsystem: Hybrid Two-Stage Pipeline

### 6.1 Architecture Overview

**Source:** `lib/retrieval/hybrid-retrieval.ts`

The retrieval subsystem narrows 356 restaurants to ~15 candidates using a two-stage hybrid pipeline with Reciprocal Rank Fusion:

```
┌─────────────────────────────────────────────────────────┐
│                  356 Restaurants                         │
│                       │                                  │
│          ┌────────────┴────────────┐                     │
│          │                         │                     │
│   Stage 1: Sparse             Stage 2: Dense             │
│   (Inverted Index +           (Feature Vectors OR        │
│    Boolean + TF-IDF)           OpenAI Embeddings)        │
│          │                         │                     │
│     Top 50 by TF-IDF        Top 30 by cosine sim        │
│          │                         │                     │
│          └────────────┬────────────┘                     │
│                       │                                  │
│              Reciprocal Rank Fusion                      │
│                       │                                  │
│                  Top 15 candidates                       │
└─────────────────────────────────────────────────────────┘
```

**Default configuration** (`DEFAULT_CONFIG`):
```
sparseTopK:   50    // Candidates from sparse stage
denseTopK:    30    // Candidates from dense stage
finalTopK:    15    // Candidates after RRF fusion
rrfK:         60    // RRF damping constant
sparseWeight: 0.4   // Weight for sparse in RRF (dense gets 0.6)
```

### 6.2 Stage 1: Inverted Index Construction

**Source:** `lib/retrieval/inverted-index.ts`

#### 6.2.1 Term Extraction

Each restaurant document is tokenized into terms from six sources:

| Source | Processing | Example Terms |
|---|---|---|
| `cuisine` field | Split by comma/slash, normalize | `["japanese", "sushi"]` |
| `tags` array | Normalize each tag | `["trendy", "bar", "seafood"]` |
| `location` field | Split by comma, normalize | `["entertainment district", "downtown core"]` |
| `price` field | Map to categorical terms | `"$$"` → `["moderate"]` |
| `rating` field | Map to rating tier | `4.5` → `["highly-rated"]` |
| `description` field | Keyword scan for dietary terms only | `["vegan", "gluten-free"]` |

Price normalization:
```
"$"    → ["cheap", "budget"]
"$$"   → ["moderate"]
"$$$"  → ["upscale"]
"$$$$" → ["luxury", "expensive"]
```

Rating tiers:
```
≥ 4.5 → "highly-rated"
≥ 4.0 → "well-rated"
≥ 3.5 → "average-rated"
```

#### 6.2.2 Term Normalization

**Source:** `inverted-index.ts:61–64` — `normalizeTerm()`

All terms are lowercased, trimmed, and passed through a synonym map:

```
bbq         → barbecue
barbeque    → barbecue
veggie      → vegetarian
veg         → vegetarian
plant-based → vegan
gf          → gluten-free
gluten free → gluten-free
dairy free  → dairy-free
nut free    → nut-free
sushi bars  → sushi
cocktail bars → bar
wine bars   → bar
sports bars → bar
canadian (new) → canadian
breakfast & brunch → brunch
fast food   → fast-food
```

#### 6.2.3 TF-IDF Computation

**Formulas:**

```
TF(t, d) = 1 + log₁₀(raw_count(t, d))       [Log-frequency weighting]
IDF(t)   = log₁₀(N / DF(t))                  [Standard IDF]
TF-IDF(t, d) = TF(t, d) × IDF(t)
```

Where:
- `N` = 356 (total restaurants)
- `DF(t)` = number of restaurants containing term `t`

**IDF interpretation:** A term appearing in 1 restaurant has IDF = log₁₀(356) = 2.55. A term appearing in all 356 has IDF = 0. The 166 terms with DF ≤ 5 have IDF ≥ log₁₀(71.2) = 1.85.

**Index data structure:**
```
InvertedIndex {
  termIndex: Map<term, Map<restaurantId, tfidf_score>>
  idfValues: Map<term, idf>
  documentFrequency: Map<term, df>
  totalDocuments: 356
}
```

The index is built once and cached as a module-level singleton (`cachedIndex` in `hybrid-retrieval.ts:79`).

### 6.3 Stage 1 Execution: Sparse Retrieval

**Source:** `lib/retrieval/sparse-retrieval.ts:152–229` — `sparseRetrieve()`

**Algorithm:**

1. **Gather constraints** from ALL user profiles via `extractConstraints()`.
2. **Hard constraint → query terms:**
   - Dietary constraints → `mustMatch` terms (e.g., `halal` → `mustMatch: ["halal"]`)
   - Allergy constraints → `mustNotMatch` terms (e.g., `peanut` → `mustNotMatch: ["peanut", "nut", "tree-nut"]`)
3. **Boolean AND filtering:**
   - Retrieve posting lists for all `mustMatch` terms
   - Intersect posting lists (smallest-first optimization)
   - Remove any restaurant in `mustNotMatch` posting lists
   - If intersection is empty → fall back to full corpus
4. **Soft constraint → weighted query:**
   - Each soft constraint value becomes a query term
   - `queryWeight = constraint.weight × max(IDF(term), 0.1)`
   - This means rare preferences (high IDF) are amplified
5. **Score feasible restaurants:**
   - `score(q, d) = Σ_{t ∈ q} queryWeight(t) × TF-IDF(t, d)`
6. **Sort by score descending, return top 50.**

**Posting list intersection** (`intersectPostings()`, line 242):
- Sort lists by size (smallest first) for query optimization
- Iteratively intersect: check each ID in current result against next list
- Early termination when intersection becomes empty

### 6.4 Stage 2: Dense Retrieval

The dense stage has two modes depending on API availability:

#### 6.4.1 Mode A: OpenAI Embedding Dense Retrieval

**Source:** `hybrid-retrieval.ts:173–192` — `runEmbeddingDenseStage()`

When the OpenAI API is available:
1. A **group query** is synthesized from all user profiles' preference summaries and current chat preferences
2. The query is embedded using `text-embedding-3-small` (1536 dimensions)
3. All 356 restaurants are embedded (cached across requests) using the same model
4. Restaurants are scored by cosine similarity to the query embedding
5. Top 30 returned

**Cosine similarity formula:**
```
cos(q, r) = (q · r) / (|q| × |r|)
```

Restaurant text for embedding: `"${name} ${cuisine} ${description} ${price} ${location} ${tags.join(' ')}"`

#### 6.4.2 Mode B: Feature Vector Dense Retrieval (Fallback)

**Source:** `hybrid-retrieval.ts:129–163` — `runDenseStage()`

When the OpenAI API is unavailable, the dense stage uses content-based filtering with explicit feature vectors (see Section 7).

**Key difference from Mode A:** Mode B is fairness-aware at the retrieval stage. Each restaurant is scored per-user, and the per-restaurant aggregation uses the **geometric mean** (Nash-style) across users:

```
denseScore(r) = (∏ᵢ max(cos(uᵢ, r), 0.001))^(1/n)
```

This prevents the dense stage from surfacing restaurants that strongly satisfy one user but completely miss another.

### 6.5 Fusion: Reciprocal Rank Fusion (RRF)

**Source:** `hybrid-retrieval.ts:211–239`

The two ranked lists are merged using RRF:

```
RRF(d) = w_sparse / (k + rank_sparse(d)) + w_dense / (k + rank_dense(d))
```

Where:
- `w_sparse = 0.4`, `w_dense = 0.6`
- `k = 60` (damping constant)
- If a document appears in only one list, its contribution from the missing list is 0

**Properties of RRF:**
- No need to calibrate or normalize raw scores across retrieval methods
- Documents appearing in both lists receive a boost (overlap bonus)
- The `k` constant dampens the influence of top-ranked documents, preventing a rank-1 sparse result from dominating

**Output:** Top 15 candidates by RRF score, packaged as `ScoredRestaurant[]` with the RRF score as the `score` field.

### 6.6 Distance Adjustment

**Source:** `app/api/recommend/route.ts:130–144`

If the user provides their geolocation, a distance bonus is added post-fusion:

```
distanceBonus = max(0, 0.05 × (1 - distance_km / 20))
```

Using the Haversine formula for great-circle distance. Restaurants within 0 km get +0.05; restaurants beyond 20 km get +0.

---

## 7. Scoring Subsystem: Content-Based Filtering

### 7.1 Feature Vector Schema

**Source:** `lib/scoring/feature-vectors.ts`

Each user and restaurant is represented as a **48-dimensional feature vector** stored as a `Float32Array`:

| Dimension Range | Count | Category | Encoding |
|---|---|---|---|
| 0–26 | 27 | Cuisine categories | IDF-weighted for restaurants; `(score/10) × confidence × IDF` for users |
| 27–30 | 4 | Price levels | One-hot (cheap, moderate, upscale, luxury) |
| 31–44 | 14 | Location areas | Binary (Toronto neighborhoods) |
| 45–49 | 5 | Ambiance types | Binary (casual, upscale, trendy, quiet, lively) |
| 50–54 | 5 | Dietary features | IDF-weighted (vegan, vegetarian, gluten-free, halal, kosher) |
| 55 | 1 | Rating | Normalized: `(rating - 1) / 4` → [0, 1] |
| 56 | 1 | Popularity | `min(1, log₁₀(reviewCount + 1) / log₁₀(5001))` |

**Cuisine vocabulary** (27 categories):
```
italian, japanese, chinese, thai, indian, korean, vietnamese, mexican,
american, mediterranean, middle eastern, french, seafood, barbecue,
steakhouse, sushi, ramen, pizza, brunch, cafe, canadian, greek,
caribbean, ethiopian, turkish, spanish, peruvian
```

### 7.2 Restaurant Feature Vector Construction

**Source:** `buildRestaurantFeatureVector()`, line 66

| Feature | Construction |
|---|---|
| Cuisine | If cuisine/tags match category: `vec[i] = max(1, IDF(category))` |
| Price | One-hot encoding of price level |
| Location | Binary: 1 if location string contains the area name |
| Ambiance | Inferred from price/tags: `$` → casual, `$$$+` → upscale, "trendy"/"hip" tag → trendy |
| Dietary | If tag/cuisine/description contains term: `vec[i] = max(1, IDF(term))` |
| Rating | `(rating - 1) / 4`, centered at 3.5 |
| Popularity | `log₁₀(reviewCount + 1)` normalized by `log₁₀(5001)` |

### 7.3 User Feature Vector Construction

**Source:** `buildUserFeatureVector()`, line 143

| Feature | Construction |
|---|---|
| Cuisine favorites | `(preferenceScore/10) × confidence.cuisine × max(IDF, 0.5)` |
| Cuisine dislikes | `-0.5 × confidence.cuisine` (negative weight) |
| Price preferred | `confidence.budget` at preferred level; adjacent levels get `flexibility/5 × confidence × 0.5` |
| Location | `confidence.location` for each preferred area |
| Ambiance | Fixed 0.8 for each preferred type |
| Dietary (strict) | `max(2, IDF × 2)` — hard constraints get maximum IDF-amplified weight |
| Rating | Fixed 0.5 (everyone prefers higher ratings) |
| Popularity | Fixed 0.3 (slight preference for popular places) |

**IDF weighting rationale:** Users who prefer "ethiopian" (rare in corpus, high IDF) will have a much larger feature weight than users who prefer "japanese" (common, low IDF). This naturally amplifies distinctive preferences.

### 7.4 Cosine Similarity Scoring

**Source:** `scoreUserRestaurant()`, line 241

```
cos(u, r) = max(0, min(1, (u · r) / (|u| × |r|)))
```

Clamped to [0, 1]. Negative values (from cuisine dislikes) are floored at 0. This produces the **CBF vector score** for a user-restaurant pair.

### 7.5 Hybrid Satisfaction Scoring

**Source:** `lib/fairness.ts:279–391` — `calculateUserSatisfaction()`

The final per-user satisfaction score blends the CBF vector score with the manual constraint-matching score:

```
finalScore = α × vectorScore + (1 - α) × manualScore
```

Where `α = profile.confidence.overall` (0–1).

**Rationale:** High-confidence users have well-estimated feature vectors (many data points), so the vector score is more reliable. Low-confidence users fall back to the simpler, more robust constraint-matching approach.

The manual score is computed as:
```
manualBase = Σ(match × weight) / Σ(weight)    [weighted average of soft matches]
manualScore = min(1, manualBase × 0.9 + bonusScore + 0.1)
```

The `+ 0.1` ensures any restaurant passing all hard constraints gets at least 10% satisfaction.

---

## 8. Aggregation Subsystem: Group Fairness

### 8.1 Fairness Metrics Computed

**Source:** `lib/fairness.ts:405–457` — `calculateGroupFairness()`

For each candidate restaurant, the system computes four group fairness metrics from the vector of individual satisfaction scores `[u₁, u₂, ..., uₙ]`:

#### 8.1.1 Utilitarian Welfare (Average)

```
U = (1/n) Σᵢ uᵢ
```

Maximizes total satisfaction but is indifferent to distribution. A restaurant where one person scores 100% and another scores 0% has the same utilitarian value as one where both score 50%.

#### 8.1.2 Egalitarian Welfare (Rawlsian Minimax)

```
E = min(u₁, u₂, ..., uₙ)
```

Maximizes the worst-off individual. Based on Rawls' Theory of Justice — the system should optimize for the person least satisfied.

#### 8.1.3 Nash Welfare (Geometric Mean)

```
W_Nash = (∏ᵢ uᵢ)^(1/n)
```

The **primary selection criterion**. Nash Welfare uniquely satisfies three desirable properties:
1. **Pareto efficiency:** If everyone prefers A to B, Nash prefers A to B.
2. **Symmetry:** Swapping two users' scores doesn't change the result.
3. **Scale invariance:** Multiplying all scores by a constant doesn't change the ranking.
4. **Inequality aversion:** Nash punishes unequal distributions. If one user has 0, Nash = 0 regardless of others.

#### 8.1.4 Gini Coefficient (Inequality Measure)

```
G = Σᵢ Σⱼ |uᵢ - uⱼ| / (2n × Σᵢ uᵢ)
```

Ranges from 0 (perfect equality) to 1 (maximum inequality). Used as a diagnostic rather than a selection criterion.

### 8.2 Hard Constraint Failure Behavior

If ANY user has a hard constraint violation (`satisfied === false`), the restaurant receives:
```
{ utilitarian: 0, egalitarian: 0, nash: 0, gini: 1 }
```

This ensures hard-constraint-violating restaurants can never be selected through any fairness criterion.

---

## 9. Selection Subsystem: Pareto-Nash Optimization

### 9.1 Selection Algorithm

**Source:** `lib/fairness.ts:507–582` — `selectBestRestaurant()`

The selection algorithm applies a **three-stage filter:**

```
15 candidates (from hybrid retrieval)
        │
  Stage 1: Hard Constraint Filter
  Remove any candidate where any user's satisfaction = 0
        │
  Stage 2: Pareto Efficiency Filter
  Remove dominated candidates
        │
  Stage 3: Nash Welfare Maximization
  Select the Pareto-efficient candidate with highest Nash Welfare
  Tie-break 1: Higher egalitarian (min satisfaction)
  Tie-break 2: Higher vector similarity score
```

### 9.2 Pareto Efficiency Filter

**Source:** `filterParetoEfficient()`, line 470

A candidate A is **Pareto dominated** by candidate B if:
- B makes every user at least as satisfied as A (`∀i: uᵢ(B) ≥ uᵢ(A)`)
- B makes at least one user strictly more satisfied (`∃i: uᵢ(B) > uᵢ(A)`)

Dominated candidates are removed because there is no rational reason to choose them — another option exists that is objectively at least as good for everyone and strictly better for someone.

### 9.3 Nash Welfare Selection

Among the Pareto-efficient set, the system selects by maximum Nash Welfare.

**Tie-breaking cascade:**
1. Higher Nash Welfare (primary)
2. Higher egalitarian welfare — prefers the option that's better for the worst-off user
3. Higher vector similarity score — prefers the option that semantically matches the group query better

### 9.4 Infeasibility Handling

If no restaurant satisfies all hard constraints (Pareto set is empty), the system falls back to the candidate with the highest utilitarian score from the original set and flags the result as `isParetoEfficient: false`.

---

## 10. Cold-Start Handling

### 10.1 Problem Statement

**Source:** `lib/scoring/cold-start.ts`

When a user has `confidence.overall < 0.3` (the cold-start threshold), their preference vector is poorly estimated. In standard Nash Welfare, if a cold-start user randomly gets a low score (e.g., 0.1), it drags the entire geometric mean down even though we have no real evidence about their preferences.

### 10.2 Cold-Start Satisfaction

For cold-start users, the system replaces preference-based scoring with popularity-based scoring:

```
popNorm = min(1, popularityScore / maxPopularity)
coldScore = 0.5 + 0.3 × (popNorm - 0.5)
```

Where `popularityScore = rating × log₁₀(reviewCount + 1)`.

This maps popularity [0, 1] → satisfaction [0.35, 0.65]. The narrow range prevents cold-start users from having extreme influence on Nash Welfare in either direction.

### 10.3 Robust Nash Welfare

**Source:** `calculateRobustNashWelfare()`, line 93

The system separates warm and cold users for Nash computation:

```
Let W = set of warm users, C = set of cold users
w = |W| / (|W| + |C|)     [proportion of warm users]

Nash_warm = (∏_{i ∈ W} uᵢ)^(1/|W|)        [geometric mean of warm scores]
Avg_cold  = (1/|C|) Σ_{i ∈ C} uᵢ           [arithmetic mean of cold scores]

Nash_adjusted = Nash_warm^w × Avg_cold^(1-w)
```

**Boundary cases:**
- All warm: `Nash_adjusted = Nash_warm` (standard Nash)
- All cold: `Nash_adjusted = Avg_cold` (popularity-based, no geometric penalty)
- Mixed: Blends proportionally

---

## 11. Explanation and Output Subsystem

### 11.1 Structured Fairness Explanation

**Source:** `lib/fairness.ts:588–633` — `generateFairnessExplanation()`

The system generates a structured explanation containing:
1. Restaurant name, cuisine, and address
2. Fairness scores: Nash Welfare, average satisfaction, minimum satisfaction, Gini
3. Per-user satisfaction breakdown with percentages
4. Selection method disclosure ("Pareto filtering + Nash Welfare maximization")

### 11.2 LLM-Generated Natural Language Explanation

**Source:** `app/api/recommend/route.ts:177–246`

The structured fairness explanation is supplemented with a 2–3 sentence natural language explanation generated by GPT-4-Turbo. The LLM receives:
- The selected restaurant name
- The full conversation history
- User profile summaries
- All fairness metrics and per-user scores

The LLM is prompted to explain why the restaurant accommodates everyone's needs, adding human-readable context on top of the mathematical scores.

### 11.3 Trade-Off Surfacing

**Source:** `lib/conversation-engine.ts:387–398` — `generateTradeOffSummary()`

When the Gini coefficient exceeds 0.3 (significant inequality), the system proactively surfaces the trade-off:

> "I notice [highest-scored user] would really enjoy this choice (X% satisfaction) but [lowest-scored user] is less excited (Y%). Would you like to see alternatives that are more balanced?"

### 11.4 Comparison Summary

**Source:** `generateComparisonSummary()`, line 400

For the top 3 candidates, the system generates a comparison showing:
- Nash Welfare percentage
- Which user is best served and their score
- Which user is worst served and their score

---

## 12. Feedback Loop: Critique and Re-Recommendation

### 12.1 Critique Detection

**Source:** `lib/conversation-engine.ts:259–290` — `detectCritique()`

After a recommendation is presented, the system monitors for five categories of critique:

| Critique Type | Detection Pattern | Example |
|---|---|---|
| `too_expensive` | `/too expensive\|too pricey\|can't afford\|over budget/` | "That's too pricey for me" |
| `wrong_cuisine` | `/don't like\|not in the mood\|hate that\|not into/` | "I'm not in the mood for Thai" |
| `too_far` | `/too far\|don't want to drive\|not close enough/` | "That's too far away" |
| `dietary_concern` | `/can't eat there\|not safe\|allergic\|intolerant/` | "I can't eat there — allergies" |
| `general_dislike` | `/no thanks\|not that one\|try again\|something else/` | "Nah, something else" |

### 12.2 Profile Update from Critique

**Source:** `handleCritique()`, line 296

Each critique type triggers a targeted profile update:

| Critique | Profile Modification | Confidence Change |
|---|---|---|
| `too_expensive` | Downgrade `budget.preferred` by one level; reduce flexibility by 1 | `budget += 0.2` |
| `wrong_cuisine` | Extract cuisine from message, add to `cuisinePreferences.dislikes` | `cuisine += 0.1` |
| `too_far` | Reduce `location.maxDistance` by 3 km (min 2 km) | `location += 0.15` |
| `dietary_concern` | Flag for re-check | `dietary += 0.1` |
| `general_dislike` | No constraint change | (none) |

After the profile update, the user is prompted to generate a new recommendation, which re-runs the entire pipeline with the updated constraints.

---

## 13. Evaluation Framework

### 13.1 Baselines

**Source:** `lib/baselines/popularity-baseline.ts`

#### 13.1.1 Popularity Baseline

```
popularityScore(r) = r.rating × log₁₀(r.reviewCount + 1)
```

Algorithm:
1. Filter restaurants by hard constraints (AND across all users)
2. Score by popularity
3. Normalize to [0, 1] relative to top score
4. Return top K

This baseline ignores all soft preferences, cuisine preferences, and budget alignment. It represents the "just pick the most popular place" strategy.

#### 13.1.2 Random Baseline

Fisher-Yates shuffle of hard-constraint-satisfying restaurants, return top K. Represents the performance floor — what you'd get by random chance among feasible restaurants.

### 13.2 IR Evaluation Metrics

**Source:** `lib/eval/metrics.ts`

#### 13.2.1 Relevance Judgments (Auto-Generated)

Since human relevance judgments are not available, the system auto-generates them using Nash Welfare as the relevance signal:

| Nash Welfare | Grade | Label |
|---|---|---|
| ≥ 0.6 and no hard violations | 3 | Highly relevant |
| ≥ 0.4 and no hard violations | 2 | Relevant |
| ≥ 0.2 and no hard violations | 1 | Marginal |
| < 0.2 or hard violations | 0 | Not relevant |

This is applied to all 356 restaurants to create a full judgment set.

#### 13.2.2 Precision@K

```
P@K = |{r ∈ top-K : grade(r) ≥ 2}| / K
```

Measures: Of the top K results returned, what fraction are relevant (grade ≥ 2)?

#### 13.2.3 NDCG@K (Normalized Discounted Cumulative Gain)

```
DCG@K = Σ_{i=1}^{K} (2^{rel_i} - 1) / log₂(i + 1)
IDCG@K = DCG of ideal ranking (grades sorted descending)
NDCG@K = DCG@K / IDCG@K
```

Measures ranking quality: NDCG = 1.0 means the system's ranking perfectly matches the ideal ordering by relevance. NDCG < 1.0 means highly relevant items are ranked lower than they should be.

#### 13.2.4 Nash Lift over Popularity

```
NashLift = (Nash_system - Nash_popularity) / Nash_popularity
```

Measures the percentage improvement in Nash Welfare that the hybrid system achieves over the popularity baseline. Positive values indicate the system is finding fairer restaurants than a naive popularity sort.

### 13.3 Evaluation Scenarios

**Source:** `lib/eval-scenarios.ts`

The evaluation dashboard runs the full pipeline on predefined scenarios with diverse constraint configurations:
- Vegan + non-vegan mixed groups
- Halal requirements with budget constraints
- Large groups (4+ users) with conflicting cuisine preferences
- Cold-start users mixed with well-profiled users

Each scenario tests a specific aspect of the system's constraint satisfaction, fairness, and retrieval quality.

---

## 14. Complete Pipeline Execution Trace

This section traces a single recommendation request through every subsystem.

### Step 1: User Input Arrives

```
POST /api/recommend
{
  preferences: { "Aisha": "halal, likes indian", "John": "loves sushi, budget" },
  messages: [...conversation history...],
  userProfiles: { "u1": {...}, "u2": {...} },
  userLocation: { lat: 43.65, lon: -79.38 }
}
```

### Step 2: Profile Assembly

Existing `StructuredUserProfile` objects are loaded from the request body. If absent, minimal profiles are created from preference strings via `createEmptyProfile()`.

### Step 3: Group Query Synthesis

Profile summaries are concatenated into a group query string:
```
"halal, likes indian HALAL • likes indian • budget VEGAN • likes sushi • budget-friendly"
```

### Step 4: Embedding Computation (OpenAI API)

The group query is embedded via `text-embedding-3-small` → 1536-dimension vector. Restaurant embeddings are cached from first request.

### Step 5: Hybrid Retrieval

#### 5a. Inverted Index (built once, cached)
356 restaurants → ~200 unique terms → TF-IDF posting lists.

#### 5b. Sparse Retrieval
- `extractConstraints(Aisha)` → hard: `[{type:'dietary', value:'halal'}]`, soft: `[{type:'cuisine', value:'indian', weight:3}]`
- `extractConstraints(John)` → hard: `[]`, soft: `[{type:'cuisine', value:'sushi', weight:3}, {type:'price', value:'$', weight:4}]`
- Hard constraints: Boolean AND on "halal" posting list → ~15 restaurants with halal tag
- Soft query: `{halal: 3×IDF, indian: 3×IDF, sushi: 3×IDF, cheap: 4×IDF}`
- Score each feasible restaurant → sort → top 50

#### 5c. Dense Retrieval
- OpenAI embedding cosine similarity between group query and each restaurant → top 30

#### 5d. RRF Fusion
- `RRF(d) = 0.4/(60+rank_sparse) + 0.6/(60+rank_dense)`
- Sort by RRF → top 15 candidates

### Step 6: Distance Adjustment

For each of the 15 candidates with lat/lon data, add `max(0, 0.05 × (1 - distance/20))`. Re-sort.

### Step 7: Per-User Satisfaction Scoring

For each of 15 candidates, for each of 2 users:

**Aisha (confidence: 0.7, warm user):**
1. Hard constraint check: does restaurant have halal? If no → score = 0, done.
2. Build user feature vector (48-dim) with IDF-weighted halal and indian preferences.
3. Build restaurant feature vector.
4. `vectorScore = cos(userVec, restVec)` → e.g., 0.72
5. Manual soft-match: halal match (1.0 × weight 3) + indian match (0.7 × weight 3) = 5.1/6 = 0.85
6. `manualScore = min(1, 0.85 × 0.9 + 0 + 0.1)` = 0.865
7. `finalScore = 0.7 × 0.72 + 0.3 × 0.865` = 0.504 + 0.260 = **0.764**

**John (confidence: 0.4, warm user):**
1. No hard constraints → passes.
2. Feature vector scoring → e.g., 0.45 (halal restaurant may not be sushi)
3. Manual soft-match: sushi match (0.0) + budget match (e.g., 0.7) = modest
4. Blended score → e.g., **0.48**

### Step 8: Group Fairness Metrics

For this restaurant:
```
utilitarian = (0.764 + 0.48) / 2 = 0.622
egalitarian = min(0.764, 0.48) = 0.48
nash = (0.764 × 0.48)^(1/2) = (0.367)^0.5 = 0.605
gini = |0.764 - 0.48| / (2 × 2 × 0.622) = 0.114
```

### Step 9: Pareto Filter + Nash Selection

Repeat steps 7–8 for all 15 candidates. Remove Pareto-dominated options. Select the candidate with the highest Nash Welfare.

### Step 10: Explanation Generation

Structured explanation + GPT-4-Turbo natural language explanation.

### Step 11: Response

```json
{
  "candidates": [...top 4 with fairness metrics...],
  "recommendation": "...structured + natural language...",
  "fairnessResult": { "restaurantId": "...", "metrics": {...}, "isParetoEfficient": true },
  "selectionMethod": "hybrid-pareto-nash",
  "baselineComparison": { "popularityTop3": [...] },
  "retrievalDiagnostics": { "sparseCount": 50, "denseCount": 30, "overlapCount": 12 }
}
```

---

## 15. Module Dependency Map

```
app/api/recommend/route.ts          ← Entry point (HTTP POST)
  ├── lib/retrieval/hybrid-retrieval.ts
  │     ├── lib/retrieval/inverted-index.ts
  │     │     └── lib/types.ts (Restaurant)
  │     ├── lib/retrieval/sparse-retrieval.ts
  │     │     ├── lib/retrieval/inverted-index.ts
  │     │     ├── lib/fairness.ts (extractConstraints)
  │     │     └── lib/types.ts
  │     ├── lib/scoring/feature-vectors.ts
  │     │     ├── lib/retrieval/inverted-index.ts (IDF weights)
  │     │     └── lib/types.ts
  │     └── lib/utils.ts (cosineSimilarity)
  ├── lib/fairness.ts
  │     ├── lib/scoring/feature-vectors.ts (CBF scoring)
  │     ├── lib/scoring/cold-start.ts
  │     │     └── lib/baselines/popularity-baseline.ts
  │     └── lib/types.ts
  ├── lib/baselines/popularity-baseline.ts
  │     └── lib/fairness.ts (extractConstraints)
  ├── lib/profile-utils.ts
  │     └── lib/fairness.ts (createEmptyProfile)
  └── lib/types.ts

app/api/analyze/route.ts            ← Preference extraction endpoint
  ├── lib/profile-utils.ts (extractLocalPreferences, updateProfile)
  └── lib/types.ts

lib/conversation-engine.ts          ← Chat state machine
  ├── lib/restaurant-qa.ts
  └── lib/types.ts

lib/eval/metrics.ts                 ← Evaluation metrics
  ├── lib/fairness.ts (calculateGroupFairness)
  ├── lib/baselines/popularity-baseline.ts
  └── lib/retrieval/inverted-index.ts

app/eval/page.tsx                   ← Evaluation dashboard
  ├── lib/retrieval/hybrid-retrieval.ts
  ├── lib/fairness.ts
  ├── lib/eval/metrics.ts
  └── lib/eval-scenarios.ts
```

---

*This document describes the iNAGO Eats system as implemented. All formulas, algorithms, and data structures reference actual source code locations. Module references use the format `file:line`.*
