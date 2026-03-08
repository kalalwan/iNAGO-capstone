/**
 * Popularity Baseline for Recommendation
 *
 * MIE451 Module 10: Start Simple, Always Have Baselines
 *
 * "Simple market segmentation + popularity within segments is often
 *  hard to beat. Always compare to popularity baselines."
 *
 * This module provides a trivial recommendation strategy:
 * sort by popularity, filter by hard constraints. Used for:
 *   1. Comparison in evaluation metrics
 *   2. Fallback when embeddings/API fail
 *   3. Cold-start handling
 */

import { Restaurant, StructuredUserProfile, ScoredRestaurant } from '../types';
import { extractConstraints } from '../fairness';

// ============================================
// Popularity Scoring
// ============================================

/**
 * Popularity score = rating × log₁₀(reviewCount + 1)
 *
 * Balances quality (rating) with evidence (review count).
 * The log dampens review count so a 4.5★ with 100 reviews
 * can still beat a 4.0★ with 1000 reviews.
 *
 * Examples:
 *   4.5★, 1000 reviews → 4.5 × log₁₀(1001) = 4.5 × 3.00 = 13.50
 *   4.0★,  100 reviews → 4.0 × log₁₀(101)  = 4.0 × 2.00 = 8.02
 *   5.0★,   10 reviews → 5.0 × log₁₀(11)   = 5.0 × 1.04 = 5.21
 */
export function calculatePopularityScore(restaurant: Restaurant): number {
  return restaurant.rating * Math.log10(restaurant.reviewCount + 1);
}

// ============================================
// Hard Constraint Checker (lightweight)
// ============================================

/**
 * Quick check if a restaurant passes all hard constraints from all profiles.
 * Uses tag/cuisine/description keyword matching (same logic as fairness.ts).
 */
function passesAllHardConstraints(
  restaurant: Restaurant,
  profiles: StructuredUserProfile[]
): boolean {
  const tags = restaurant.tags.map(t => t.toLowerCase());
  const cuisine = restaurant.cuisine.toLowerCase();
  const desc = restaurant.description.toLowerCase();

  for (const profile of profiles) {
    const constraints = extractConstraints(profile);

    for (const hard of constraints.hard) {
      const value = hard.value.toLowerCase();

      if (hard.type === 'dietary') {
        const found =
          tags.some(t => t.includes(value)) ||
          cuisine.includes(value) ||
          desc.includes(value);

        // For vegetarian, also accept vegan restaurants
        if (!found && value !== 'vegetarian') return false;
        if (!found && value === 'vegetarian') {
          const veganOk =
            tags.some(t => t.includes('vegan')) ||
            cuisine.includes('vegan') ||
            desc.includes('vegan');
          if (!veganOk) return false;
        }
      }

      if (hard.type === 'allergy') {
        if (value === 'peanut' || value === 'nut-free') {
          const hasNut =
            tags.some(t => t.includes('nut') || t.includes('peanut')) ||
            desc.includes('peanut') ||
            desc.includes('tree nut');
          if (hasNut) return false;
        }
      }
    }
  }

  return true;
}

// ============================================
// Popularity Baseline
// ============================================

/**
 * Get popularity baseline recommendation.
 *
 * Algorithm:
 * 1. AND all hard constraints from all profiles
 * 2. Filter restaurants satisfying all constraints
 * 3. Sort by popularity score descending
 * 4. Return top K
 *
 * This is intentionally simple — it ignores all soft preferences,
 * cuisine preferences, budget alignment, etc.
 */
export function getPopularityBaseline(
  restaurants: Restaurant[],
  profiles: StructuredUserProfile[],
  topK: number = 5
): ScoredRestaurant[] {
  // Filter by hard constraints
  const feasible = restaurants.filter(r => passesAllHardConstraints(r, profiles));

  // Score and sort by popularity
  const scored: ScoredRestaurant[] = feasible.map(r => ({
    ...r,
    score: calculatePopularityScore(r),
  }));

  scored.sort((a, b) => b.score - a.score);

  // Normalize scores to [0, 1] relative to the best
  const maxScore = scored[0]?.score || 1;
  for (const s of scored) {
    s.score = s.score / maxScore;
  }

  return scored.slice(0, topK);
}

/**
 * Random baseline for statistical comparison floor.
 *
 * Returns K random restaurants that satisfy hard constraints.
 * Average over multiple runs gives the "chance" performance.
 */
export function getRandomBaseline(
  restaurants: Restaurant[],
  profiles: StructuredUserProfile[],
  topK: number = 5
): ScoredRestaurant[] {
  const feasible = restaurants.filter(r => passesAllHardConstraints(r, profiles));

  // Fisher-Yates shuffle
  const shuffled = [...feasible];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled.slice(0, topK).map(r => ({
    ...r,
    score: calculatePopularityScore(r) / 15, // Rough normalization
  }));
}
