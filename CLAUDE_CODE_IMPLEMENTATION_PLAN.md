# iNAGO Eats — Claude Code Implementation Plan

> **Purpose:** This document is a step-by-step implementation plan for Claude Code to execute against the iNAGO-capstone repository (https://github.com/kalalwan/iNAGO-capstone). Each phase has specific files to create/modify, exact interfaces to implement, and acceptance criteria. Execute phases in order.

---

## Repository Context

- **Stack:** Next.js 16.1.1, React 19.2.3, TypeScript, Tailwind CSS 4, OpenAI API
- **Deployed at:** https://i-nago-capstone.vercel.app
- **Key source files:**

| File | Purpose |
|------|---------|
| `app/page.tsx` (~845 lines) | Monolithic main UI — chat + analytics dashboard |
| `app/api/analyze/route.ts` (~159 lines) | Preference extraction endpoint |
| `app/api/recommend/route.ts` (~255 lines) | Recommendation endpoint |
| `lib/types.ts` (~237 lines) | All TypeScript interfaces |
| `lib/fairness.ts` (~599 lines) | Fairness scoring, Pareto filtering, Nash welfare |
| `lib/profile-utils.ts` (~507 lines) | Local regex extraction, profile updates |
| `lib/data.ts` (~13 lines) | Exports RESTAURANTS (356 items) and hardcoded USERS array |
| `lib/utils.ts` (~20 lines) | `cn()` classname helper, `cosineSimilarity()` |
| `lib/restaurants.json` (~9883 lines) | 356 Toronto restaurants with lat/lon |

- **Current hardcoded users** (in `lib/data.ts`):
  - Aisha (green), John (blue), Josh (yellow), Kate (purple)
- **Current architecture problem:** Everything runs on one page with 4 hardcoded user tabs. There's no concept of a "session" that multiple people can join. Each user is just a tab on the same screen.

---

## Phase 1: Multi-User Session System (MAJOR — Do This First)

### 1.1 Goal

Replace the hardcoded 4-user setup with a dynamic session system where:
- A user creates a **session** (gets a shareable session code/link)
- Other users **join** the session with their name
- Each user has their own chat input tied to their identity
- The session owner can trigger "Generate Recommendation" for the whole group
- Profiles persist per-session, not globally in localStorage

### 1.2 New Types — Add to `lib/types.ts`

```typescript
// === SESSION TYPES ===

export interface Session {
  id: string;                          // 6-char alphanumeric code (e.g., "X7K2M9")
  createdAt: number;                   // timestamp
  createdBy: string;                   // userId of creator
  status: 'waiting' | 'active' | 'recommending' | 'complete';
  users: SessionUser[];                // participants
  messages: SessionMessage[];          // all chat messages
  recommendations: RecommendationResult | null;
  settings: SessionSettings;
}

export interface SessionUser {
  id: string;                          // uuid
  name: string;
  color: string;                       // auto-assigned from palette
  joinedAt: number;
  isHost: boolean;
  profile: StructuredUserProfile;
}

export interface SessionMessage {
  id: string;
  userId: string;
  userName: string;
  userColor: string;
  content: string;
  timestamp: number;
  extractedPreferences?: Partial<ExtractedPreferences>; // what was parsed from this message
}

export interface SessionSettings {
  maxUsers: number;                    // default 6
  fairnessMode: 'balanced' | 'egalitarian' | 'utilitarian';
  allowLateJoin: boolean;              // can users join after chat starts
}

export interface RecommendationResult {
  candidates: ScoredRestaurant[];
  recommendation: string;
  fairnessResult: FairnessResult;
  generatedAt: number;
}
```

### 1.3 New File: `lib/session-store.ts`

Create an in-memory + localStorage session store. This is a client-side store for the MVP. A future version could use a real database, but for the capstone demo this is sufficient.

```typescript
// Key functions to implement:

export function createSession(hostName: string): Session
// - Generate 6-char code (uppercase alphanumeric)
// - Create host user with auto-assigned color
// - Initialize empty messages array
// - Save to localStorage under key `inago-session-${id}`
// - Return the session

export function joinSession(sessionId: string, userName: string): Session
// - Load session from localStorage
// - Check if session exists and isn't full
// - Add new user with auto-assigned color (pick from palette, skip used colors)
// - Save updated session
// - Return updated session

export function addMessage(sessionId: string, userId: string, content: string): SessionMessage
// - Create message with timestamp
// - Append to session.messages
// - Save session
// - Return the new message

export function updateUserProfile(sessionId: string, userId: string, profile: StructuredUserProfile): void
// - Find user in session, update their profile
// - Save session

export function getSession(sessionId: string): Session | null
// - Load from localStorage

export function listRecentSessions(): { id: string; createdAt: number; userCount: number }[]
// - Scan localStorage for session keys
// - Return summary list for "rejoin" UI

const USER_COLORS = [
  '#22c55e', // green
  '#3b82f6', // blue
  '#eab308', // yellow
  '#a855f7', // purple
  '#ef4444', // red
  '#06b6d4', // cyan
  '#f97316', // orange
  '#ec4899', // pink
];
```

### 1.4 New File: `app/components/SessionLobby.tsx`

This replaces the old "just start chatting" entry point. Three states:

**State 1: Landing**
- App title "iNAGO Eats" with tagline
- Two buttons: "Create Session" and "Join Session"
- Below: list of recent sessions (from localStorage) with "Rejoin" links

**State 2: Create Session**
- Text input: "Your name"
- Button: "Create & Get Code"
- After creation: show the session code prominently (large, copyable)
- Show a "Share this code" instruction
- Button: "Start Chatting" (goes to chat view)

**State 3: Join Session**
- Text input: "Session Code" (6 chars, uppercase)
- Text input: "Your Name"
- Button: "Join"
- Error handling: "Session not found", "Session full"

**Props:**
```typescript
interface SessionLobbyProps {
  onSessionReady: (session: Session, currentUserId: string) => void;
}
```

### 1.5 Refactor `app/page.tsx` → Component-Based Architecture

The current `page.tsx` is ~845 lines doing everything. Break it up:

**`app/page.tsx`** — now just orchestrates state:
```typescript
// Simplified structure:
export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  if (!session) {
    return <SessionLobby onSessionReady={(s, uid) => { setSession(s); setCurrentUserId(uid); }} />;
  }

  return <ChatSession session={session} currentUserId={currentUserId} />;
}
```

**`app/components/ChatSession.tsx`** — the main chat + dashboard view:
- Move ALL the existing chat logic from page.tsx here
- Replace hardcoded `USERS` references with `session.users`
- Replace hardcoded user tabs with dynamic user pills generated from `session.users`
- The "active user" is always `currentUserId` (no switching — you ARE one user)
- Other users' messages appear in the chat with their name/color
- Keep the right-side analytics panel (profiles, fairness metrics, recommendation)
- The "Generate Fair Recommendation" button is only visible to the host (`session.createdBy === currentUserId`)

**`app/components/UserProfileCard.tsx`** — extract from page.tsx:
- The expandable user profile card with confidence bars
- Currently inline in page.tsx, extract as standalone component
- Props: `{ profile: StructuredUserProfile; isCurrentUser: boolean; onReset?: () => void }`

**`app/components/FairnessMetricsCard.tsx`** — extract from page.tsx:
- The Nash welfare / avg / min / gini display
- The per-person satisfaction bars
- Currently inline, extract as standalone component
- Props: `{ fairnessResult: FairnessResult; users: SessionUser[] }`

**`app/components/RecommendationResults.tsx`** — extract from page.tsx:
- The candidate restaurant cards
- The final recommendation text
- Props: `{ result: RecommendationResult }`

### 1.6 Update API Routes

**`app/api/analyze/route.ts`:**
- Change input to accept `SessionMessage[]` instead of raw message arrays
- Group messages by userId, run extraction per-user
- Return updated profiles keyed by userId

**`app/api/recommend/route.ts`:**
- Accept `SessionUser[]` (with embedded profiles) instead of separate preferences object
- The rest of the logic (embedding, cosine similarity, fairness scoring) stays the same

### 1.7 Remove Hardcoded Users

**`lib/data.ts`:**
- Remove the `USERS` export entirely (or keep only as test fixtures)
- Keep `RESTAURANTS` export unchanged

### 1.8 Acceptance Criteria

- [ ] App loads to a session lobby (no hardcoded users visible)
- [ ] User can create a session and see a 6-character code
- [ ] User can join an existing session by code + name
- [ ] Chat shows all users' messages with correct name/color attribution
- [ ] User can only type as themselves (no switching tabs to be other users)
- [ ] Host can trigger recommendation generation
- [ ] Fairness metrics and profiles display correctly for dynamic user count (2-8 users)
- [ ] Sessions persist in localStorage and can be rejoined
- [ ] `npm run build` passes with no TypeScript errors

---

## Phase 2: Conversational Intelligence

### 2.1 Goal

Add active conversational behaviors so the system isn't just a passive preference collector. The system should proactively ask questions, handle critiques, and negotiate trade-offs.

### 2.2 New File: `lib/conversation-engine.ts`

This module manages conversation state and generates system responses.

```typescript
export type ConversationPhase =
  | 'greeting'          // Initial welcome, ask about occasion
  | 'elicitation'       // Actively asking for preferences
  | 'clarification'     // Following up on ambiguous input
  | 'ready'             // Enough info to recommend
  | 'recommendation'    // Showing results
  | 'critique'          // User pushed back, refining
  | 'comparison'        // Comparing multiple options

export interface ConversationState {
  phase: ConversationPhase;
  turnCount: number;
  usersWithLowConfidence: string[];   // userIds needing more info
  pendingQuestions: ElicitationQuestion[];
  lastRecommendation: RecommendationResult | null;
  critiques: CritiqueRecord[];
}

export interface ElicitationQuestion {
  targetUserId: string;
  question: string;
  category: 'dietary' | 'cuisine' | 'budget' | 'location' | 'ambiance';
  priority: number;   // higher = ask sooner
}

export interface CritiqueRecord {
  userId: string;
  message: string;
  type: 'too_expensive' | 'wrong_cuisine' | 'too_far' | 'dietary_concern' | 'general_dislike';
  constraintUpdate: Partial<UserConstraints>;
}
```

**Key functions:**

```typescript
export function initConversation(users: SessionUser[]): ConversationState
// Initialize with greeting phase
// Identify which users have low confidence profiles

export function processMessage(
  state: ConversationState,
  message: SessionMessage,
  userProfile: StructuredUserProfile
): { updatedState: ConversationState; systemResponse: string | null }
// Main brain of the conversation:
// 1. Update phase based on message content
// 2. If in elicitation: check if the message answers a pending question, remove it
// 3. If confidence is still low for some users: generate next question
// 4. If user expresses critique: detect it, create CritiqueRecord, transition to critique phase
// 5. If all users have confidence > 0.5: transition to 'ready' phase
// 6. Return optional system message (the bot's response)

export function generateElicitationQuestions(
  users: SessionUser[]
): ElicitationQuestion[]
// Look at each user's profile confidence scores
// For the lowest-confidence dimensions, generate natural questions:
// - dietary (conf < 0.3): "Do you have any dietary restrictions or allergies we should know about?"
// - cuisine (conf < 0.3): "What types of food are you in the mood for today?"
// - budget (conf < 0.3): "What's your budget range for this meal?"
// - location (conf < 0.3): "Any preference for which part of the city?"
// Personalize: use the user's name, reference what we already know
// Return sorted by priority (lowest confidence first)

export function detectCritique(
  message: string
): { isCritique: boolean; type: CritiqueRecord['type'] | null }
// Regex/keyword detection for negative feedback:
// - "too expensive" / "too pricey" / "can't afford" → too_expensive
// - "don't like [cuisine]" / "not in the mood for" → wrong_cuisine
// - "too far" / "don't want to drive" → too_far
// - "can't eat there" / "not safe for me" → dietary_concern
// - "no" / "not that one" / "try again" / "something else" → general_dislike

export function handleCritique(
  critique: CritiqueRecord,
  currentProfile: StructuredUserProfile
): StructuredUserProfile
// Update the user's profile based on the critique:
// - too_expensive: lower budget.preferred by one tier
// - wrong_cuisine: add to dislikes
// - too_far: reduce maxDistance
// - dietary_concern: add hard constraint
// - general_dislike: add restaurant to visited (avoid re-recommending)

export function generateTradeOffSummary(
  fairnessResult: FairnessResult,
  users: SessionUser[]
): string
// When Gini > 0.3, generate a message explaining the tension:
// "I notice [User A] would love this choice but [User B] is less excited.
//  Here's what's happening: [A] gets a 0.9 satisfaction because of the cuisine match,
//  but [B] only gets 0.4 because it's over budget. Would you like to see alternatives
//  that are more balanced, even if no one's score is as high?"

export function generateComparisonSummary(
  candidates: ScoredRestaurant[],
  users: SessionUser[]
): string
// Create a structured comparison of top 3 options:
// "Option 1 (Restaurant A): Best for [User X] (score: 0.9) but weakest for [User Y] (0.5)
//  Option 2 (Restaurant B): Most balanced — everyone scores between 0.6 and 0.75
//  Option 3 (Restaurant C): Highest average but [User Z] has a dietary concern"
```

### 2.3 Add System Messages to Chat UI

**In `app/components/ChatSession.tsx`:**

- Add a "system" message type that renders differently (centered, lighter background, no user avatar)
- After each user message, call `processMessage()` and if it returns a systemResponse, add it as a system message
- System messages should feel conversational, not robotic:
  - Good: "Hey John, I noticed you haven't mentioned what kind of food you're into — any favorites?"
  - Bad: "USER JOHN: CUISINE PREFERENCE NOT DETECTED. PLEASE SPECIFY."

### 2.4 Add "Ready to Recommend" Indicator

- When all users have confidence > 0.5, show a green banner: "I have a good sense of what everyone wants. Ready to find your restaurant!"
- When some users are still low confidence, show amber: "Still learning about [names] — keep chatting or I can ask some questions"
- Add a "Ask Me Questions" button that triggers the elicitation flow explicitly

### 2.5 Post-Recommendation Critique Loop

After a recommendation is shown:
- Keep the chat input active
- If a user sends a message that's detected as a critique, update their profile and re-run recommendation
- Show a message like: "Got it, [name] — that's too pricey. Let me find something more affordable for the group..."
- Re-run the recommendation with updated constraints
- Show the new result alongside the previous one for comparison

### 2.6 Acceptance Criteria

- [ ] System greets users when they first join a session
- [ ] System proactively asks questions to users with low confidence profiles
- [ ] System detects negative feedback / critiques and adjusts
- [ ] System explains trade-offs when group satisfaction is uneven (Gini > 0.3)
- [ ] System provides comparison summaries of top options
- [ ] Post-recommendation critique triggers re-recommendation
- [ ] All system messages feel natural and conversational

---

## Phase 3: Restaurant Q&A Module

### 3.1 Goal

Users naturally ask questions like "Does that place have parking?" or "How far is it from campus?" The system should answer using the restaurant data.

### 3.2 New File: `lib/restaurant-qa.ts`

```typescript
export function detectQuestion(message: string): boolean
// Returns true if the message is asking a question about restaurants
// Patterns: starts with "does", "is", "how", "what", "where", "can", contains "?"

export function answerQuestion(
  message: string,
  restaurants: Restaurant[],
  recentRecommendation: RecommendationResult | null
): string | null
// Try to answer the question from restaurant data:
// - "How far is [restaurant]?" → Calculate distance using lat/lon from user's preferred area
// - "What's the price range?" → Return restaurant.price
// - "Do they have [feature]?" → Check tags array
// - "What cuisine is it?" → Return restaurant.cuisine
// - "Where is it?" → Return restaurant.address, restaurant.location
// - "Is it good?" → Return restaurant.rating + reviewCount
// If question references "that place" / "the restaurant" / "it",
//   use the most recently recommended restaurant
// If can't answer: return null (let the conversation continue normally)
```

### 3.3 Integration

In `conversation-engine.ts` `processMessage()`:
- Before doing preference extraction, check if the message is a question via `detectQuestion()`
- If yes, try to answer it via `answerQuestion()`
- If answered, return the answer as a system response and skip preference extraction for that message

### 3.4 Acceptance Criteria

- [ ] "How far is Richmond Station?" returns a distance estimate
- [ ] "What kind of food is that?" references the last recommended restaurant
- [ ] "Is it expensive?" returns the price tier
- [ ] Unknown questions get a graceful "I don't have that information, but you can check their website" response

---

## Phase 4: In-Car Mode UI

### 4.1 Goal

Add an "In-Car Mode" that demonstrates the in-vehicle use case for iNAGO. This is a visual/UX mode, not a separate app.

### 4.2 New File: `app/components/InCarMode.tsx`

A simplified, high-contrast interface optimized for automotive displays:

**Design requirements:**
- Dark background (#1a1a2e or similar dark theme)
- Large text (minimum 18px, headings 24px+)
- High contrast (white/bright text on dark bg)
- Minimal UI elements — no expandable cards or detailed analytics
- Large touch targets (minimum 48px hit area)
- No scrolling required for primary actions

**Layout:**
- Top: Session info (who's in the car, session code)
- Center: Chat messages (large, simple bubbles, most recent 5 messages only)
- Bottom: Large text input + microphone button
- When recommendation is shown: Full-screen card with restaurant name, distance, drive time, and a "Navigate" button (links to Google Maps)

**Voice button:** Uses Web Speech API (`window.SpeechRecognition`) for speech-to-text. When clicked:
- Start listening (show pulsing mic icon)
- On result, populate the text input
- Auto-submit after 1.5 seconds of silence

### 4.3 Add Mode Toggle

In `app/components/ChatSession.tsx`:
- Add a toggle in the header: "Standard" | "In-Car Mode"
- When "In-Car Mode" is selected, render `<InCarMode>` instead of the standard split-pane layout
- Pass the same session/state data — only the presentation changes

### 4.4 Location-Aware Features

**In `app/api/recommend/route.ts`:**
- Accept optional `userLocation: { lat: number; lon: number }` parameter
- If provided, calculate drive distance to each candidate restaurant using Haversine formula
- Add distance as a factor in the scoring (closer = slight bonus)
- Sort final candidates by distance as tiebreaker
- Return `distance` field on each candidate

**In the UI:**
- Use `navigator.geolocation.getCurrentPosition()` to get user's location (with permission prompt)
- Pass location to the recommend API
- Display "X km away" and estimated drive time (distance / 40 km/h for urban estimate) on each candidate

### 4.5 Acceptance Criteria

- [ ] Toggle between Standard and In-Car mode
- [ ] In-Car mode has dark theme, large text, simplified layout
- [ ] Voice input works (captures speech, populates input)
- [ ] Recommendations show distance and estimated drive time
- [ ] "Navigate" button opens Google Maps directions
- [ ] UI is usable on a tablet-sized screen (768px width)

---

## Phase 5: Evaluation Dashboard

### 5.1 Goal

Add a page that demonstrates the system works correctly with synthetic and real evaluation scenarios. This is for the final report and demo.

### 5.2 New Route: `app/eval/page.tsx`

A standalone evaluation page (not part of the main chat flow) that shows:

**Section 1: Synthetic Scenario Tests**
- Pre-define 10 test scenarios with known user preferences
- For each: show the expected "best" restaurant and what the system actually recommends
- Show pass/fail and scores

```typescript
// Test scenarios (create in lib/eval-scenarios.ts):
const scenarios: EvalScenario[] = [
  {
    name: "Vegan + BBQ Lover — Competing Hard Constraints",
    users: [
      { name: "Alice", dietary: [{ type: "vegan", strictness: "strict" }], cuisines: ["thai", "indian"] },
      { name: "Bob", cuisines: ["bbq", "steakhouse"], budget: { preferred: "$$" } },
    ],
    expectedBehavior: "Should find a restaurant satisfying vegan hard constraint that also has BBQ-adjacent options",
  },
  {
    name: "All Users Agree — Easy Case",
    users: [
      { name: "A", cuisines: ["italian"] },
      { name: "B", cuisines: ["italian"] },
      { name: "C", cuisines: ["italian"], budget: { preferred: "$$" } },
    ],
    expectedBehavior: "Should recommend an affordable Italian restaurant with high utilitarian score",
  },
  // ... 8 more scenarios covering edge cases:
  // - All hard constraints conflict (no valid restaurant)
  // - Single user (degenerate group case)
  // - 6 users with diverse preferences
  // - Budget extremes ($1 vs $$$$)
  // - Same cuisine, different locations
  // - Allergy safety test
  // - Pareto efficiency verification (dominated option should not be selected)
  // - Nash welfare vs utilitarian: scenario where they differ
];
```

**Section 2: Fairness Metric Distributions**
- Run all 10 scenarios
- Show distributions: average Nash welfare, Gini coefficients, min satisfaction
- Visualize with bar charts (use recharts or simple CSS bars)

**Section 3: Constraint Violation Audit**
- For each scenario, verify zero hard constraint violations
- Show a green/red pass/fail table

### 5.3 Acceptance Criteria

- [ ] `/eval` page loads and runs all scenarios
- [ ] Each scenario shows expected vs actual recommendation
- [ ] Pass/fail indicators for each test
- [ ] Summary statistics at the top
- [ ] No hard constraint violations in any passing scenario

---

## Phase 6: Code Quality & Polish

### 6.1 Error Handling

Add graceful error handling throughout:

**In `app/api/recommend/route.ts`:**
- If all restaurants are filtered out by hard constraints: return a message explaining the conflict and suggesting the group relax some constraints
- If OpenAI API fails: return cached/fallback recommendation or error message
- If session has 0 or 1 users: handle gracefully (fairness metrics don't apply to 1 user)

**In `app/components/ChatSession.tsx`:**
- If API call fails: show inline error message, don't crash
- If localStorage is full: show warning, suggest clearing old sessions

### 6.2 Environment Variables

Ensure `.env.local` is properly documented:
```
OPENAI_API_KEY=sk-...
```

Create `.env.example` with:
```
OPENAI_API_KEY=your-key-here
```

### 6.3 Unit Tests

Create `__tests__/fairness.test.ts`:
- Test `calculateUserSatisfaction` with known inputs
- Test `calculateGroupFairness` returns correct utilitarian/egalitarian/nash/gini values
- Test `filterParetoEfficient` correctly removes dominated options
- Test hard constraint violations correctly zero out scores
- Test Nash welfare selection beats utilitarian in known asymmetric scenario

Create `__tests__/conversation-engine.test.ts`:
- Test critique detection for each type
- Test elicitation question generation for low-confidence profiles
- Test phase transitions

### 6.4 README Update

Update `README.md` to reflect the new session-based architecture:
- How to create/join sessions
- In-car mode usage
- Evaluation page
- Local development setup
- Environment variables

### 6.5 Acceptance Criteria

- [ ] `npm run build` passes with zero errors
- [ ] `npm run lint` passes
- [ ] All unit tests pass
- [ ] README accurately describes current functionality
- [ ] No hardcoded API keys in source
- [ ] Error states don't crash the app

---

## Implementation Order & Dependencies

```
Phase 1 (Session System)         ← DO THIS FIRST, everything depends on it
  ↓
Phase 2 (Conversational Intelligence)  ← Core value-add
  ↓
Phase 3 (Restaurant Q&A)        ← Small, can be done quickly after Phase 2
  ↓
Phase 4 (In-Car Mode)           ← Independent of Phase 2/3, can parallel
  ↓
Phase 5 (Evaluation)            ← Needs Phases 1-3 working
  ↓
Phase 6 (Polish)                ← Final pass
```

## Key Constraints

- **Do NOT change `lib/fairness.ts` core algorithms** — the Nash welfare + Pareto filtering is working correctly and is the intellectual centerpiece of the project
- **Do NOT change `lib/restaurants.json`** — the 356 restaurant dataset is fixed
- **Keep OpenAI API usage efficient** — use local regex extraction first, API only when needed
- **All new components should use Tailwind CSS** — match existing styling patterns
- **TypeScript strict mode** — all new code must be fully typed, no `any` types
- **Preserve the existing `/api/analyze` and `/api/recommend` endpoints** — extend them, don't replace (backward compatibility for testing)
