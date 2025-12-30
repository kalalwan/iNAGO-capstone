/**
 * Mathematical Fairness Scoring System
 *
 * Implements constraint classification, per-user satisfaction scoring,
 * group fairness metrics, and Pareto efficiency filtering.
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

export function calculateUserSatisfaction(
  restaurant: Restaurant,
  profile: StructuredUserProfile
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

  // Step 2: Calculate soft constraint scores
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

  // Step 3: Calculate bonus points
  let bonusScore = 0;
  for (const bonus of constraints.bonus) {
    if (restaurantHasBonus(restaurant, bonus)) {
      bonusScore += 0.1;
    }
  }

  // Final score: normalized to 0-1
  const baseScore = maxSoftScore > 0 ? softScore / maxSoftScore : 0.5;
  const finalScore = Math.min(1, baseScore * 0.9 + bonusScore + 0.1); // Base 0.1 for passing hard constraints

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

export function calculateGroupFairness(
  restaurant: Restaurant,
  profiles: StructuredUserProfile[]
): { metrics: GroupFairnessMetrics; userSatisfaction: UserSatisfactionResult[] } {
  const userSatisfaction = profiles.map(p => calculateUserSatisfaction(restaurant, p));
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
  const product = scores.reduce((a, b) => a * b, 1);

  // Gini coefficient calculation
  let giniNumerator = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      giniNumerator += Math.abs(scores[i] - scores[j]);
    }
  }
  const gini = sum > 0 ? giniNumerator / (2 * n * sum) : 0;

  return {
    metrics: {
      utilitarian: sum / n,
      egalitarian: min,
      nash: Math.pow(product, 1 / n),
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

export function selectBestRestaurant(
  candidates: ScoredRestaurant[],
  profiles: StructuredUserProfile[],
  mode: FairnessMode = 'balanced'
): FairnessResult {
  // Calculate fairness for all candidates
  const scored: ScoredCandidate[] = candidates.map(r => {
    const { metrics, userSatisfaction } = calculateGroupFairness(r, profiles);
    return {
      restaurant: r,
      metrics,
      userSatisfaction,
      vectorScore: r.score,
    };
  });

  // Filter to Pareto-efficient options
  const paretoEfficient = filterParetoEfficient(scored);
  const searchSet = paretoEfficient.length > 0 ? paretoEfficient : scored;

  // Select based on fairness mode
  let selected: ScoredCandidate;
  switch (mode) {
    case 'utilitarian':
      selected = searchSet.reduce((best, curr) =>
        curr.metrics.utilitarian > best.metrics.utilitarian ? curr : best
      );
      break;
    case 'egalitarian':
      selected = searchSet.reduce((best, curr) =>
        curr.metrics.egalitarian > best.metrics.egalitarian ? curr : best
      );
      break;
    case 'balanced':
    default:
      // Weighted combination prioritizing egalitarian
      selected = searchSet.reduce((best, curr) => {
        const bestScore =
          0.3 * best.metrics.utilitarian +
          0.5 * best.metrics.egalitarian +
          0.2 * (1 - best.metrics.gini);
        const currScore =
          0.3 * curr.metrics.utilitarian +
          0.5 * curr.metrics.egalitarian +
          0.2 * (1 - curr.metrics.gini);
        return currScore > bestScore ? curr : best;
      });
      break;
  }

  // Generate explanation
  const explanation = generateFairnessExplanation(selected, profiles, mode);

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
  mode: FairnessMode
): string {
  const { restaurant, metrics, userSatisfaction } = selected;

  const lines: string[] = [];

  // Header
  lines.push(`**${restaurant.name}** (${restaurant.cuisine})`);
  lines.push(`${restaurant.address}`);
  lines.push('');

  // Fairness summary
  const avgSatisfaction = (metrics.utilitarian * 100).toFixed(0);
  const minSatisfaction = (metrics.egalitarian * 100).toFixed(0);
  const inequality = (metrics.gini * 100).toFixed(0);

  lines.push(`**Fairness Scores:**`);
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

  // Mode explanation
  const modeExplanations: Record<FairnessMode, string> = {
    utilitarian: 'This selection maximizes total group happiness.',
    egalitarian: 'This selection ensures no one is left too unhappy.',
    balanced: 'This selection balances overall happiness with fairness.',
  };
  lines.push(modeExplanations[mode]);

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
