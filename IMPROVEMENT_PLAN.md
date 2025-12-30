# iNAGO Eats Improvement Plan

## Overview

This plan outlines improvements to make the recommendation system more mathematically fair, add structure to user profiles, and optimize API usage for cost efficiency.

---

## Part 1: Mathematical Fairness Framework

### Current Problem
The current system delegates fairness to GPT-4's interpretation of natural language instructions. This is:
- Non-deterministic (different results each time)
- Not explainable (can't show users why a choice is "fair")
- Expensive (requires GPT-4 reasoning every time)

### Proposed Solution: Multi-Criteria Fairness Scoring

#### 1.1 Constraint Classification System

```typescript
interface UserConstraints {
  hard: HardConstraint[];    // MUST satisfy (dealbreakers)
  soft: SoftConstraint[];    // SHOULD satisfy (preferences)
  bonus: BonusConstraint[];  // NICE TO HAVE (extras)
}

interface HardConstraint {
  type: 'dietary' | 'allergy' | 'accessibility';
  value: string;  // e.g., "vegan", "nut-free", "wheelchair"
  reason?: string;
}

interface SoftConstraint {
  type: 'cuisine' | 'price' | 'location' | 'ambiance';
  value: string;
  weight: number;  // 1-5 importance scale
}

interface BonusConstraint {
  type: 'parking' | 'outdoor' | 'reservation' | 'late-night';
  value: boolean;
}
```

#### 1.2 Restaurant Scoring Algorithm

For each restaurant, calculate a per-user satisfaction score:

```typescript
function calculateUserSatisfaction(
  restaurant: Restaurant,
  user: UserProfile
): { score: number; satisfied: boolean; breakdown: ScoreBreakdown } {

  // Step 1: Hard constraint check (pass/fail)
  for (const constraint of user.constraints.hard) {
    if (!restaurantSatisfies(restaurant, constraint)) {
      return { score: 0, satisfied: false, breakdown: { hardFail: constraint } };
    }
  }

  // Step 2: Soft constraint scoring (weighted sum)
  let softScore = 0;
  let maxSoftScore = 0;
  const softBreakdown: Record<string, number> = {};

  for (const constraint of user.constraints.soft) {
    const match = calculateSoftMatch(restaurant, constraint); // 0-1
    softScore += match * constraint.weight;
    maxSoftScore += constraint.weight;
    softBreakdown[constraint.type] = match;
  }

  // Step 3: Bonus points
  let bonusScore = 0;
  for (const bonus of user.constraints.bonus) {
    if (restaurantHasFeature(restaurant, bonus)) {
      bonusScore += 0.1; // Small bonus
    }
  }

  // Final score: normalized to 0-1
  const baseScore = maxSoftScore > 0 ? softScore / maxSoftScore : 1;
  const finalScore = Math.min(1, baseScore + bonusScore);

  return {
    score: finalScore,
    satisfied: true,
    breakdown: { softScores: softBreakdown, bonusScore }
  };
}
```

#### 1.3 Group Fairness Metrics

Calculate three fairness metrics for each candidate restaurant:

```typescript
interface GroupFairnessMetrics {
  utilitarian: number;    // Sum of all satisfaction scores
  egalitarian: number;    // Minimum satisfaction score (Rawlsian)
  nash: number;           // Product of scores (Nash welfare)
  gini: number;           // Inequality measure (0 = equal, 1 = unequal)
}

function calculateGroupFairness(
  restaurant: Restaurant,
  users: UserProfile[]
): GroupFairnessMetrics {
  const scores = users.map(u => calculateUserSatisfaction(restaurant, u).score);

  // Filter out users with hard constraint failures
  const validScores = scores.filter(s => s > 0);
  if (validScores.length < users.length) {
    // At least one hard constraint failed
    return { utilitarian: 0, egalitarian: 0, nash: 0, gini: 1 };
  }

  const n = scores.length;
  const sum = scores.reduce((a, b) => a + b, 0);
  const min = Math.min(...scores);
  const product = scores.reduce((a, b) => a * b, 1);

  // Gini coefficient calculation
  let giniNumerator = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      giniNumerator += Math.abs(scores[i] - scores[j]);
    }
  }
  const gini = giniNumerator / (2 * n * sum);

  return {
    utilitarian: sum / n,           // Average satisfaction
    egalitarian: min,               // Worst-off user's satisfaction
    nash: Math.pow(product, 1/n),   // Geometric mean
    gini: gini
  };
}
```

#### 1.4 Final Selection Algorithm

```typescript
function selectBestRestaurant(
  candidates: Restaurant[],
  users: UserProfile[],
  fairnessMode: 'utilitarian' | 'egalitarian' | 'balanced' = 'balanced'
): { restaurant: Restaurant; explanation: string } {

  const scored = candidates.map(r => ({
    restaurant: r,
    metrics: calculateGroupFairness(r, users),
    userScores: users.map(u => ({
      user: u.name,
      ...calculateUserSatisfaction(r, u)
    }))
  }));

  // Filter to only Pareto-efficient options
  const paretoEfficient = filterParetoEfficient(scored);

  // Select based on fairness mode
  let selected;
  switch (fairnessMode) {
    case 'utilitarian':
      selected = maxBy(paretoEfficient, s => s.metrics.utilitarian);
      break;
    case 'egalitarian':
      selected = maxBy(paretoEfficient, s => s.metrics.egalitarian);
      break;
    case 'balanced':
      // Weighted combination prioritizing egalitarian
      selected = maxBy(paretoEfficient, s =>
        0.3 * s.metrics.utilitarian +
        0.5 * s.metrics.egalitarian +
        0.2 * (1 - s.metrics.gini)
      );
      break;
  }

  // Generate explanation
  const explanation = generateFairnessExplanation(selected, users);

  return { restaurant: selected.restaurant, explanation };
}
```

#### 1.5 Pareto Efficiency Check

```typescript
function filterParetoEfficient(
  scored: ScoredRestaurant[]
): ScoredRestaurant[] {
  return scored.filter(candidate => {
    // A restaurant is Pareto efficient if no other restaurant
    // makes everyone at least as happy AND someone happier
    return !scored.some(other => {
      if (other === candidate) return false;

      const candidateScores = candidate.userScores.map(u => u.score);
      const otherScores = other.userScores.map(u => u.score);

      const allAtLeastAsGood = otherScores.every((s, i) => s >= candidateScores[i]);
      const someBetter = otherScores.some((s, i) => s > candidateScores[i]);

      return allAtLeastAsGood && someBetter;
    });
  });
}
```

---

## Part 2: Structured User Profiles

### Current Problem
User memories are stored as unstructured strings with simple keyword extraction. This is:
- Imprecise (misses nuances)
- Hard to query programmatically
- Inconsistent across users

### Proposed Solution: Structured Profile Schema

#### 2.1 New User Profile Schema

```typescript
interface StructuredUserProfile {
  id: string;
  name: string;

  // Dietary & Health (Hard Constraints)
  dietary: {
    restrictions: DietaryRestriction[];
    allergies: string[];
    religious: 'halal' | 'kosher' | null;
    medicalConditions: string[];  // e.g., "low sodium", "diabetic-friendly"
  };

  // Cuisine Preferences (Soft Constraints)
  cuisinePreferences: {
    favorites: CuisinePreference[];   // Ranked list with scores
    dislikes: string[];               // Cuisines to avoid
    adventurousness: number;          // 1-5 scale (1 = stick to known, 5 = try anything)
  };

  // Budget (Soft Constraint)
  budget: {
    preferred: '$' | '$$' | '$$$' | '$$$$';
    maxAcceptable: '$' | '$$' | '$$$' | '$$$$';
    flexibility: number;  // 1-5 how flexible on price
  };

  // Location (Soft Constraint)
  location: {
    preferredAreas: string[];
    maxDistance: number;  // km from downtown or a reference point
    hasTransportation: boolean;
  };

  // Dining Style (Bonus)
  diningStyle: {
    preferredAmbiance: ('casual' | 'upscale' | 'trendy' | 'quiet' | 'lively')[];
    groupSizePreference: 'intimate' | 'medium' | 'large';
    timePreference: 'lunch' | 'dinner' | 'late-night' | 'any';
  };

  // Historical Data
  history: {
    visitedRestaurants: string[];  // IDs of restaurants they've been to
    ratings: Record<string, number>;  // restaurantId -> 1-5 rating
    lastUpdated: number;
    totalInteractions: number;
  };

  // Confidence Scores
  confidence: {
    dietary: number;      // 0-1 how confident we are in dietary info
    cuisine: number;
    budget: number;
    location: number;
    overall: number;
  };
}

interface DietaryRestriction {
  type: 'vegan' | 'vegetarian' | 'pescatarian' | 'gluten-free' | 'dairy-free' | 'keto' | 'other';
  strictness: 'strict' | 'flexible';  // strict = hard constraint, flexible = soft
  since?: string;  // when they started this diet
}

interface CuisinePreference {
  cuisine: string;
  score: number;  // 1-10 preference strength
  lastMentioned: number;  // timestamp
  frequency: number;  // how often they mention it
}
```

#### 2.2 Profile Update Logic

```typescript
function updateUserProfile(
  currentProfile: StructuredUserProfile,
  newMessage: string,
  extractedInfo: ExtractedPreferences
): StructuredUserProfile {
  const updated = { ...currentProfile };

  // Update dietary with high confidence if explicitly stated
  if (extractedInfo.dietary) {
    for (const restriction of extractedInfo.dietary) {
      const existing = updated.dietary.restrictions.find(r => r.type === restriction.type);
      if (existing) {
        // Reinforce existing restriction
        updated.confidence.dietary = Math.min(1, updated.confidence.dietary + 0.1);
      } else {
        // Add new restriction
        updated.dietary.restrictions.push(restriction);
        updated.confidence.dietary = Math.max(updated.confidence.dietary, 0.7);
      }
    }
  }

  // Update cuisine preferences with decay
  if (extractedInfo.cuisines) {
    for (const cuisine of extractedInfo.cuisines) {
      const existing = updated.cuisinePreferences.favorites.find(c => c.cuisine === cuisine);
      if (existing) {
        existing.score = Math.min(10, existing.score + 1);
        existing.frequency += 1;
        existing.lastMentioned = Date.now();
      } else {
        updated.cuisinePreferences.favorites.push({
          cuisine,
          score: 5,
          lastMentioned: Date.now(),
          frequency: 1
        });
      }
    }

    // Sort by score
    updated.cuisinePreferences.favorites.sort((a, b) => b.score - a.score);

    // Keep top 10
    updated.cuisinePreferences.favorites = updated.cuisinePreferences.favorites.slice(0, 10);
  }

  // Apply time decay to old preferences
  const now = Date.now();
  const decayRate = 0.95;  // per week
  for (const pref of updated.cuisinePreferences.favorites) {
    const weeksOld = (now - pref.lastMentioned) / (7 * 24 * 60 * 60 * 1000);
    pref.score *= Math.pow(decayRate, weeksOld);
  }

  updated.history.lastUpdated = now;
  updated.history.totalInteractions += 1;

  return updated;
}
```

#### 2.3 Constraint Extraction from Profile

```typescript
function extractConstraints(profile: StructuredUserProfile): UserConstraints {
  const hard: HardConstraint[] = [];
  const soft: SoftConstraint[] = [];
  const bonus: BonusConstraint[] = [];

  // Dietary → Hard constraints
  for (const restriction of profile.dietary.restrictions) {
    if (restriction.strictness === 'strict') {
      hard.push({
        type: 'dietary',
        value: restriction.type
      });
    } else {
      soft.push({
        type: 'cuisine',
        value: `${restriction.type}-friendly`,
        weight: 3
      });
    }
  }

  // Allergies → Always hard
  for (const allergy of profile.dietary.allergies) {
    hard.push({
      type: 'allergy',
      value: allergy
    });
  }

  // Religious → Hard
  if (profile.dietary.religious) {
    hard.push({
      type: 'dietary',
      value: profile.dietary.religious
    });
  }

  // Cuisines → Soft with varying weights
  for (const pref of profile.cuisinePreferences.favorites.slice(0, 5)) {
    soft.push({
      type: 'cuisine',
      value: pref.cuisine,
      weight: Math.ceil(pref.score / 2)  // 1-5 weight from 1-10 score
    });
  }

  // Budget → Soft
  soft.push({
    type: 'price',
    value: profile.budget.preferred,
    weight: 6 - profile.budget.flexibility  // Higher flexibility = lower weight
  });

  // Location → Soft
  for (const area of profile.location.preferredAreas) {
    soft.push({
      type: 'location',
      value: area,
      weight: 2
    });
  }

  return { hard, soft, bonus };
}
```

---

## Part 3: API Optimization

### Current Problem
- Restaurant embeddings computed on every cold start (356 API calls)
- Preference extraction on every message (1 API call per message)
- GPT-4 called for every recommendation

### Proposed Solutions

#### 3.1 Pre-compute and Store Restaurant Embeddings

```typescript
// scripts/precompute-embeddings.ts
// Run once, save to JSON file

async function precomputeEmbeddings() {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const restaurantTexts = RESTAURANTS.map(rest =>
    `${rest.name} ${rest.cuisine} ${rest.description} ${rest.price} ${rest.location} ${rest.tags.join(' ')}`
  );

  // Batch embed (single API call for all 356)
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: restaurantTexts,
  });

  const embeddings = RESTAURANTS.map((rest, idx) => ({
    id: rest.id,
    embedding: response.data[idx].embedding,
  }));

  // Save to file
  fs.writeFileSync(
    'lib/restaurant-embeddings.json',
    JSON.stringify(embeddings)
  );
}
```

**Cost savings:** ~$0.02 per deployment instead of ~$0.02 per cold start

#### 3.2 Debounced Preference Extraction

```typescript
// Only call API after user stops typing for 2 seconds
// AND only if there are new messages since last extraction

const [lastExtractedCount, setLastExtractedCount] = useState(0);

const analyzeChat = useDebouncedCallback(
  async (msgs: Message[]) => {
    // Skip if no new messages
    if (msgs.length <= lastExtractedCount) return;

    // Only send new messages for analysis
    const newMessages = msgs.slice(lastExtractedCount);

    const res = await fetch('/api/analyze', {
      method: 'POST',
      body: JSON.stringify({
        newMessages,
        existingPreferences: preferences
      }),
    });

    setLastExtractedCount(msgs.length);
  },
  2000  // 2 second debounce
);
```

**Cost savings:** ~70% reduction in analyze calls

#### 3.3 Local Preference Extraction (No API)

For simple preferences, extract locally without API:

```typescript
function extractLocalPreferences(message: string): Partial<ExtractedPreferences> {
  const lower = message.toLowerCase();
  const result: Partial<ExtractedPreferences> = {};

  // Dietary detection (regex patterns)
  const dietaryPatterns = {
    vegan: /\b(vegan|plant-based|no animal)\b/,
    vegetarian: /\b(vegetarian|veggie|no meat)\b/,
    'gluten-free': /\b(gluten-free|gluten free|celiac|no gluten)\b/,
    halal: /\b(halal)\b/,
    kosher: /\b(kosher)\b/,
  };

  result.dietary = [];
  for (const [diet, pattern] of Object.entries(dietaryPatterns)) {
    if (pattern.test(lower)) {
      result.dietary.push({ type: diet as any, strictness: 'strict' });
    }
  }

  // Cuisine detection
  const cuisines = ['italian', 'chinese', 'japanese', 'thai', 'indian',
                    'mexican', 'korean', 'vietnamese', 'bbq', 'sushi',
                    'pizza', 'burger', 'seafood', 'mediterranean', 'french'];
  result.cuisines = cuisines.filter(c => lower.includes(c));

  // Price detection
  if (/\b(cheap|budget|affordable|inexpensive)\b/.test(lower)) {
    result.price = '$';
  } else if (/\b(expensive|fancy|upscale|splurge)\b/.test(lower)) {
    result.price = '$$$$';
  }

  return result;
}

// Only call API for complex/ambiguous messages
function needsAPIExtraction(message: string, localResult: Partial<ExtractedPreferences>): boolean {
  // If local extraction found nothing, might need API
  const foundSomething = (localResult.dietary?.length || 0) +
                         (localResult.cuisines?.length || 0) > 0;

  // If message is long/complex, use API
  const isComplex = message.split(' ').length > 15;

  // If message has negations or conditions, use API
  const hasComplexity = /\b(but|except|unless|if|not|don't|can't)\b/.test(message.toLowerCase());

  return !foundSomething || isComplex || hasComplexity;
}
```

**Cost savings:** ~50% reduction in analyze calls

#### 3.4 Replace GPT-4 with Mathematical Scoring

The fairness scoring from Part 1 can replace GPT-4 for selection:

```typescript
// Before: GPT-4 call (~$0.03 per recommendation)
const finalRecResponse = await openai.chat.completions.create({
  model: "gpt-4-turbo",
  messages: [{ role: "system", content: reasoningPrompt }],
});

// After: Local computation (free)
const { restaurant, explanation } = selectBestRestaurant(
  topCandidates,
  users,
  'balanced'
);
```

**Option:** Keep GPT-4 only for generating the natural language explanation, but use it with a much shorter prompt:

```typescript
// Only use GPT-3.5 for explanation (10x cheaper than GPT-4)
const explanationPrompt = `
Given this restaurant selection:
- Selected: ${selected.restaurant.name}
- User satisfaction scores: ${JSON.stringify(selected.userScores)}
- Fairness metrics: ${JSON.stringify(selected.metrics)}

Write 2-3 sentences explaining why this is a fair choice for the group.
`;

const response = await openai.chat.completions.create({
  model: "gpt-3.5-turbo",
  messages: [{ role: "user", content: explanationPrompt }],
  max_tokens: 150
});
```

**Cost savings:** ~90% reduction in recommendation costs

---

## Part 4: Implementation Phases

### Phase 1: Pre-compute Embeddings (1-2 hours)
- [ ] Create `scripts/precompute-embeddings.ts`
- [ ] Generate `lib/restaurant-embeddings.json`
- [ ] Update `/api/recommend` to load from file
- [ ] Remove runtime embedding computation

### Phase 2: Structured User Profiles (3-4 hours)
- [ ] Define new TypeScript interfaces in `lib/types.ts`
- [ ] Create `lib/profile-utils.ts` with extraction/update logic
- [ ] Migrate localStorage schema
- [ ] Update UI to display structured profiles

### Phase 3: Mathematical Fairness (4-5 hours)
- [ ] Create `lib/fairness.ts` with scoring algorithms
- [ ] Implement constraint classification
- [ ] Implement per-user satisfaction scoring
- [ ] Implement group fairness metrics
- [ ] Implement Pareto filtering
- [ ] Update `/api/recommend` to use mathematical selection

### Phase 4: API Optimization (2-3 hours)
- [ ] Add debouncing to preference extraction
- [ ] Implement local preference extraction
- [ ] Replace GPT-4 with GPT-3.5 for explanations
- [ ] Add caching layer for repeated queries

### Phase 5: UI Enhancements (2-3 hours)
- [ ] Show fairness breakdown in UI
- [ ] Display per-user satisfaction scores
- [ ] Add fairness mode selector (utilitarian/egalitarian/balanced)
- [ ] Show confidence indicators for user profiles

---

## Cost Comparison

| Operation | Current Cost | Optimized Cost | Savings |
|-----------|-------------|----------------|---------|
| Restaurant embeddings (cold start) | $0.02 | $0 (pre-computed) | 100% |
| Preference extraction (per message) | $0.002 | $0.0006 (debounced + local) | 70% |
| Recommendation (per request) | $0.03 (GPT-4) | $0.002 (GPT-3.5 explanation only) | 93% |
| **Total per session (10 messages + 2 recs)** | **$0.10** | **$0.01** | **90%** |

---

## Success Metrics

1. **Fairness Quality**
   - Egalitarian score > 0.6 for 90% of recommendations
   - Gini coefficient < 0.3 for 90% of recommendations
   - Zero hard constraint violations

2. **User Satisfaction**
   - Profile confidence scores > 0.7 after 5 interactions
   - User-reported satisfaction matches predicted scores (±20%)

3. **Cost Efficiency**
   - < $0.02 per recommendation session
   - < 5 API calls per session average

4. **Performance**
   - Recommendation generation < 3 seconds
   - Preference extraction < 1 second
