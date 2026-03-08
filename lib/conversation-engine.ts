/**
 * Conversation Engine
 *
 * Manages conversation state, generates system responses,
 * handles elicitation questions, critiques, and trade-off explanations.
 */

import {
  SessionUser,
  SessionMessage,
  StructuredUserProfile,
  FairnessResult,
  ScoredRestaurant,
  Restaurant,
} from './types';
import { detectQuestion, answerQuestion } from './restaurant-qa';

// ============================================
// Types
// ============================================

export type ConversationPhase =
  | 'greeting'
  | 'elicitation'
  | 'clarification'
  | 'ready'
  | 'recommendation'
  | 'critique'
  | 'comparison';

export interface ConversationState {
  phase: ConversationPhase;
  turnCount: number;
  usersWithLowConfidence: string[];
  pendingQuestions: ElicitationQuestion[];
  lastRecommendation: {
    candidates: ScoredRestaurant[];
    recommendation: string;
    fairnessResult: FairnessResult;
  } | null;
  critiques: CritiqueRecord[];
  greetedUsers: Set<string>;
  hasGreeted: boolean;
}

export interface ElicitationQuestion {
  targetUserId: string;
  targetUserName: string;
  question: string;
  category: 'dietary' | 'cuisine' | 'budget' | 'location' | 'ambiance';
  priority: number;
}

export interface CritiqueRecord {
  userId: string;
  userName: string;
  message: string;
  type: 'too_expensive' | 'wrong_cuisine' | 'too_far' | 'dietary_concern' | 'general_dislike';
  constraintUpdate: Partial<{
    budget: { preferred: '$' | '$$' | '$$$' | '$$$$' };
    cuisineDislikes: string[];
    maxDistance: number;
    dietary: { type: string; strictness: 'strict' };
  }>;
}

// ============================================
// Initialization
// ============================================

export function initConversation(users: SessionUser[]): ConversationState {
  const lowConfidence = users
    .filter(u => u.profile.confidence.overall < 0.5)
    .map(u => u.id);

  return {
    phase: 'greeting',
    turnCount: 0,
    usersWithLowConfidence: lowConfidence,
    pendingQuestions: [],
    lastRecommendation: null,
    critiques: [],
    greetedUsers: new Set(),
    hasGreeted: false,
  };
}

// ============================================
// Serialization helpers (Set is not JSON-serializable)
// ============================================

export function serializeConversationState(state: ConversationState): string {
  return JSON.stringify({
    ...state,
    greetedUsers: Array.from(state.greetedUsers),
  });
}

export function deserializeConversationState(json: string): ConversationState {
  const parsed = JSON.parse(json);
  return {
    ...parsed,
    greetedUsers: new Set(parsed.greetedUsers || []),
  };
}

// ============================================
// Main Message Processing
// ============================================

export function processMessage(
  state: ConversationState,
  message: SessionMessage,
  users: SessionUser[],
  restaurants?: Restaurant[],
): { updatedState: ConversationState; systemResponse: string | null } {
  const updatedState = { ...state };
  updatedState.turnCount += 1;

  // Check if message is a question about restaurants (before other processing)
  if (message.content && restaurants && detectQuestion(message.content)) {
    const recentRec = updatedState.lastRecommendation ? {
      candidates: updatedState.lastRecommendation.candidates,
      recommendation: updatedState.lastRecommendation.recommendation,
      fairnessResult: updatedState.lastRecommendation.fairnessResult,
    } : null;
    const answer = answerQuestion(message.content, restaurants, recentRec);
    if (answer) {
      return { updatedState, systemResponse: answer };
    }
  }

  // Phase: Greeting
  if (updatedState.phase === 'greeting' && !updatedState.hasGreeted) {
    updatedState.hasGreeted = true;
    updatedState.phase = 'elicitation';

    const names = users.map(u => u.name);
    const greeting = names.length === 1
      ? `Welcome, ${names[0]}! Tell me about what you're in the mood to eat today. Any dietary restrictions, cuisine preferences, or budget in mind?`
      : `Welcome ${formatNames(names)}! Let's find the perfect restaurant for your group. Tell me about your food preferences, dietary needs, and budget. Everyone can chime in!`;

    return { updatedState, systemResponse: greeting };
  }

  // Check for critique (post-recommendation)
  if (updatedState.phase === 'recommendation' || updatedState.phase === 'critique') {
    const critique = detectCritique(message.content);
    if (critique.isCritique && critique.type) {
      const user = users.find(u => u.id === message.userId);
      if (user) {
        const critiqueRecord: CritiqueRecord = {
          userId: message.userId,
          userName: user.name,
          message: message.content,
          type: critique.type,
          constraintUpdate: getCritiqueConstraintUpdate(critique.type),
        };
        updatedState.critiques.push(critiqueRecord);
        updatedState.phase = 'critique';

        const response = generateCritiqueResponse(critiqueRecord);
        return { updatedState, systemResponse: response };
      }
    }
  }

  // Phase: Elicitation — check if we should ask more questions
  if (updatedState.phase === 'elicitation' || updatedState.phase === 'clarification') {
    // Refresh low confidence users
    updatedState.usersWithLowConfidence = users
      .filter(u => u.profile.confidence.overall < 0.5)
      .map(u => u.id);

    // If all users have decent confidence, transition to ready
    if (updatedState.usersWithLowConfidence.length === 0) {
      updatedState.phase = 'ready';
      return {
        updatedState,
        systemResponse: "I have a good sense of what everyone wants. Ready to find your restaurant! The host can hit 'Generate Fair Recommendation' whenever you're ready.",
      };
    }

    // Every 3 turns, proactively ask a question if needed
    if (updatedState.turnCount % 3 === 0 && updatedState.usersWithLowConfidence.length > 0) {
      const questions = generateElicitationQuestions(users);
      if (questions.length > 0) {
        updatedState.pendingQuestions = questions;
        return {
          updatedState,
          systemResponse: questions[0].question,
        };
      }
    }
  }

  return { updatedState, systemResponse: null };
}

// ============================================
// Elicitation Question Generation
// ============================================

export function generateElicitationQuestions(users: SessionUser[]): ElicitationQuestion[] {
  const questions: ElicitationQuestion[] = [];

  for (const user of users) {
    const profile = user.profile;
    const conf = profile.confidence;

    if (conf.cuisine < 0.3) {
      questions.push({
        targetUserId: user.id,
        targetUserName: user.name,
        question: `Hey ${user.name}, what type of food are you in the mood for today? Any favorite cuisines?`,
        category: 'cuisine',
        priority: 10 - conf.cuisine * 10,
      });
    }

    if (conf.dietary < 0.3) {
      questions.push({
        targetUserId: user.id,
        targetUserName: user.name,
        question: `${user.name}, do you have any dietary restrictions or food allergies we should know about?`,
        category: 'dietary',
        priority: 9 - conf.dietary * 10,
      });
    }

    if (conf.budget < 0.3) {
      questions.push({
        targetUserId: user.id,
        targetUserName: user.name,
        question: `${user.name}, what's your budget range for this meal? Casual and affordable, or are we treating ourselves?`,
        category: 'budget',
        priority: 7 - conf.budget * 10,
      });
    }

    if (conf.location < 0.3) {
      questions.push({
        targetUserId: user.id,
        targetUserName: user.name,
        question: `${user.name}, any preference for which part of the city? Downtown, or open to anywhere?`,
        category: 'location',
        priority: 5 - conf.location * 10,
      });
    }
  }

  return questions.sort((a, b) => b.priority - a.priority);
}

// ============================================
// Critique Detection
// ============================================

export function detectCritique(
  message: string
): { isCritique: boolean; type: CritiqueRecord['type'] | null } {
  const lower = message.toLowerCase();

  // Too expensive
  if (/\b(too expensive|too pricey|can't afford|over budget|too much money|too costly|out of.*budget)\b/.test(lower)) {
    return { isCritique: true, type: 'too_expensive' };
  }

  // Wrong cuisine
  if (/\b(don't like|not in the mood|hate that|not into|don't want|sick of|tired of)\b/.test(lower)) {
    return { isCritique: true, type: 'wrong_cuisine' };
  }

  // Too far
  if (/\b(too far|don't want to drive|too much driving|takes too long|not close enough)\b/.test(lower)) {
    return { isCritique: true, type: 'too_far' };
  }

  // Dietary concern
  if (/\b(can't eat there|not safe|dietary|allergic|allergy|intolerant)\b/.test(lower)) {
    return { isCritique: true, type: 'dietary_concern' };
  }

  // General dislike
  if (/\b(no thanks|not that one|try again|something else|different|nah|nope|pass)\b/.test(lower)) {
    return { isCritique: true, type: 'general_dislike' };
  }

  return { isCritique: false, type: null };
}

// ============================================
// Critique Handling
// ============================================

export function handleCritique(
  critique: CritiqueRecord,
  currentProfile: StructuredUserProfile
): StructuredUserProfile {
  const updated = JSON.parse(JSON.stringify(currentProfile)) as StructuredUserProfile;

  switch (critique.type) {
    case 'too_expensive': {
      const priceOrder: ('$' | '$$' | '$$$' | '$$$$')[] = ['$', '$$', '$$$', '$$$$'];
      const currentIdx = priceOrder.indexOf(updated.budget.preferred || '$$');
      if (currentIdx > 0) {
        updated.budget.preferred = priceOrder[currentIdx - 1];
      } else {
        updated.budget.preferred = '$';
      }
      updated.budget.flexibility = Math.max(1, updated.budget.flexibility - 1);
      updated.confidence.budget = Math.min(1, updated.confidence.budget + 0.2);
      break;
    }
    case 'wrong_cuisine': {
      // Extract cuisine from critique message if possible
      const cuisineMatch = critique.message.match(/\b(?:don't like|not into|hate|sick of|tired of)\s+(\w+)/i);
      if (cuisineMatch) {
        const disliked = cuisineMatch[1].toLowerCase();
        if (!updated.cuisinePreferences.dislikes.includes(disliked)) {
          updated.cuisinePreferences.dislikes.push(disliked);
        }
      }
      updated.confidence.cuisine = Math.min(1, updated.confidence.cuisine + 0.1);
      break;
    }
    case 'too_far': {
      updated.location.maxDistance = Math.max(2, updated.location.maxDistance - 3);
      updated.confidence.location = Math.min(1, updated.confidence.location + 0.15);
      break;
    }
    case 'dietary_concern': {
      // Mark as needing re-check — the preference extraction will handle details
      updated.confidence.dietary = Math.min(1, updated.confidence.dietary + 0.1);
      break;
    }
    case 'general_dislike': {
      // No specific constraint update; re-recommendation will explore other options
      break;
    }
  }

  updated.history.lastUpdated = Date.now();
  updated.confidence.overall =
    (updated.confidence.dietary +
      updated.confidence.cuisine +
      updated.confidence.budget +
      updated.confidence.location) / 4;

  return updated;
}

function getCritiqueConstraintUpdate(type: CritiqueRecord['type']): CritiqueRecord['constraintUpdate'] {
  switch (type) {
    case 'too_expensive':
      return { budget: { preferred: '$' } };
    case 'wrong_cuisine':
      return { cuisineDislikes: [] };
    case 'too_far':
      return { maxDistance: 5 };
    case 'dietary_concern':
      return {};
    case 'general_dislike':
      return {};
  }
}

function generateCritiqueResponse(critique: CritiqueRecord): string {
  switch (critique.type) {
    case 'too_expensive':
      return `Got it, ${critique.userName} — that's too pricey. Let me find something more affordable for the group. Hit 'Generate' again when you're ready!`;
    case 'wrong_cuisine':
      return `Noted, ${critique.userName} — I'll avoid that type of food. Let me look for better options. Feel free to generate a new recommendation!`;
    case 'too_far':
      return `Understood, ${critique.userName} — that's too far. I'll look for places closer to you. Try generating again!`;
    case 'dietary_concern':
      return `Safety first, ${critique.userName}! I'll make sure the next recommendation works for your dietary needs. Generate again when ready!`;
    case 'general_dislike':
      return `No problem, ${critique.userName} — let's find something else! Generate a new recommendation to see more options.`;
  }
}

// ============================================
// Trade-Off & Comparison Summaries
// ============================================

export function generateTradeOffSummary(
  fairnessResult: FairnessResult,
  _users: SessionUser[]
): string | null {
  if (fairnessResult.metrics.gini <= 0.3) return null;

  const satisfaction = fairnessResult.userSatisfaction;
  const highest = satisfaction.reduce((a, b) => a.score > b.score ? a : b);
  const lowest = satisfaction.reduce((a, b) => a.score < b.score ? a : b);

  return `I notice ${highest.userName} would really enjoy this choice (${(highest.score * 100).toFixed(0)}% satisfaction) but ${lowest.userName} is less excited (${(lowest.score * 100).toFixed(0)}%). Would you like to see alternatives that are more balanced, even if no one's score is quite as high?`;
}

export function generateComparisonSummary(
  candidates: ScoredRestaurant[],
  _users: SessionUser[]
): string {
  const top3 = candidates.slice(0, 3);
  const lines: string[] = [];

  top3.forEach((candidate, idx) => {
    const name = candidate.name;
    const sats = candidate.userSatisfaction || [];

    if (sats.length === 0) {
      lines.push(`Option ${idx + 1} (${name}): ${(candidate.score * 100).toFixed(0)}% match`);
      return;
    }

    const best = sats.reduce((a, b) => a.score > b.score ? a : b);
    const worst = sats.reduce((a, b) => a.score < b.score ? a : b);
    const nash = candidate.fairnessMetrics?.nash || 0;

    if (idx === 0) {
      lines.push(`Option 1 (${name}): Best overall — Nash welfare ${(nash * 100).toFixed(0)}%. Best for ${best.userName} (${(best.score * 100).toFixed(0)}%), lowest for ${worst.userName} (${(worst.score * 100).toFixed(0)}%)`);
    } else {
      lines.push(`Option ${idx + 1} (${name}): Nash welfare ${(nash * 100).toFixed(0)}%. Best for ${best.userName} (${(best.score * 100).toFixed(0)}%), lowest for ${worst.userName} (${(worst.score * 100).toFixed(0)}%)`);
    }
  });

  return lines.join('\n');
}

// ============================================
// Readiness Check
// ============================================

export function getReadinessStatus(users: SessionUser[]): {
  ready: boolean;
  message: string;
  lowConfidenceNames: string[];
} {
  const lowConfidence = users.filter(u => u.profile.confidence.overall < 0.5);

  if (lowConfidence.length === 0) {
    return {
      ready: true,
      message: "I have a good sense of what everyone wants. Ready to find your restaurant!",
      lowConfidenceNames: [],
    };
  }

  const names = lowConfidence.map(u => u.name);
  return {
    ready: false,
    message: `Still learning about ${formatNames(names)} — keep chatting or I can ask some questions`,
    lowConfidenceNames: names,
  };
}

// ============================================
// Helpers
// ============================================

function formatNames(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}
