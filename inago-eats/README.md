# iNAGO Eats

A fairness-aware group dining recommendation system for Toronto restaurants. This application uses AI to analyze group conversations, extract individual preferences, and recommend restaurants that maximize satisfaction for everyone in the group.

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

## AI System Architecture

The system implements a multi-stage AI pipeline that processes group conversations and generates fair restaurant recommendations.

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER INTERFACE                                  │
│  ┌─────────────┐    ┌─────────────────────┐    ┌───────────────────────┐   │
│  │ Group Chat  │───▶│ Persistent Profiles │───▶│ Recommendation Panel  │   │
│  │ (4 users)   │    │ (localStorage)      │    │ (candidates + final)  │   │
│  └─────────────┘    └─────────────────────┘    └───────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
          │                      │                          ▲
          ▼                      ▼                          │
┌─────────────────────────────────────────────────────────────────────────────┐
│                              API LAYER                                       │
│  ┌─────────────────────┐              ┌──────────────────────────────────┐  │
│  │   /api/analyze      │              │      /api/recommend              │  │
│  │   (Preference       │              │      (Vector Search +            │  │
│  │    Extraction)      │              │       Fairness Logic)            │  │
│  └─────────────────────┘              └──────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
          │                                          │
          ▼                                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AI MODELS                                       │
│  ┌─────────────────────┐    ┌─────────────────┐    ┌────────────────────┐  │
│  │ GPT-3.5-turbo       │    │ text-embedding- │    │ GPT-4-turbo        │  │
│  │ (Fast extraction)   │    │ 3-small         │    │ (Fairness logic)   │  │
│  └─────────────────────┘    │ (Semantic       │    └────────────────────┘  │
│                             │  search)        │                             │
│                             └─────────────────┘                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### Stage 1: Conversation Ingestion & Preference Extraction

**Endpoint:** `POST /api/analyze`

**Model:** `gpt-3.5-turbo-0125` (optimized for speed and cost)

When users send messages in the group chat, the system:

1. **Collects conversation history** - All messages with user attribution
2. **Sends to GPT-3.5** with a structured prompt:
   ```
   You are an AI assistant analyzing a group chat about dinner plans.
   Extract the key preferences for EACH user.
   Return a JSON object where keys are user names and values are strings
   summarizing their specific constraints (diet, cuisine, budget, location).
   ```
3. **Parses structured response** - Returns preferences per user

**Example Input:**
```
Aisha: I'm vegan and love Asian food
John: I want BBQ ribs tonight
Josh: Let's keep it cheap, somewhere downtown
Kate: I'm easy, whatever works for everyone
```

**Example Output:**
```json
{
  "Aisha": "Vegan, prefers Asian cuisine",
  "John": "Wants BBQ, specifically ribs",
  "Josh": "Budget-conscious, prefers downtown location",
  "Kate": "Flexible, no specific constraints"
}
```

---

### Stage 2: Persistent User Profiles

**Storage:** Browser `localStorage`

The system maintains long-term memory for each user:

```typescript
interface UserMemory {
  preferences: string;           // Full preference text
  dietaryRestrictions: string[]; // ["vegan", "gluten-free", ...]
  favoriteCuisines: string[];    // ["asian", "italian", ...]
  pricePreference: string;       // "budget" | "moderate" | "upscale"
  locationPreference: string;    // "downtown" | "midtown" | ...
  lastUpdated: number;           // Timestamp
}
```

**Extraction Logic:**
- Dietary restrictions detected: vegan, vegetarian, gluten-free, halal, kosher, dairy-free
- Cuisines detected: italian, chinese, japanese, thai, indian, mexican, korean, vietnamese, bbq, seafood, sushi, pizza, burger, asian, mediterranean
- Price signals: cheap/budget/affordable → "budget", expensive/upscale/fancy → "upscale"

**Persistence Flow:**
```
Chat Message → Preference Extraction → Memory Update → localStorage.setItem()
                                                              │
Page Refresh → localStorage.getItem() → Load into State ◀────┘
```

---

### Stage 3: Semantic Vector Search

**Endpoint:** `POST /api/recommend` (first half)

**Model:** `text-embedding-3-small` (1536 dimensions)

**Database:** 356 Toronto restaurants from Yelp data

1. **Build Group Query** - Combine current session preferences + persistent memories:
   ```typescript
   const groupQuery = `${currentPrefs} ${persistentPrefs}`.trim();
   // Example: "Vegan Asian BBQ ribs cheap downtown flexible"
   ```

2. **Embed the Query** - Convert to 1536-dimensional vector

3. **Embed Restaurants** (cached after first request):
   ```typescript
   // For each restaurant, embed:
   `${name} ${cuisine} ${description} ${price} ${location} ${tags.join(' ')}`
   ```

4. **Cosine Similarity Search**:
   ```typescript
   function cosineSimilarity(vecA: number[], vecB: number[]): number {
     let dotProduct = 0, normA = 0, normB = 0;
     for (let i = 0; i < vecA.length; i++) {
       dotProduct += vecA[i] * vecB[i];
       normA += vecA[i] * vecA[i];
       normB += vecB[i] * vecB[i];
     }
     return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
   }
   ```

5. **Retrieve Top-K Candidates** - Sort by similarity score, take top 6

---

### Stage 4: Fairness-Aware Recommendation

**Endpoint:** `POST /api/recommend` (second half)

**Model:** `gpt-4-turbo` (for complex reasoning)

The top candidates from vector search are passed to GPT-4 with full context:

**Prompt Structure:**
```
You are a Group Dining Recommender for Toronto restaurants.

The Group Conversation:
[Full chat history]

Current Session Preferences:
[Extracted preferences from this chat]

Persistent User Profiles (long-term preferences from past sessions):
[Saved user memories]

Top Retrieved Candidates (based on semantic search across 356 restaurants):
[Restaurant details with match scores]

Task:
1. Analyze candidates against BOTH current AND persistent preferences
2. Persistent profiles contain long-term preferences that should ALWAYS
   be considered (e.g., if a user is always vegan, respect that)
3. Select the ONE best restaurant that maximizes group fairness
4. Explain WHY you picked it and why others were rejected
5. If no perfect match exists, suggest the best compromise
6. Include practical details like address and what to expect
```

**Fairness Criteria:**
- **Hard constraints** must be satisfied (dietary restrictions like vegan)
- **Soft preferences** are balanced (BBQ vs Asian → find a place with both)
- **Budget alignment** across the group
- **Location convenience** for all members
- **No user should be completely unsatisfied**

---

### Stage 5: Response Delivery

The final response includes:

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
      score: number  // Cosine similarity (0-1)
    }
  ],
  recommendation: string,  // GPT-4's detailed explanation
  totalRestaurants: number // 356 (for UI display)
}
```

---

## Complete Data Flow Example

```
1. USER ACTION
   Aisha clicks send: "I'm vegan, craving sushi tonight"

2. FRONTEND
   → Creates Message object
   → Updates messages state
   → Calls POST /api/analyze

3. PREFERENCE EXTRACTION (/api/analyze)
   → GPT-3.5-turbo processes conversation
   → Returns: { "Aisha": "Vegan, wants sushi" }

4. MEMORY UPDATE (Frontend)
   → Extracts: dietaryRestrictions=["vegan"], favoriteCuisines=["sushi"]
   → Saves to localStorage

5. USER ACTION
   Clicks "Generate Recommendation"

6. VECTOR SEARCH (/api/recommend)
   → Combines: "Vegan sushi" + any persistent memories
   → Embeds query → [0.12, -0.34, 0.56, ...]
   → Compares against 356 restaurant embeddings
   → Returns top 6 by cosine similarity

7. FAIRNESS REASONING (/api/recommend)
   → GPT-4-turbo receives:
     - Chat history
     - Current preferences
     - Persistent profiles
     - Top 6 candidates
   → Applies fairness logic
   → Returns: "I recommend PLANTA Queen because..."

8. FRONTEND DISPLAY
   → Shows 4 candidate cards with match %
   → Shows detailed recommendation text
```

---

## Technology Stack

| Component | Technology |
|-----------|------------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| AI - Fast Tasks | GPT-3.5-turbo-0125 |
| AI - Reasoning | GPT-4-turbo |
| AI - Embeddings | text-embedding-3-small |
| Vector Search | In-memory cosine similarity |
| Persistence | Browser localStorage |
| Data | 356 Toronto restaurants (Yelp) |

---

## Deploy on Vercel

1. Push to GitHub
2. Import project on [Vercel](https://vercel.com)
3. Add `OPENAI_API_KEY` in Environment Variables
4. Deploy

---

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [OpenAI API Reference](https://platform.openai.com/docs)
- [Tailwind CSS](https://tailwindcss.com/docs)
