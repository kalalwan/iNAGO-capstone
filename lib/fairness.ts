/**
 * Mathematical Fairness Scoring System
 *
 * Implements constraint classification, per-user satisfaction scoring,
 * group fairness metrics, and Pareto efficiency filtering.
 *
 * MIE451 Concepts:
 *   - Content-Based Filtering via feature vectors (Module 5.2)
 *   - IDF-weighted scoring for rare constraint amplification (Module 1.10)
 *   - Nash Welfare for group fairness (Module 9)
 *   - Cold-start handling for low-confidence users (Module 5.4)
 */

import {
  Restaurant,
  StructuredUserProfile,
  UserConstraints,
  HardConstraint,
  SoftConstraint,
  UserSatisfactionResult,
  GroupFairnessMetrics,
  FairnessMode,
  FairnessResult,
  ScoredRestaurant,
} from './types';
import { InvertedIndex } from './retrieval/inverted-index';
import {
  buildUserFeatureVector,
  buildRestaurantFeatureVector,
  scoreUserRestaurant,
} from './scoring/feature-vectors';
import {
  isColdStartUser,
  calculateColdStartSatisfaction,
  calculateRobustNashWelfare,
} from './scoring/cold-start';

// ============================================
// Constraint Extraction from Profile
// ============================================

export function extractConstraints(profile: StructuredUserProfile): UserConstraints {
  const hard: HardConstraint[] = [];
  const soft: SoftConstraint[] = [];
  const bonus: { type: 'parking' | 'outdoor' | 'reservation' | 'late-night'; value: boolean }[] = [];

  // Dietary → Hard constraints (strict) or Soft (flexible)
  for (const restriction of profile.dietary.restrictions) {
    if (restriction.strictness === 'strict') {
      hard.push({
        type: 'dietary',
        value: restriction.type,
      });
    } else {
      soft.push({
        type: 'cuisine',
        value: `${restriction.type}-friendly`,
        weight: 3,
      });
    }
  }

  // Allergies → Always hard constraints
  for (const allergy of profile.dietary.allergies) {
    hard.push({
      type: 'allergy',
      value: allergy,
    });
  }

  // Religious dietary → Hard constraint
  if (profile.dietary.religious) {
    hard.push({
      type: 'dietary',
      value: profile.dietary.religious,
    });
  }

  // Cuisine preferences → Soft constraints with varying weights
  for (const pref of profile.cuisinePreferences.favorites.slice(0, 5)) {
    soft.push({
      type: 'cuisine',
      value: pref.cuisine,
      weight: Math.ceil(pref.score / 2), // 1-5 weight from 1-10 score
    });
  }

  // Cuisine dislikes → Negative soft constraints
  for (const dislike of profile.cuisinePreferences.dislikes) {
    soft.push({
      type: 'cuisine',
      value: `not-${dislike}`,
      weight: 3,
    });
  }

  // Budget → Soft constraint
  if (profile.budget.preferred) {
    soft.push({
      type: 'price',
      value: profile.budget.preferred,
      weight: 6 - profile.budget.flexibility, // Higher flexibility = lower weight
    });
  }

  // Location → Soft constraints
  for (const area of profile.location.preferredAreas) {
    soft.push({
      type: 'location',
      value: area,
      weight: 2,
    });
  }

  // Ambiance → Soft constraints
  for (const ambiance of profile.diningStyle.preferredAmbiance) {
    soft.push({
      type: 'ambiance',
      value: ambiance,
      weight: 1,
    });
  }

  return { hard, soft, bonus };
}

// ============================================
// Restaurant Constraint Checking
// ============================================

/**
 * Check if a restaurant satisfies a hard constraint
 */
function restaurantSatisfiesHard(restaurant: Restaurant, constraint: HardConstraint): boolean {
  const tags = restaurant.tags.map(t => t.toLowerCase());
  const cuisine = restaurant.cuisine.toLowerCase();
  const description = restaurant.description.toLowerCase();
  const value = constraint.value.toLowerCase();

  switch (constraint.type) {
    case 'dietary':
      // Check if restaurant has vegan/vegetarian/halal/kosher options
      if (value === 'vegan') {
        return tags.some(t => t.includes('vegan')) ||
               cuisine.includes('vegan') ||
               description.includes('vegan');
      }
      if (value === 'vegetarian') {
        return tags.some(t => t.includes('vegetarian') || t.includes('vegan')) ||
               cuisine.includes('vegetarian') ||
               description.includes('vegetarian');
      }
      if (value === 'halal') {
        return tags.some(t => t.includes('halal')) ||
               description.includes('halal');
      }
      if (value === 'kosher') {
        return tags.some(t => t.includes('kosher')) ||
               description.includes('kosher');
      }
      if (value === 'gluten-free') {
        return tags.some(t => t.includes('gluten')) ||
               description.includes('gluten-free') ||
               description.includes('gluten free');
      }
      return true; // Unknown dietary, assume ok

    case 'allergy':
      // Check if restaurant likely contains allergen
      // For safety, we're conservative - if allergen mentioned, fail
      if (value === 'nut-free' || value === 'peanut') {
        return !tags.some(t => t.includes('nut')) &&
               !description.includes('peanut') &&
               !description.includes('tree nut');
      }
      return true; // Unknown allergen, assume ok

    case 'accessibility':
      // Would need accessibility data in restaurant schema
      return true;

    default:
      return true;
  }
}

/**
 * Calculate soft constraint match score (0-1)
 */
function calculateSoftMatch(restaurant: Restaurant, constraint: SoftConstraint): number {
  const tags = restaurant.tags.map(t => t.toLowerCase());
  const cuisine = restaurant.cuisine.toLowerCase();
  const location = restaurant.location.toLowerCase();
  const value = constraint.value.toLowerCase();

  switch (constraint.type) {
    case 'cuisine':
      // Check for negative constraint
      if (value.startsWith('not-')) {
        const avoid = value.replace('not-', '');
        const hasAvoid = tags.some(t => t.includes(avoid)) || cuisine.includes(avoid);
        return hasAvoid ? 0 : 1;
      }
      // Positive cuisine match
      if (tags.some(t => t.includes(value)) || cuisine.includes(value)) {
        return 1;
      }
      // Partial match for related cuisines
      const cuisineRelations: Record<string, string[]> = {
        'asian': ['chinese', 'japanese', 'thai', 'korean', 'vietnamese', 'sushi'],
        'sushi': ['japanese'],
        'bbq': ['american', 'smokehouse', 'grill'],
        'italian': ['pizza', 'pasta'],
        'mexican': ['latin', 'tacos'],
      };
      for (const [main, related] of Object.entries(cuisineRelations)) {
        if (value === main && related.some(r => cuisine.includes(r) || tags.some(t => t.includes(r)))) {
          return 0.7;
        }
        if (related.includes(value) && (cuisine.includes(main) || tags.some(t => t.includes(main)))) {
          return 0.7;
        }
      }
      return 0;

    case 'price':
      const priceMap: Record<string, number> = { '$': 1, '$$': 2, '$$$': 3, '$$$$': 4 };
      const wantedPrice = priceMap[value] || 2;
      const actualPrice = priceMap[restaurant.price] || 2;
      const priceDiff = Math.abs(wantedPrice - actualPrice);
      return Math.max(0, 1 - priceDiff * 0.3);

    case 'location':
      if (location.includes(value)) {
        return 1;
      }
      // Check for downtown/central preference
      if (value === 'downtown' && (location.includes('core') || location.includes('central'))) {
        return 0.8;
      }
      return 0.2; // Base score for any location

    case 'ambiance':
      // Would need ambiance data in restaurant schema
      // Use price as proxy: $ = casual, $$$$ = upscale
      if (value === 'casual' && restaurant.price === '$') return 0.8;
      if (value === 'upscale' && (restaurant.price === '$$$' || restaurant.price === '$$$$')) return 0.8;
      return 0.5;

    default:
      return 0.5;
  }
}

/**
 * Check if restaurant has a bonus feature
 */
function restaurantHasBonus(restaurant: Restaurant, bonus: { type: string; value: boolean }): boolean {
  const tags = restaurant.tags.map(t => t.toLowerCase());
  const description = restaurant.description.toLowerCase();

  switch (bonus.type) {
    case 'outdoor':
      return tags.some(t => t.includes('patio') || t.includes('outdoor')) ||
             description.includes('patio') || description.includes('outdoor');
    case 'parking':
      return description.includes('parking');
    case 'late-night':
      return tags.some(t => t.includes('late')) || description.includes('late night');
    default:
      return false;
  }
}

// ============================================
// User Satisfaction Calculation
// ============================================

/**
 * Calculate user satisfaction for a restaurant.
 *
 * MIE451 Hybrid Scoring Strategy:
 *   When an inverted index is available, we blend two signals:
 *     1. Feature vector cosine similarity (CBF, Module 5.2)
 *     2. Manual soft-match scoring (constraint-based)
 *
 *   Blend formula:
 *     blendedScore = α × vectorScore + (1 − α) × manualScore
 *     where α = user's overall confidence (0-1)
 *
 *   Rationale: high-confidence users have well-estimated feature vectors,
 *   so we trust the vector score more. Low-confidence users fall back
 *   to the simpler constraint-matching approach.
 *
 * Cold-start users (confidence < 0.3) get popularity-based scoring
 * via the cold-start module instead.
 */
export function calculateUserSatisfaction(
  restaurant: Restaurant,
  profile: StructuredUserProfile,
  index?: InvertedIndex
): UserSatisfactionResult {
  const constraints = extractConstraints(profile);

  // Step 1: Check hard constraints (pass/fail)
  for (const hardConstraint of constraints.hard) {
    if (!restaurantSatisfiesHard(restaurant, hardConstraint)) {
      return {
        userId: profile.id,
        userName: profile.name,
        score: 0,
        satisfied: false,
        breakdown: {
          hardConstraintsMet: false,
          hardFailure: hardConstraint,
          softScores: {},
          bonusScore: 0,
        },
      };
    }
  }

  // Step 2: Cold-start check — use popularity-based scoring
  if (isColdStartUser(profile)) {
    const coldScore = calculateColdStartSatisfaction(restaurant, profile);
    return {
      userId: profile.id,
      userName: profile.name,
      score: coldScore,
      satisfied: true,
      breakdown: {
        hardConstraintsMet: true,
        softScores: { 'cold-start:popularity': coldScore },
        bonusScore: 0,
      },
    };
  }

  // Step 3: Calculate manual soft constraint scores (always computed)
  let softScore = 0;
  let maxSoftScore = 0;
  const softScores: Record<string, number> = {};

  for (const softConstraint of constraints.soft) {
    const match = calculateSoftMatch(restaurant, softConstraint);
    const weightedMatch = match * softConstraint.weight;
    softScore += weightedMatch;
    maxSoftScore += softConstraint.weight;
    softScores[`${softConstraint.type}:${softConstraint.value}`] = match;
  }

  // Step 4: Calculate bonus points
  let bonusScore = 0;
  for (const bonus of constraints.bonus) {
    if (restaurantHasBonus(restaurant, bonus)) {
      bonusScore += 0.1;
    }
  }

  // Step 5: Compute final score
  const manualBase = maxSoftScore > 0 ? softScore / maxSoftScore : 0.5;
  const manualScore = Math.min(1, manualBase * 0.9 + bonusScore + 0.1);

  let finalScore: number;

  if (index) {
    // Feature vector scoring (CBF)
    const userVec = buildUserFeatureVector(profile, index);
    const restVec = buildRestaurantFeatureVector(restaurant, index);
    const vectorScore = scoreUserRestaurant(userVec, restVec);
    softScores['cbf:vectorSimilarity'] = vectorScore;

    // Blend: α = confidence, higher confidence → trust vectors more
    const alpha = profile.confidence.overall;
    finalScore = alpha * vectorScore + (1 - alpha) * manualScore;
  } else {
    finalScore = manualScore;
  }

  return {
    userId: profile.id,
    userName: profile.name,
    score: finalScore,
    satisfied: true,
    breakdown: {
      hardConstraintsMet: true,
      softScores,
      bonusScore,
    },
  };
}

// ============================================
// Group Fairness Metrics
// ============================================

/**
 * Calculate group fairness metrics for a restaurant across all user profiles.
 *
 * MIE451 Enhancements:
 *   - Feature vector scoring when index is available (Module 5.2)
 *   - Cold-start-aware robust Nash welfare (Module 5.4)
 *   - Standard utilitarian, egalitarian, Nash, and Gini metrics
 */
export function calculateGroupFairness(
  restaurant: Restaurant,
  profiles: StructuredUserProfile[],
  index?: InvertedIndex
): { metrics: GroupFairnessMetrics; userSatisfaction: UserSatisfactionResult[] } {
  const userSatisfaction = profiles.map(p => calculateUserSatisfaction(restaurant, p, index));
  const scores = userSatisfaction.map(u => u.score);

  // Check if any hard constraints failed
  const allSatisfied = userSatisfaction.every(u => u.satisfied);
  if (!allSatisfied) {
    return {
      metrics: {
        utilitarian: 0,
        egalitarian: 0,
        nash: 0,
        gini: 1,
      },
      userSatisfaction,
    };
  }

  const n = scores.length;
  const sum = scores.reduce((a, b) => a + b, 0);
  const min = Math.min(...scores);

  // Gini coefficient calculation
  let giniNumerator = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      giniNumerator += Math.abs(scores[i] - scores[j]);
    }
  }
  const gini = sum > 0 ? giniNumerator / (2 * n * sum) : 0;

  // Nash welfare: use robust version that handles cold-start users
  const satisfactionEntries = profiles.map((p, i) => ({
    userId: p.id,
    score: scores[i],
    isCold: isColdStartUser(p),
  }));
  const nashWelfare = calculateRobustNashWelfare(satisfactionEntries);

  return {
    metrics: {
      utilitarian: sum / n,
      egalitarian: min,
      nash: nashWelfare,
      gini,
    },
    userSatisfaction,
  };
}

// ============================================
// Pareto Efficiency Filter
// ============================================

interface ScoredCandidate {
  restaurant: Restaurant;
  metrics: GroupFairnessMetrics;
  userSatisfaction: UserSatisfactionResult[];
  vectorScore: number;
}

export function filterParetoEfficient(candidates: ScoredCandidate[]): ScoredCandidate[] {
  return candidates.filter(candidate => {
    // A restaurant is Pareto efficient if no other restaurant
    // makes everyone at least as happy AND someone strictly happier
    return !candidates.some(other => {
      if (other === candidate) return false;

      const candidateScores = candidate.userSatisfaction.map(u => u.score);
      const otherScores = other.userSatisfaction.map(u => u.score);

      const allAtLeastAsGood = otherScores.every((s, i) => s >= candidateScores[i]);
      const someBetter = otherScores.some((s, i) => s > candidateScores[i]);

      return allAtLeastAsGood && someBetter;
    });
  });
}

// ============================================
// Final Selection Algorithm
// ============================================

/**
 * Select the best restaurant using strict Pareto filtering + Nash Welfare.
 *
 * Algorithm:
 * 1. Filter out any restaurant that violates a hard constraint (satisfaction = 0)
 * 2. Apply Pareto efficiency filter to remove dominated options
 * 3. Among Pareto-efficient options, select the one with highest Nash Welfare
 *
 * Nash Welfare = (∏ u_i)^(1/n) = geometric mean of user satisfactions
 *
 * This approach ensures:
 * - No dominated options are selected (Pareto efficiency)
 * - Balanced satisfaction across users (Nash favors equality over pure average)
 * - A user with 0% satisfaction makes Nash = 0, preventing unfair outcomes
 */
export function selectBestRestaurant(
  candidates: ScoredRestaurant[],
  profiles: StructuredUserProfile[],
  _mode: FairnessMode = 'balanced', // Mode parameter kept for API compatibility but ignored
  index?: InvertedIndex
): FairnessResult {
  // Step 1: Calculate fairness metrics for all candidates
  const scored: ScoredCandidate[] = candidates.map(r => {
    const { metrics, userSatisfaction } = calculateGroupFairness(r, profiles, index);
    return {
      restaurant: r,
      metrics,
      userSatisfaction,
      vectorScore: r.score,
    };
  });

  // Step 2: Filter out restaurants that violate any hard constraint
  // (These have metrics.nash = 0 because at least one user has score = 0)
  const feasible = scored.filter(c =>
    c.userSatisfaction.every(u => u.satisfied)
  );

  // If no feasible options, return the best from original set with explanation
  if (feasible.length === 0) {
    const best = scored.reduce((a, b) =>
      a.metrics.utilitarian > b.metrics.utilitarian ? a : b
    );
    return {
      restaurant: best.restaurant,
      metrics: best.metrics,
      userSatisfaction: best.userSatisfaction,
      explanation: generateFairnessExplanation(best, profiles, true),
      isParetoEfficient: false,
    };
  }

  // Step 3: Apply strict Pareto efficiency filter
  const paretoEfficient = filterParetoEfficient(feasible);

  // If Pareto filter returns empty (shouldn't happen), fall back to feasible
  const searchSet = paretoEfficient.length > 0 ? paretoEfficient : feasible;

  // Step 4: Select by maximum Nash Welfare among Pareto-efficient options
  // Nash Welfare = geometric mean = (∏ u_i)^(1/n)
  // This naturally balances efficiency and equity
  const selected = searchSet.reduce((best, curr) => {
    // Use Nash welfare as primary criterion
    if (curr.metrics.nash > best.metrics.nash) {
      return curr;
    }
    // Tie-breaker: if Nash is equal, prefer higher minimum (egalitarian)
    if (curr.metrics.nash === best.metrics.nash &&
        curr.metrics.egalitarian > best.metrics.egalitarian) {
      return curr;
    }
    // Second tie-breaker: prefer higher vector similarity score
    if (curr.metrics.nash === best.metrics.nash &&
        curr.metrics.egalitarian === best.metrics.egalitarian &&
        curr.vectorScore > best.vectorScore) {
      return curr;
    }
    return best;
  });

  // Generate explanation
  const explanation = generateFairnessExplanation(selected, profiles, false);

  return {
    restaurant: selected.restaurant,
    metrics: selected.metrics,
    userSatisfaction: selected.userSatisfaction,
    explanation,
    isParetoEfficient: paretoEfficient.includes(selected),
  };
}

// ============================================
// Explanation Generation
// ============================================

function generateFairnessExplanation(
  selected: ScoredCandidate,
  profiles: StructuredUserProfile[],
  hasConstraintViolation: boolean
): string {
  const { restaurant, metrics, userSatisfaction } = selected;

  const lines: string[] = [];

  // Header
  lines.push(`**${restaurant.name}** (${restaurant.cuisine})`);
  lines.push(`${restaurant.address}`);
  lines.push('');

  // Fairness summary
  const nashWelfare = (metrics.nash * 100).toFixed(0);
  const avgSatisfaction = (metrics.utilitarian * 100).toFixed(0);
  const minSatisfaction = (metrics.egalitarian * 100).toFixed(0);
  const inequality = (metrics.gini * 100).toFixed(0);

  lines.push(`**Fairness Scores:**`);
  lines.push(`- Nash Welfare: ${nashWelfare}% (selection criterion)`);
  lines.push(`- Average satisfaction: ${avgSatisfaction}%`);
  lines.push(`- Minimum satisfaction: ${minSatisfaction}% (no one below this)`);
  lines.push(`- Inequality index: ${inequality}% (lower is better)`);
  lines.push('');

  // Per-user breakdown
  lines.push(`**Per-Person Satisfaction:**`);
  for (const sat of userSatisfaction) {
    const score = (sat.score * 100).toFixed(0);
    const status = sat.satisfied ? '' : ' (CONSTRAINT VIOLATED)';
    lines.push(`- ${sat.userName}: ${score}%${status}`);
  }
  lines.push('');

  // Selection explanation
  if (hasConstraintViolation) {
    lines.push('**Note:** No restaurant satisfies all hard constraints. Showing best available option.');
  } else {
    lines.push('Selected via Pareto filtering + Nash Welfare maximization.');
    lines.push('Nash Welfare = geometric mean of satisfaction scores.');
  }

  return lines.join('\n');
}

// ============================================
// Utility: Create Empty Profile
// ============================================

export function createEmptyProfile(id: string, name: string, color: string): StructuredUserProfile {
  return {
    id,
    name,
    color,
    dietary: {
      restrictions: [],
      allergies: [],
      religious: null,
      medicalConditions: [],
    },
    cuisinePreferences: {
      favorites: [],
      dislikes: [],
      adventurousness: 3,
    },
    budget: {
      preferred: null,
      maxAcceptable: null,
      flexibility: 3,
    },
    location: {
      preferredAreas: [],
      maxDistance: 10,
      hasTransportation: true,
    },
    diningStyle: {
      preferredAmbiance: [],
      groupSizePreference: null,
      timePreference: 'any',
    },
    history: {
      visitedRestaurants: [],
      ratings: {},
      lastUpdated: Date.now(),
      totalInteractions: 0,
    },
    confidence: {
      dietary: 0,
      cuisine: 0,
      budget: 0,
      location: 0,
      overall: 0,
    },
  };
}
