# iNAGO Eats: A Guided Walkthrough

### How a Group Dinner Decision Actually Happens — Gear by Gear

---

*This document follows a real conversation between three friends — Aisha, John, and Priya — from the moment they open the app to the moment they're navigating to the restaurant. At each step, we show the exact code that fires, the exact data structures that change, and the exact math that decides where they eat.*

---

## Act 1: The Lobby — Creating a Session

Aisha opens iNAGO Eats on her phone. She sees the landing screen:

```
┌──────────────────────────────┐
│                              │
│         iNAGO Eats           │
│  Fair group dining decisions │
│       powered by AI          │
│                              │
│   ┌────────────────────┐     │
│   │   Create Session   │     │
│   └────────────────────┘     │
│   ┌────────────────────┐     │
│   │    Join Session     │    │
│   └────────────────────┘     │
│                              │
└──────────────────────────────┘
```

She taps **Create Session**, types "Aisha", and taps **Create & Get Code**.

### What fires in the code:

The `SessionLobby` component calls `createSession("Aisha")`, which hits the server API:

```typescript
// lib/session-store.ts
export async function createSession(hostName: string) {
  const res = await fetch(API_BASE, {
    method: 'POST',
    body: JSON.stringify({ action: 'create', hostName }),
  });
  // ...
}
```

On the server (`app/api/sessions/route.ts`), a 6-character session code is generated and a `Session` object is stored in an in-memory `Map`:

```typescript
// app/api/sessions/route.ts
const sessionId = Math.random().toString(36).substring(2, 8).toUpperCase();
// e.g., "X7K2M9"

const newSession: Session = {
  id: sessionId,           // "X7K2M9"
  createdAt: Date.now(),
  createdBy: oderId,
  status: 'active',
  users: [aisha],          // First user in the session
  messages: [],            // No messages yet
  recommendations: null,
  settings: { maxUsers: 6, fairnessMode: 'balanced', allowLateJoin: true },
};
```

Aisha's user profile is created empty — this is critical. Every confidence field starts at **zero**:

```typescript
// lib/fairness.ts — createEmptyProfile()
confidence: {
  dietary:  0,    // We know nothing about her dietary needs
  cuisine:  0,    // We know nothing about her cuisine preferences
  budget:   0,    // We know nothing about her budget
  location: 0,    // We know nothing about her location preference
  overall:  0,    // Average of the above = 0
}
```

This zero-confidence state will matter later — it makes Aisha a **cold-start user** (confidence < 0.3).

The screen now shows:

```
┌──────────────────────────────┐
│  Share this code:            │
│                              │
│       X 7 K 2 M 9    📋     │
│                              │
│  Others can join by          │
│  entering this code          │
│                              │
│   ┌────────────────────┐     │
│   │   Start Chatting →  │    │
│   └────────────────────┘     │
└──────────────────────────────┘
```

Aisha texts the code **X7K2M9** to John and Priya.

---

## Act 2: Joining — Two More Users Connect

John opens the app on his laptop. He taps **Join Session**, enters the code `X7K2M9` and his name "John".

Priya does the same from her phone — same code, her name "Priya".

Each join call hits the same server endpoint. The server finds the session in its `Map`, creates a new user with an empty profile, and appends them:

```typescript
// app/api/sessions/route.ts — join action
const newUser: SessionUser = {
  id: crypto.randomUUID(),
  name: "John",
  color: '#3b82f6',        // Auto-assigned blue
  joinedAt: Date.now(),
  isHost: false,
  profile: createEmptyProfile(userId, "John", '#3b82f6'),
};
session.users.push(newUser);
```

Now the session has 3 users, all with `confidence.overall = 0`. The system knows nothing about any of them.

---

## Act 3: The Greeting — The Conversation Engine Wakes Up

When Aisha taps **Start Chatting**, the `ChatSession` component mounts. The very first thing it does is initialize the conversation engine and trigger a greeting:

```typescript
// app/components/ChatSession.tsx — useEffect on mount
const { updatedState, systemResponse } = processConversationMessage(
  convState,     // phase: 'greeting', hasGreeted: false
  dummyMessage,
  session.users,
);
```

Inside the conversation engine, this triggers the greeting phase:

```typescript
// lib/conversation-engine.ts — processMessage()
if (updatedState.phase === 'greeting' && !updatedState.hasGreeted) {
  updatedState.hasGreeted = true;
  updatedState.phase = 'elicitation';  // Transition to elicitation

  const names = users.map(u => u.name);
  // names = ["Aisha", "John", "Priya"]

  const greeting = `Welcome Aisha, John, and Priya! Let's find the perfect
  restaurant for your group. Tell me about your food preferences, dietary
  needs, and budget. Everyone can chime in!`;
}
```

This message appears as a system bubble in the chat:

```
┌─────────────────────────────────────────────────┐
│  Chat                                           │
│                                                 │
│  ┌───────────────────────────────────────────┐  │
│  │ Welcome Aisha, John, and Priya! Let's    │  │
│  │ find the perfect restaurant for your      │  │
│  │ group. Tell me about your food            │  │
│  │ preferences, dietary needs, and budget.   │  │
│  │ Everyone can chime in!                    │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  ┌────────────────────────────────┐  ┌──┐       │
│  │ Message as Aisha...           │  │➤│       │
│  └────────────────────────────────┘  └──┘       │
└─────────────────────────────────────────────────┘
```

The engine is now in `elicitation` phase. It's actively looking for preference signals.

---

## Act 4: First Messages — Preference Extraction Begins

### Message 1: Aisha types "I'm strictly halal and love Indian food"

When she hits send, the message flows through three systems simultaneously:

**System 1: Local Regex Extraction** (`lib/profile-utils.ts`)

```typescript
// extractLocalPreferences("I'm strictly halal and love Indian food")
const dietaryPatterns = {
  halal: /\b(halal)\b/,    // ← MATCH!
};
const strictPatterns = /\b(strict|always|must|need)\b/;
// "strictly" matches → strictness = 'strict'

// Result:
{
  dietary: [{ type: 'halal', strictness: 'strict' }],
  cuisines: ['indian'],    // "indian" found in cuisine vocabulary
}
```

**System 2: Profile Update** (`lib/profile-utils.ts`)

The extracted preferences are merged into Aisha's profile:

```typescript
// updateProfile(aishaProfile, extractedPreferences)

// Before:
aisha.dietary.restrictions = []
aisha.confidence.dietary = 0

// After:
aisha.dietary.restrictions = [{ type: 'halal', strictness: 'strict' }]
aisha.confidence.dietary = 0.6    // New restriction → set to 0.6
aisha.cuisinePreferences.favorites = [{ cuisine: 'indian', score: 6, frequency: 1 }]
aisha.confidence.cuisine = 0.1    // += 0.1
aisha.confidence.overall = (0.6 + 0.1 + 0 + 0) / 4 = 0.175
```

Aisha is still a cold-start user (0.175 < 0.3), but her dietary confidence jumped to 0.6. The system now knows her halal requirement is **non-negotiable**.

**System 3: API Extraction Decision**

```typescript
// needsAPIExtraction("I'm strictly halal and love Indian food", localResult)
const hasDietary = true;   // We found halal
const hasCuisines = true;  // We found indian
const foundSomething = true;
const wordCount = 8;       // Not long
const hasComplexity = false; // No "but", "except", etc.
// → return false. No need for GPT-3.5 call.
```

The system saved an API call because local extraction was sufficient.

### Message 2: John types "anything works for me, maybe something cheap"

```typescript
// extractLocalPreferences("anything works for me, maybe something cheap")
// dietary: nothing found
// cuisines: nothing found
// price: /\b(cheap|budget|affordable)\b/ → MATCH on "cheap"

// Result:
{ price: '$' }
```

John's profile updates:

```typescript
john.budget.preferred = '$'
john.confidence.budget = 0.2    // += 0.2
john.confidence.overall = (0 + 0 + 0.2 + 0) / 4 = 0.05
```

John is still deeply cold-start (0.05). The system notices `needsAPIExtraction` returns `false` because even though the message is vague, it did find a price preference.

### Message 3: Priya types "I'm vegetarian. Don't like sushi but love Thai and Japanese food"

This is a more complex message:

```typescript
// extractLocalPreferences(...)
{
  dietary: [{ type: 'vegetarian', strictness: 'flexible' }],
  // No strict keyword → 'flexible'
  cuisines: ['thai', 'japanese'],
  cuisineDislikes: ['sushi'],  // "don't like sushi" matched
}
```

But `needsAPIExtraction` triggers here:

```typescript
const hasComplexity = /\b(but|except|unless)\b/.test(message);
// "but love Thai" → hasComplexity = true
const wordCount = 12;  // > 5
const isLong = false;   // < 20
// hasComplexity && isLong → false
// !foundSomething && wordCount > 5 → false (we found things)
// → return false. Actually, local extraction got it all.
```

Priya's profile after update:

```typescript
priya.dietary.restrictions = [{ type: 'vegetarian', strictness: 'flexible' }]
priya.confidence.dietary = 0.6
priya.cuisinePreferences.favorites = [
  { cuisine: 'thai', score: 6 },
  { cuisine: 'japanese', score: 6 },
]
priya.cuisinePreferences.dislikes = ['sushi']
priya.confidence.cuisine = 0.1
priya.confidence.overall = (0.6 + 0.1 + 0 + 0) / 4 = 0.175
```

Note: Priya's vegetarian restriction is `flexible`, not `strict`. This means it becomes a **soft constraint** with weight 3, not a hard constraint. The system won't eliminate non-vegetarian restaurants for Priya — it will just prefer vegetarian-friendly ones.

---

## Act 5: The Readiness Check — "Still Learning"

At the bottom of the chat panel, a readiness indicator shows:

```
┌─────────────────────────────────────────────────┐
│ ⚠ Still learning about Aisha, John, and Priya  │
│ — keep chatting or I can ask some questions      │
│                              [Ask Me Questions]  │
└─────────────────────────────────────────────────┘
```

This comes from the readiness check:

```typescript
// lib/conversation-engine.ts — getReadinessStatus()
const lowConfidence = users.filter(u => u.profile.confidence.overall < 0.5);
// All three users are below 0.5:
//   Aisha: 0.175, John: 0.05, Priya: 0.175
// → ready: false
```

### Aisha taps "Ask Me Questions"

The system generates elicitation questions, prioritized by what it knows least about:

```typescript
// generateElicitationQuestions(users)
// For John (cuisine confidence = 0):
{
  question: "Hey John, what type of food are you in the mood for today?",
  category: 'cuisine',
  priority: 10 - 0 * 10 = 10,  // Highest priority
}
// For John (dietary confidence = 0):
{
  question: "John, do you have any dietary restrictions?",
  category: 'dietary',
  priority: 9 - 0 * 10 = 9,
}
```

The system asks John first because his confidence is lowest. The question appears in chat:

```
┌──────────────────────────────────────┐
│ Hey John, what type of food are you  │
│ in the mood for today? Any favorite  │
│ cuisines?                            │
└──────────────────────────────────────┘
```

### John responds: "I love Korean food, and BBQ"

```typescript
// extractLocalPreferences("I love Korean food, and BBQ")
{ cuisines: ['korean', 'bbq'] }

// Profile update:
john.cuisinePreferences.favorites = [
  { cuisine: 'korean', score: 6 },
  { cuisine: 'bbq', score: 6 },
]
john.confidence.cuisine = 0.1
john.confidence.overall = (0 + 0.1 + 0.2 + 0) / 4 = 0.075
```

John is slightly less cold-start now, but still below 0.3.

---

## Act 6: The Right Panel — Watching Profiles Build in Real Time

While the chat happens on the left, the right panel shows **live extracted profiles**:

```
┌───────────────────────────────────────────────┐
│ USER PROFILES (Extracted)                      │
│                                                │
│ ┌────────────────────────────────────────────┐ │
│ │ 🟢 Aisha  ★ host                          │ │
│ │ HALAL • likes indian • confidence: 18%    │ │
│ │ ▓▓░░░░░░░░ dietary: 60%                   │ │
│ │ ▓░░░░░░░░░ cuisine: 10%                   │ │
│ │ ░░░░░░░░░░ budget: 0%                     │ │
│ │ ░░░░░░░░░░ location: 0%                   │ │
│ └────────────────────────────────────────────┘ │
│                                                │
│ ┌────────────────────────────────────────────┐ │
│ │ 🔵 John                                   │ │
│ │ likes korean, bbq • budget-friendly        │ │
│ │ ░░░░░░░░░░ dietary: 0%                    │ │
│ │ ▓░░░░░░░░░ cuisine: 10%                   │ │
│ │ ▓▓░░░░░░░░ budget: 20%                    │ │
│ │ ░░░░░░░░░░ location: 0%                   │ │
│ └────────────────────────────────────────────┘ │
│                                                │
│ ┌────────────────────────────────────────────┐ │
│ │ 🟡 Priya                                  │ │
│ │ vegetarian • likes thai, japanese          │ │
│ │ ▓▓▓░░░░░░░ dietary: 60%                   │ │
│ │ ▓░░░░░░░░░ cuisine: 10%                   │ │
│ │ ░░░░░░░░░░ budget: 0%                     │ │
│ │ ░░░░░░░░░░ location: 0%                   │ │
│ └────────────────────────────────────────────┘ │
│                                                │
│ ┌────────────────────────────────────────────┐ │
│ │ Selection: Pareto Filtering + Nash Welfare │ │
│ └────────────────────────────────────────────┘ │
│                                                │
│ ┌────────────────────────────────────────────┐ │
│ │  ✨ Generate Fair Recommendation           │ │
│ └────────────────────────────────────────────┘ │
└───────────────────────────────────────────────┘
```

The profiles update in real time as people chat. Each colored card shows the `getProfileSummary()` output and per-dimension confidence bars.

---

## Act 7: Generate — The Recommendation Pipeline Fires

Aisha, the host, taps **Generate Fair Recommendation**. The button shows "Analyzing fairness..." and the entire pipeline activates.

### Step 7.1: Building the Group Query

```typescript
// app/api/recommend/route.ts
const profileSummaries = profiles.map(p => getProfileSummary(p)).join(' ');
// → "HALAL • likes indian likes korean, bbq • budget-friendly vegetarian • likes thai, japanese"

const groupQuery = `${currentPrefs} ${profileSummaries}`.trim();
// → "HALAL • likes indian likes korean, bbq • budget-friendly vegetarian • likes thai, japanese"
```

### Step 7.2: The Inverted Index is Built (Once)

The first time a recommendation runs, the system builds a TF-IDF inverted index over all 356 restaurants. This is cached for future requests.

```typescript
// lib/retrieval/inverted-index.ts — buildInvertedIndex()
// For each restaurant, extract terms:

// Example: "Paramount Fine Foods" (Middle Eastern, halal)
extractTerms(paramount) → [
  "middle eastern",    // from cuisine field
  "halal",            // from tags
  "restaurant",       // from tags
  "downtown core",    // from location
  "moderate",         // from price "$$"
  "well-rated",       // from rating 4.2
]

// TF-IDF for "halal" in Paramount:
//   TF = 1 + log₁₀(1) = 1.0  (appears once)
//   DF = 12 (12 restaurants have "halal")
//   IDF = log₁₀(356 / 12) = 1.47
//   TF-IDF = 1.0 × 1.47 = 1.47

// TF-IDF for "restaurant" in Paramount:
//   TF = 1.0
//   DF = 135 (135 restaurants tagged "restaurant")
//   IDF = log₁₀(356 / 135) = 0.42
//   TF-IDF = 1.0 × 0.42 = 0.42

// "halal" has 3.5× the weight of "restaurant" because it's rarer.
// This is the power of IDF: rare terms are more discriminative.
```

### Step 7.3: Stage 1 — Sparse Retrieval

The constraint extractor converts each user's profile into hard and soft constraints:

```typescript
// lib/fairness.ts — extractConstraints()

// Aisha's constraints:
{
  hard: [{ type: 'dietary', value: 'halal' }],     // MUST have halal
  soft: [
    { type: 'cuisine', value: 'indian', weight: 3 }, // Likes indian
  ],
}

// John's constraints:
{
  hard: [],                                          // No hard constraints
  soft: [
    { type: 'cuisine', value: 'korean', weight: 3 },
    { type: 'cuisine', value: 'bbq', weight: 3 },
    { type: 'price', value: '$', weight: 4 },        // weight = 6 - flexibility(3) - 1 = 4
  ],
}

// Priya's constraints:
{
  hard: [],                                          // Vegetarian is 'flexible', not hard!
  soft: [
    { type: 'cuisine', value: 'vegetarian-friendly', weight: 3 },
    { type: 'cuisine', value: 'thai', weight: 3 },
    { type: 'cuisine', value: 'japanese', weight: 3 },
    { type: 'cuisine', value: 'not-sushi', weight: 3 }, // Dislike → negative
  ],
}
```

Now sparse retrieval runs:

```typescript
// lib/retrieval/sparse-retrieval.ts — sparseRetrieve()

// Step 1: Gather ALL hard constraints across ALL users
allHard = [{ type: 'dietary', value: 'halal' }]  // Only Aisha's

// Step 2: Convert to Boolean query terms
mustMatch = ['halal']        // Must appear in restaurant
mustNotMatch = []            // No allergies to exclude

// Step 3: Boolean AND — fetch the "halal" posting list
postingList = getPostingList(index, 'halal')
// → Map { "paramount-fine-foods" → 1.47, "ali-baba-cafe" → 1.47, ... }
// → ~12 restaurants have halal
feasibleIds = Set { "paramount-fine-foods", "ali-baba-cafe", ... }  // 12 restaurants

// Step 4: Build weighted query from ALL soft constraints
queryWeights = {
  'indian':               3 × max(IDF('indian'), 0.1) = 3 × 0.89 = 2.67,
  'korean':               3 × max(IDF('korean'), 0.1) = 3 × 1.28 = 3.84,
  'barbecue':             3 × max(IDF('bbq→barbecue'), 0.1) = 3 × 1.55 = 4.65,
  'cheap':                4 × max(IDF('cheap'), 0.1) = 4 × 0.31 = 1.24,
  'vegetarian-friendly':  3 × max(IDF('vegetarian'), 0.1) = 3 × 1.15 = 3.45,
  'thai':                 3 × max(IDF('thai'), 0.1) = 3 × 1.10 = 3.30,
  'japanese':             3 × max(IDF('japanese'), 0.1) = 3 × 0.68 = 2.04,
}
// Notice: "barbecue" (rare, IDF=1.55) gets weighted higher than "japanese" (common, IDF=0.68)

// Step 5: Score each feasible restaurant
// For each of the 12 halal restaurants:
//   score = Σ queryWeight(t) × TF-IDF(t, restaurant) for all matching terms

// Step 6: Sort by score descending → return top 50
// (Only 12 are feasible here, so all 12 pass through)
```

**Key insight:** The Boolean AND on "halal" immediately reduces the search space from 356 to ~12. This is the power of hard constraint filtering — most of the corpus is eliminated in milliseconds.

### Step 7.4: Stage 2 — Dense Retrieval

Simultaneously, the dense stage runs. If the OpenAI API is available, embeddings are used. If not, the system falls back to feature vector cosine similarity.

**With OpenAI embeddings (primary path):**

```typescript
// The group query is embedded into a 1536-dimensional vector:
queryVector = await openai.embeddings.create({
  model: "text-embedding-3-small",
  input: "HALAL • likes indian likes korean, bbq • budget-friendly vegetarian • likes thai, japanese"
});
// queryVector = [0.023, -0.041, 0.018, ...] (1536 dimensions)

// Each restaurant was pre-embedded on first request and cached:
// "Paramount Fine Foods Middle Eastern halal restaurant $$ Downtown Core..."
// → restaurantVector = [-0.015, 0.033, ...]

// Score = cosine similarity between query and each restaurant
score = cos(queryVector, restaurantVector)
// Sort by score → return top 30
```

**Without OpenAI (fallback path) — Feature vector CBF:**

The system builds 48-dimensional feature vectors and scores each restaurant per-user:

```typescript
// lib/scoring/feature-vectors.ts

// Aisha's feature vector (48 dims):
// Dim 7 (indian):  (6/10) × 0.175_confidence × max(IDF, 0.5) = 0.6 × 0.175 × 0.89 = 0.093
// Dim 43 (halal):  max(2, IDF×2) = max(2, 1.47×2) = 2.94  ← HUGE weight (hard constraint)
// Dim 55 (rating): 0.5 (everyone likes high ratings)
// Dim 56 (pop):    0.3 (slight preference for popular)

// Restaurant "Paramount" feature vector:
// Dim 7 (indian):  0 (it's Middle Eastern, not Indian)
// Dim 10 (middle eastern): max(1, IDF) = max(1, 1.32) = 1.32
// Dim 43 (halal):  max(1, IDF) = max(1, 1.47) = 1.47
// Dim 55 (rating): (4.2 - 1) / 4 = 0.80
// Dim 56 (pop):    log₁₀(501) / log₁₀(5001) = 0.73

// cosine similarity = dot(aisha_vec, paramount_vec) / (|aisha| × |paramount|)
// The huge halal weights dominate the dot product → high similarity
```

### Step 7.5: Reciprocal Rank Fusion

The two ranked lists are merged:

```typescript
// lib/retrieval/hybrid-retrieval.ts — reciprocalRankFusion()

// Suppose:
//   Sparse: Paramount is rank 1 (best TF-IDF match for halal + query terms)
//   Dense:  Paramount is rank 5 (decent embedding match but not the semantic best)

RRF(Paramount) = 0.4 / (60 + 1) + 0.6 / (60 + 5)
               = 0.4/61 + 0.6/65
               = 0.00656 + 0.00923
               = 0.01579

// A restaurant that's rank 3 in sparse and rank 2 in dense:
RRF(AnotherPlace) = 0.4 / (60 + 3) + 0.6 / (60 + 2)
                   = 0.00635 + 0.00968
                   = 0.01603  ← slightly higher!

// RRF rewards agreement between the two systems.
// A restaurant appearing in both lists gets boosted.
```

**Output:** 15 candidates sorted by RRF score.

---

## Act 8: Fairness Scoring — Where the Real Math Happens

Now the system has 15 candidate restaurants. For each one, it must answer: *How happy would each person be?*

### Step 8.1: Per-User Satisfaction (for one restaurant)

Let's trace the scoring for **"Paramount Fine Foods"** (Middle Eastern, halal, $$, Downtown Core):

**Aisha's satisfaction:**

```typescript
// lib/fairness.ts — calculateUserSatisfaction(paramount, aishaProfile, index)

// Step 1: Hard constraint check
// Aisha has hard: [{ type: 'dietary', value: 'halal' }]
// restaurantSatisfiesHard(paramount, halalConstraint):
//   tags = ['middle eastern', 'halal', 'restaurant']
//   tags.some(t => t.includes('halal')) → TRUE ✓
// → Passes!

// Step 2: Cold-start check
// isColdStartUser(aisha): confidence.overall = 0.175 < 0.3 → TRUE!
// Aisha is cold-start. Use popularity-based scoring.

// calculateColdStartSatisfaction(paramount, aisha):
//   pop = rating × log₁₀(reviewCount + 1)
//       = 4.2 × log₁₀(501) = 4.2 × 2.70 = 11.34
//   popNorm = min(1, 11.34 / 15) = 0.756
//   coldScore = 0.5 + 0.3 × (0.756 - 0.5)
//             = 0.5 + 0.3 × 0.256
//             = 0.577

// Aisha's score = 0.577
// The narrow range [0.35, 0.65] prevents cold users from
// dominating the Nash Welfare calculation.
```

**John's satisfaction:**

```typescript
// Step 1: No hard constraints → passes trivially

// Step 2: Cold-start check
// john.confidence.overall = 0.075 < 0.3 → TRUE, cold-start!

// calculateColdStartSatisfaction(paramount, john):
//   pop = 4.2 × log₁₀(501) = 11.34
//   popNorm = 0.756
//   coldScore = 0.577

// John's score = 0.577
```

**Priya's satisfaction:**

```typescript
// Step 1: No hard constraints (vegetarian is 'flexible') → passes

// Step 2: Cold-start check
// priya.confidence.overall = 0.175 < 0.3 → TRUE, cold-start!

// Priya's score = 0.577
```

All three are cold-start users, so they all get very similar popularity-based scores!

### Step 8.2: Group Fairness Metrics

```typescript
// lib/fairness.ts — calculateGroupFairness(paramount, profiles, index)
scores = [0.577, 0.577, 0.577]

// Step 1: All satisfied? Yes, no hard violations.

// Step 2: Robust Nash Welfare
// All three are cold (confidence < 0.3)
// → calculateRobustNashWelfare():
//   warm = []  (nobody is warm)
//   cold = [0.577, 0.577, 0.577]
//   All cold → use arithmetic mean:
//   avg = (0.577 + 0.577 + 0.577) / 3 = 0.577

// Results:
{
  utilitarian: 0.577,       // Average
  egalitarian: 0.577,       // Minimum (all equal)
  nash: 0.577,              // Robust Nash (arithmetic mean for all-cold)
  gini: 0.000,              // Perfect equality!
}
```

### Step 8.3: What If Users Had Higher Confidence?

Let's fast-forward. After more conversation, if Aisha's overall confidence reached 0.6 (above the 0.3 cold-start threshold), her scoring would be very different:

```typescript
// No longer cold-start. Use hybrid scoring:
// Step 3: Manual soft-match
manualBase = (halal_match × 3 + indian_match × 3) / (3 + 3)
           = (1.0 × 3 + 0.0 × 3) / 6    // halal: yes, indian: no (it's Middle Eastern)
           = 0.5
manualScore = min(1, 0.5 × 0.9 + 0 + 0.1) = 0.55

// Step 5: Feature vector scoring (CBF)
vectorScore = cos(aishaVec, paramountVec) = 0.72

// Step 6: Blend
finalScore = α × vectorScore + (1-α) × manualScore
           = 0.6 × 0.72 + 0.4 × 0.55
           = 0.432 + 0.220 = 0.652

// Much more nuanced than the cold-start score!
```

---

## Act 9: Pareto Filtering + Nash Selection

### Step 9.1: Score All 15 Candidates

The system computes fairness metrics for all 15 candidates. Suppose we get these results:

```
Restaurant              Nash    Util    Egal    Gini
──────────────────────  ─────   ─────   ─────   ─────
Paramount Fine Foods    0.577   0.577   0.577   0.000
Ali Baba's Cafe         0.562   0.562   0.562   0.000
Halal Guys             0.545   0.545   0.545   0.000
Tabule                 0.590   0.590   0.590   0.000
(... 11 more ...)
```

### Step 9.2: Eliminate Hard Constraint Violators

```typescript
// lib/fairness.ts — selectBestRestaurant()
const feasible = scored.filter(c =>
  c.userSatisfaction.every(u => u.satisfied)
);
// Any restaurant where a user scored 0 (hard violation) is removed.
// In our case, the Boolean AND already filtered non-halal restaurants,
// so all 15 pass. But if a non-halal one slipped through via RRF,
// it would be caught here.
```

### Step 9.3: Pareto Efficiency Filter

```typescript
// filterParetoEfficient(feasible)
// A restaurant A is Pareto-dominated by B if B is at least as good
// for every user AND strictly better for at least one.

// With all-cold-start users, the scores are very similar,
// so few restaurants dominate each other.
// In the warm-user case, this filter is much more powerful.
```

### Step 9.4: Nash Welfare Maximization

```typescript
// Among Pareto-efficient candidates, select max Nash:
const selected = searchSet.reduce((best, curr) => {
  if (curr.metrics.nash > best.metrics.nash) return curr;
  // Tie-breaker 1: higher egalitarian (min satisfaction)
  if (curr.metrics.nash === best.metrics.nash &&
      curr.metrics.egalitarian > best.metrics.egalitarian) return curr;
  // Tie-breaker 2: higher RRF vector score
  if (curr.metrics.nash === best.metrics.nash &&
      curr.metrics.egalitarian === best.metrics.egalitarian &&
      curr.vectorScore > best.vectorScore) return curr;
  return best;
});

// Winner: "Tabule" with Nash = 0.590
```

---

## Act 10: The Recommendation Appears

### Step 10.1: Structured Explanation

The system generates a fairness explanation:

```typescript
// generateFairnessExplanation()
`**Tabule** (Middle Eastern/Mediterranean)
115 King St E, Toronto

**Fairness Scores:**
- Nash Welfare: 59% (selection criterion)
- Average satisfaction: 59%
- Minimum satisfaction: 59% (no one below this)
- Inequality index: 0% (lower is better)

**Per-Person Satisfaction:**
- Aisha: 59%
- John: 59%
- Priya: 59%

Selected via Pareto filtering + Nash Welfare maximization.`
```

### Step 10.2: LLM Natural Language Explanation

GPT-4-Turbo receives the structured data and generates a human-readable summary:

```typescript
// Prompt to GPT-4-Turbo:
`Based on the fairness analysis, we've selected: Tabule
User Profiles:
  Aisha: HALAL • likes indian
  John: likes korean, bbq • budget-friendly
  Priya: vegetarian • likes thai, japanese
Nash Welfare: 59%
Provide a brief explanation of why this is a good choice.`

// GPT-4-Turbo response:
"Tabule at 115 King St E is an excellent group choice — their Middle
Eastern and Mediterranean menu features halal-certified dishes for Aisha,
plenty of vegetarian mezze options for Priya, and grilled kebab platters
that should satisfy John's love of barbecue, all at moderate prices."
```

### Step 10.3: The UI Shows Results

The right panel now shows the fairness card and recommendation:

```
┌───────────────────────────────────────────────┐
│ FAIRNESS ANALYSIS                             │
│                                               │
│ Nash Welfare    ▓▓▓▓▓▓░░░░  59%               │
│ Avg Sat.        ▓▓▓▓▓▓░░░░  59%               │
│ Min Sat.        ▓▓▓▓▓▓░░░░  59%               │
│ Inequality      ░░░░░░░░░░  0%  (perfect)     │
│                                               │
│ Aisha   ▓▓▓▓▓▓░░░░  59%                      │
│ John    ▓▓▓▓▓▓░░░░  59%                      │
│ Priya   ▓▓▓▓▓▓░░░░  59%                      │
│                                               │
│ ┌───────────────────────────────────────────┐ │
│ │ 🏆 Tabule  ⭐ Pareto Efficient           │ │
│ │ Middle Eastern/Mediterranean  $$          │ │
│ │ 115 King St E, Toronto                   │ │
│ │ ⭐ 4.3/5 (820 reviews)                   │ │
│ │                                          │ │
│ │ Tabule at 115 King St E is an excellent  │ │
│ │ group choice — their Middle Eastern and  │ │
│ │ Mediterranean menu features halal-       │ │
│ │ certified dishes for Aisha, plenty of    │ │
│ │ vegetarian mezze options for Priya...    │ │
│ └───────────────────────────────────────────┘ │
│                                               │
│ Other candidates:                             │
│ #2 Paramount Fine Foods  (58%)                │
│ #3 Ali Baba's Café       (56%)                │
│ #4 Sultan's Tent          (55%)                │
└───────────────────────────────────────────────┘
```

---

## Act 11: The Critique Loop — "That's too far"

John is unhappy. He types: **"That's too far away from me"**

### Critique Detection

```typescript
// lib/conversation-engine.ts — detectCritique()
const lower = "that's too far away from me";
/\b(too far|don't want to drive)\b/.test(lower) → TRUE
// → { isCritique: true, type: 'too_far' }
```

### Profile Update from Critique

```typescript
// handleCritique(critique, johnProfile)
case 'too_far':
  john.location.maxDistance = Math.max(2, 10 - 3) = 7;  // Reduced by 3 km
  john.confidence.location += 0.15;  // Now 0.15
  john.confidence.overall = (0 + 0.1 + 0.2 + 0.15) / 4 = 0.1125;
```

### System Response

```
"Understood, John — that's too far. I'll look for places closer
to you. Try generating again!"
```

The conversation engine transitions to `critique` phase. When Aisha hits **Generate** again, the pipeline re-runs with John's updated location constraint in the soft query, steering results toward nearer restaurants.

---

## Act 12: In-Car Mode — The Final Mile

After agreeing on the restaurant, Priya switches to **In-Car Mode** (a dedicated dark-themed interface for driving):

```
┌─────────────────────────────────────┐
│          iNAGO Eats                 │
│     Aisha, John, Priya             │
│                                     │
│  ┌─────────────────────────────┐   │
│  │                             │   │
│  │        T A B U L E          │   │
│  │                             │   │
│  │  Middle Eastern/Med.  $$    │   │
│  │     ⭐ 4.3                  │   │
│  │                             │   │
│  │  115 King St E, Toronto     │   │
│  │  3.2 km away • ~5 min      │   │
│  │                             │   │
│  │  Group fairness: 59%        │   │
│  │                             │   │
│  │  ┌───────────────────┐     │   │
│  │  │  🧭 Navigate       │     │   │
│  │  └───────────────────┘     │   │
│  │                             │   │
│  │     Back to chat            │   │
│  └─────────────────────────────┘   │
│                                     │
│  ┌─────────────────────────────┐   │
│  │ Speak or type...       🎤 ➤│   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

The "Navigate" button opens Google Maps directions:

```typescript
// InCarMode.tsx
const openNavigation = (address: string) => {
  const encoded = encodeURIComponent(address);
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${encoded}`, '_blank');
};
```

Voice input is available for hands-free interaction via the Web Speech API:

```typescript
const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
recognition.onresult = (event) => {
  const transcript = event.results[0][0].transcript;
  setInput(transcript);
  // Auto-submit after 1.5s
  setTimeout(() => form.requestSubmit(), 1500);
};
```

---

## Act 13: The Evaluation Dashboard — Measuring How Well We Did

Separately, the `/eval` page runs the entire pipeline on 10 pre-defined test scenarios without any API calls (using feature-vector-only mode):

```
┌───────────────────────────────────────────────────────┐
│ Evaluation Dashboard                                   │
│ Hybrid retrieval + fairness evaluation                 │
│                                                        │
│ Pass Rate    Avg Nash    Avg Gini    P@3    NDCG@5     │
│   8/10        54%         12%       67%      71%       │
│                                                        │
│ Nash Lift vs Popularity: +23%                          │
│                                                        │
│ ── Scenario Results ──                                 │
│                                                        │
│ ✅ 1. Vegan + BBQ Lover       Nash: 48%  P@3: 67%     │
│ ✅ 2. All Users Agree          Nash: 72%  P@3: 100%    │
│ ✅ 3. Budget Extremes          Nash: 51%  P@3: 67%     │
│ ✅ 4. Single User              Nash: 63%  P@3: 67%     │
│ ✅ 5. Six Diverse Users        Nash: 41%  P@3: 33%     │
│ ✅ 6. Allergy Safety           Nash: 55%  P@3: 67%     │
│ ✅ 7. Same Cuisine, Diff Loc   Nash: 58%  P@3: 67%     │
│ ❌ 8. Halal Requirement        Nash: 49%  P@3: 33%     │
│ ✅ 9. Nash vs Utilitarian      Nash: 52%  P@3: 67%     │
│ ✅ 10. Gluten-Free + Pizza     Nash: 50%  P@3: 67%     │
└───────────────────────────────────────────────────────┘
```

Expanding a scenario shows the baseline comparison table:

```
┌─────────────────────────────────────────────────────┐
│ Baseline Comparison — Scenario 1: Vegan + BBQ Lover │
│                                                      │
│ System          Nash   Avg    Min    Gini   Pick     │
│ ─────────────   ─────  ─────  ─────  ─────  ──────── │
│ Hybrid + Nash   48%    52%    44%    15%    Rosalinda │
│ Popularity      39%    45%    33%    27%    Pai       │
│ Random (avg)    31%    38%    24%    37%    (sample)  │
│                                                      │
│ The hybrid system achieves +23% Nash lift over       │
│ popularity, meaning it finds fairer restaurants than  │
│ simply picking the most popular one.                  │
└─────────────────────────────────────────────────────┘
```

### Evaluation Metrics Explained

**Precision@3:** Of the top 3 restaurants returned, how many are actually "relevant" (Nash ≥ 0.4)?

```typescript
// lib/eval/metrics.ts
P@3 = |{r ∈ top-3 : grade(r) ≥ 2}| / 3
// grade ≥ 2 means Nash ≥ 0.4
// If 2 of the top 3 have Nash ≥ 0.4: P@3 = 67%
```

**NDCG@5:** Are the most relevant restaurants ranked at the top?

```typescript
// DCG@5 = Σ (2^relevance - 1) / log₂(rank + 1)
// If top-5 are grades [3, 2, 3, 1, 2]:
DCG = (2³-1)/log₂(2) + (2²-1)/log₂(3) + (2³-1)/log₂(4) + (2¹-1)/log₂(5) + (2²-1)/log₂(6)
    = 7/1 + 3/1.58 + 7/2 + 1/2.32 + 3/2.58
    = 7 + 1.90 + 3.5 + 0.43 + 1.16 = 13.99

// IDCG (ideal) = sort grades descending [3, 3, 2, 2, 1], compute same formula
// NDCG = DCG / IDCG
```

**Nash Lift:** How much better is our system than just recommending the most popular restaurant?

```typescript
nashLift = (nash_system - nash_popularity) / nash_popularity
// = (0.48 - 0.39) / 0.39 = +23%
```

---

## Summary: The Complete Gear Train

```
User Message
    │
    ├─→ Regex Extraction ─→ Profile Update ─→ Confidence++
    │         │
    │    (complex?)─→ GPT-3.5 Extraction ─→ Profile Merge
    │
    ├─→ Conversation Engine ─→ Phase Transition
    │         │                      │
    │    (low confidence?)     (critique?)
    │         │                      │
    │    Ask Questions          Update Profile
    │
    └─→ On "Generate" button:
              │
              ├─→ Build Inverted Index (cached)
              │
              ├─→ Stage 1: Sparse Retrieval
              │     Boolean AND (hard constraints)
              │     + TF-IDF scoring (soft preferences)
              │     → Top 50
              │
              ├─→ Stage 2: Dense Retrieval
              │     OpenAI embeddings OR Feature vectors
              │     → Top 30
              │
              ├─→ Reciprocal Rank Fusion → Top 15
              │
              ├─→ Per-User Satisfaction Scoring (×15 restaurants × n users)
              │     Cold-start? → Popularity score [0.35, 0.65]
              │     Warm user? → α×CBF + (1-α)×manual
              │
              ├─→ Group Fairness Metrics
              │     Utilitarian, Egalitarian, Nash, Gini
              │     (Robust Nash for cold-start users)
              │
              ├─→ Pareto Filter → Nash Maximization → Winner
              │
              ├─→ GPT-4-Turbo Explanation
              │
              └─→ Display with per-user satisfaction bars
```

Every gear in this machine exists for a reason. The inverted index exists so we don't compute fairness for 356 restaurants. The cold-start handler exists so that unknown users don't break the Nash calculation. The confidence-weighted blend exists so that well-known users get vector scoring while unknown users get simpler constraint matching. And Nash Welfare exists so that no person in the group gets left behind.
