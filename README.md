# iNAGO Eats

A fairness-aware group dining recommendation system for Toronto restaurants. This application uses AI and mathematical fairness algorithms to analyze group conversations, extract individual preferences, and recommend restaurants that maximize satisfaction for everyone in the group.

## Getting Started

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.local.example .env.local
   # Edit .env.local and add your OpenAI API key
   ```

3. **Run the development server:**
   ```bash
   npm run dev
   ```

4. **Open [http://localhost:3000](http://localhost:3000)**

---

## Key Features

- **Mathematical Fairness Scoring** - Uses utilitarian, egalitarian, and Nash welfare metrics
- **Structured User Profiles** - Persistent profiles with dietary, cuisine, budget, and location preferences
- **Constraint Classification** - Hard constraints (must satisfy), soft constraints (weighted), bonus features
- **Pareto Efficiency Filtering** - Only recommends non-dominated options
- **Local + API Preference Extraction** - Regex-based extraction reduces API calls by 70%+
- **Fairness Mode Selection** - Choose between Balanced, Egalitarian, or Utilitarian modes

---

## AI System Architecture

The system implements a multi-stage AI pipeline with mathematical fairness scoring.

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER INTERFACE                                  │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────────────────┐  │
│  │ Group Chat      │  │ Structured       │  │ Fairness Dashboard         │  │
│  │ (4 users)       │  │ User Profiles    │  │ • Mode selector            │  │
│  │                 │  │ • Dietary        │  │ • Per-user satisfaction    │  │
│  │                 │  │ • Cuisines       │  │ • Gini inequality index    │  │
│  │                 │  │ • Budget         │  │ • Pareto efficiency badge  │  │
│  │                 │  │ • Confidence     │  │                            │  │
│  └─────────────────┘  └──────────────────┘  └────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
          │                      │                          ▲
          ▼                      ▼                          │
┌─────────────────────────────────────────────────────────────────────────────┐
│                              API LAYER                                       │
│  ┌────────────────────────────┐     ┌────────────────────────────────────┐  │
│  │   /api/analyze             │     │      /api/recommend                │  │
│  │   • Local regex extraction │     │      • Vector search               │  │
│  │   • API fallback (complex) │     │      • Mathematical fairness       │  │
│  │   • Profile updates        │     │      • Pareto filtering            │  │
│  │   • Debounced calls        │     │      • LLM explanation             │  │
│  └────────────────────────────┘     └────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
          │                                          │
          ▼                                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CORE LIBRARIES                                       │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐   │
│  │ profile-utils.ts │  │ fairness.ts      │  │ types.ts                 │   │
│  │ • extractLocal   │  │ • satisfaction   │  │ • StructuredUserProfile  │   │
│  │ • updateProfile  │  │ • groupFairness  │  │ • HardConstraint         │   │
│  │ • needsAPI       │  │ • paretoFilter   │  │ • SoftConstraint         │   │
│  │ • persistence    │  │ • selectBest     │  │ • FairnessMetrics        │   │
│  └──────────────────┘  └──────────────────┘  └──────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
          │                                          │
          ▼                                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AI MODELS                                       │
│  ┌─────────────────────┐    ┌─────────────────┐    ┌────────────────────┐   │
│  │ GPT-3.5-turbo       │    │ text-embedding- │    │ GPT-4-turbo        │   │
│  │ (Complex extraction)│    │ 3-small         │    │ (Explanation)      │   │
│  └─────────────────────┘    │ (Semantic       │    └────────────────────┘   │
│                             │  search)        │                              │
│                             └─────────────────┘                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Stage 1: Preference Extraction (Optimized)

**Endpoint:** `POST /api/analyze`

The system uses a two-tier extraction approach to minimize API costs:

### Tier 1: Local Regex Extraction (No API Call)

```typescript
// Runs first - handles 70%+ of messages locally
extractLocalPreferences(message: string): ExtractedPreferences

// Detects:
// - Dietary: vegan, vegetarian, gluten-free, halal, kosher, keto, etc.
// - Cuisines: 30+ cuisine types (italian, thai, sushi, bbq, etc.)
// - Price: cheap/budget → $, moderate → $$, upscale → $$$, luxury → $$$$
// - Location: downtown, midtown, north york, queen west, etc.
// - Ambiance: casual, upscale, trendy, quiet, lively
// - Strictness: "strict vegan" vs "usually vegetarian"
```

### Tier 2: API Extraction (Complex Messages Only)

```typescript
// Only called when:
// - Local extraction found nothing but message is substantial
// - Message contains complex language (but, except, unless, depends)
// - Message is long (>20 words) with nuanced preferences

needsAPIExtraction(message: string, localResult: ExtractedPreferences): boolean
```

### Debouncing

API calls are debounced (2-second minimum gap) to prevent rapid successive calls.

---

## Stage 2: Structured User Profiles

**Storage:** Browser `localStorage` (key: `inago-user-profiles-v2`)

### Profile Structure

```typescript
interface StructuredUserProfile {
  id: string;
  name: string;
  color: string;

  dietary: {
    restrictions: DietaryRestriction[];  // [{type: "vegan", strictness: "strict"}]
    allergies: string[];                  // ["peanuts", "shellfish"]
    religious: "halal" | "kosher" | null;
    medicalConditions: string[];
  };

  cuisinePreferences: {
    favorites: CuisinePreference[];  // [{cuisine: "thai", score: 8, frequency: 3}]
    dislikes: string[];              // ["sushi", "indian"]
    adventurousness: number;         // 1-5 scale
  };

  budget: {
    preferred: "$" | "$$" | "$$$" | "$$$$" | null;
    maxAcceptable: "$" | "$$" | "$$$" | "$$$$" | null;
    flexibility: number;  // 1-5, higher = more flexible
  };

  location: {
    preferredAreas: string[];  // ["downtown", "queen west"]
    maxDistance: number;       // km
    hasTransportation: boolean;
  };

  diningStyle: {
    preferredAmbiance: ("casual" | "upscale" | "trendy" | "quiet" | "lively")[];
    groupSizePreference: "intimate" | "medium" | "large" | null;
    timePreference: "lunch" | "dinner" | "late-night" | "any";
  };

  confidence: {
    dietary: number;   // 0-1, how confident we are about this category
    cuisine: number;
    budget: number;
    location: number;
    overall: number;
  };
}
```

### Profile Updates

Preferences are updated with **reinforcement** and **time decay**:

```typescript
// Reinforcement: Repeated mentions increase confidence
if (restriction.strictness === 'strict') {
  existing.strictness = 'strict';  // Upgrade to strict
}
confidence.dietary = Math.min(1, confidence.dietary + 0.15);

// Time decay: Old preferences fade
const weeksOld = (now - pref.lastMentioned) / weekMs;
if (weeksOld > 1) {
  pref.score *= Math.pow(0.95, weeksOld);
}
```

---

## Stage 3: Constraint Classification

The fairness system classifies user preferences into three tiers:

### Hard Constraints (Must Satisfy)

```typescript
interface HardConstraint {
  type: "dietary" | "allergy" | "accessibility";
  value: string;  // "vegan", "peanut-allergy", etc.
}

// Violation = 0% satisfaction, restaurant rejected
// Examples:
// - Strict vegan → restaurant must have vegan options
// - Peanut allergy → restaurant must not use peanuts
// - Halal requirement → restaurant must be halal
```

### Soft Constraints (Weighted Preferences)

```typescript
interface SoftConstraint {
  type: "cuisine" | "price" | "location" | "ambiance";
  value: string;
  weight: number;  // 1-5 importance scale
}

// Partial match = partial score
// Examples:
// - Prefers Thai (weight: 4) → Thai restaurant = 100%, Asian = 70%, Other = 0%
// - Budget $$ → $$ = 100%, $ or $$$ = 70%, $$$$ = 40%
```

### Bonus Features (Nice to Have)

```typescript
interface BonusConstraint {
  type: "parking" | "outdoor" | "reservation" | "late-night";
  value: boolean;
}

// Adds +10% bonus per feature, doesn't reduce score if absent
```

---

## Stage 4: Mathematical Fairness Scoring

### Per-User Satisfaction Calculation

```typescript
function calculateUserSatisfaction(restaurant, profile): UserSatisfactionResult {
  // Step 1: Check hard constraints (pass/fail)
  for (const hard of constraints.hard) {
    if (!restaurantSatisfiesHard(restaurant, hard)) {
      return { score: 0, satisfied: false, hardFailure: hard };
    }
  }

  // Step 2: Calculate weighted soft constraint scores
  let softScore = 0, maxSoftScore = 0;
  for (const soft of constraints.soft) {
    const match = calculateSoftMatch(restaurant, soft);  // 0-1
    softScore += match * soft.weight;
    maxSoftScore += soft.weight;
  }

  // Step 3: Add bonus points
  let bonusScore = 0;
  for (const bonus of constraints.bonus) {
    if (restaurantHasBonus(restaurant, bonus)) {
      bonusScore += 0.1;
    }
  }

  // Final score: normalized to 0-1
  const baseScore = maxSoftScore > 0 ? softScore / maxSoftScore : 0.5;
  return {
    score: Math.min(1, baseScore * 0.9 + bonusScore + 0.1),
    satisfied: true
  };
}
```

### Group Fairness Metrics

```typescript
interface GroupFairnessMetrics {
  utilitarian: number;  // Average satisfaction (sum / n)
  egalitarian: number;  // Minimum satisfaction (Rawlsian justice)
  nash: number;         // Geometric mean (Nash welfare)
  gini: number;         // Inequality measure (0 = equal, 1 = unequal)
}

function calculateGroupFairness(restaurant, profiles): GroupFairnessMetrics {
  const scores = profiles.map(p => calculateUserSatisfaction(restaurant, p).score);
  const n = scores.length;

  return {
    utilitarian: scores.reduce((a, b) => a + b, 0) / n,
    egalitarian: Math.min(...scores),
    nash: Math.pow(scores.reduce((a, b) => a * b, 1), 1 / n),
    gini: calculateGiniCoefficient(scores)
  };
}
```

### Fairness Modes

| Mode | Formula | Philosophy |
|------|---------|------------|
| **Utilitarian** | max(average) | Greatest good for greatest number |
| **Egalitarian** | max(minimum) | No one should be too unhappy (Rawlsian) |
| **Balanced** | 0.3×avg + 0.5×min + 0.2×(1-gini) | Hybrid approach (default) |

---

## Stage 5: Pareto Efficiency Filtering

Before final selection, dominated options are removed:

```typescript
function filterParetoEfficient(candidates): ScoredCandidate[] {
  return candidates.filter(candidate => {
    // Keep only if no other option makes everyone at least as happy
    // AND someone strictly happier
    return !candidates.some(other => {
      const allAtLeastAsGood = other.scores.every((s, i) => s >= candidate.scores[i]);
      const someBetter = other.scores.some((s, i) => s > candidate.scores[i]);
      return allAtLeastAsGood && someBetter;
    });
  });
}
```

**Example:**
- Restaurant A: Aisha=80%, John=60%, Josh=70%, Kate=50%
- Restaurant B: Aisha=85%, John=65%, Josh=75%, Kate=55%
- Restaurant A is **dominated** by B (everyone is at least as happy, some happier)
- Restaurant A is removed from consideration

---

## Stage 6: Vector Search + Final Selection

**Endpoint:** `POST /api/recommend`

### Vector Search Phase

1. **Build group query** from all user profiles
2. **Embed query** using `text-embedding-3-small`
3. **Cosine similarity** against 356 pre-embedded restaurants
4. **Retrieve top 15** candidates for fairness analysis

### Selection Phase

1. **Calculate fairness metrics** for all 15 candidates
2. **Filter Pareto-efficient** options
3. **Select best** based on chosen fairness mode
4. **Generate explanation** combining:
   - Mathematical fairness breakdown
   - GPT-4 natural language explanation

---

## API Response Format

```typescript
{
  candidates: [
    {
      id: string,
      name: string,
      cuisine: string,
      price: string,
      rating: number,
      location: string,
      address: string,
      score: number,  // Vector similarity (0-1)
      fairnessMetrics: {
        utilitarian: number,
        egalitarian: number,
        nash: number,
        gini: number
      },
      userSatisfaction: [
        { userId: string, userName: string, score: number, satisfied: boolean }
      ]
    }
  ],
  recommendation: string,  // Combined fairness + LLM explanation
  totalRestaurants: 356,
  fairnessResult: {
    restaurantId: string,
    restaurantName: string,
    metrics: GroupFairnessMetrics,
    userSatisfaction: UserSatisfactionResult[],
    isParetoEfficient: boolean
  },
  mode: "balanced" | "egalitarian" | "utilitarian"
}
```

---

## Complete Data Flow Example

```
1. USER ACTION
   Aisha sends: "I'm strictly vegan, craving Thai food"

2. LOCAL EXTRACTION (No API)
   → Regex detects: dietary=[{type:"vegan", strictness:"strict"}], cuisines=["thai"]
   → Profile updated, confidence.dietary += 0.15

3. PROFILE PERSISTENCE
   → Saves to localStorage with timestamp
   → UI shows confidence bar update

4. USER ACTION
   John sends: "I want BBQ ribs, nothing too expensive"

5. LOCAL EXTRACTION
   → Detects: cuisines=["bbq"], price="$$"
   → Profile updated

6. USER ACTION
   Clicks "Generate Fair Recommendation" with mode="balanced"

7. VECTOR SEARCH
   → Query: "vegan thai bbq moderate price"
   → Returns top 15 restaurants by similarity

8. FAIRNESS CALCULATION (for each candidate)
   → Aisha: Hard constraint check (vegan options?)
     - Pai Northern Thai: Has vegan → soft score calculation
     - Memphis BBQ: No vegan → score=0, rejected
   → John: Soft constraint check (BBQ match?)
     - Pai: No BBQ → partial match on "asian" = 0.3
   → Calculate group metrics for valid candidates

9. PARETO FILTERING
   → Removes dominated options
   → 15 → 8 Pareto-efficient candidates

10. SELECTION (Balanced mode)
    → Score = 0.3×utilitarian + 0.5×egalitarian + 0.2×(1-gini)
    → Best: Khao San Road (vegan Thai options, budget-friendly)
      - Aisha: 85%, John: 45%, Josh: 70%, Kate: 60%
      - Gini: 0.18 (low inequality)

11. LLM EXPLANATION
    → GPT-4 receives fairness data
    → Generates 2-3 sentence explanation

12. UI DISPLAY
    → Fairness Analysis card with per-person bars
    → "Pareto Efficient" badge
    → Candidate cards with match% and fair%
    → Full recommendation text
```

---

## File Structure

```
lib/
├── types.ts           # All TypeScript interfaces
├── fairness.ts        # Mathematical fairness algorithms
├── profile-utils.ts   # Profile management & local extraction
├── data.ts            # Users and restaurant data
├── restaurants.json   # 356 Toronto restaurants
└── utils.ts           # Cosine similarity, helpers

app/
├── page.tsx           # Main UI with fairness dashboard
├── api/
│   ├── analyze/route.ts    # Preference extraction (local + API)
│   └── recommend/route.ts  # Vector search + fairness selection

scripts/
└── precompute-embeddings.ts  # One-time embedding generation
```

---

## Technology Stack

| Component | Technology |
|-----------|------------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| AI - Extraction | GPT-3.5-turbo-0125 (fallback only) |
| AI - Reasoning | GPT-4-turbo |
| AI - Embeddings | text-embedding-3-small |
| Vector Search | In-memory cosine similarity |
| Fairness | Custom algorithms (utilitarian, egalitarian, Nash, Gini) |
| Persistence | Browser localStorage |
| Data | 356 Toronto restaurants (Yelp) |

---

## Deploy on Vercel

1. Push to GitHub
2. Import project on [Vercel](https://vercel.com)
3. Add `OPENAI_API_KEY` in Environment Variables
4. Deploy

---

## Pre-computing Embeddings (Optional)

To avoid computing embeddings on first request:

```bash
export OPENAI_API_KEY=your-key-here
npx ts-node scripts/precompute-embeddings.ts
```

This generates `lib/restaurant-embeddings.json` (~2MB).

---

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [OpenAI API Reference](https://platform.openai.com/docs)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [Fairness in Machine Learning](https://fairmlbook.org/)
