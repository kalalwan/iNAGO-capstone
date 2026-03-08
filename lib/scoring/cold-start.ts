/**
 * Cold-Start Handling
 *
 * MIE451 Concept: Cold-Start Problem in Recommender Systems (Module 5.4/5.8)
 *
 * When a user has very low confidence scores, their preferences are
 * essentially unknown. This module provides:
 *   1. Detection of cold-start users
 *   2. Popularity-based satisfaction for unknown users
 *   3. Robust Nash Welfare that doesn't let unknowns dominate
 */

import { Restaurant, StructuredUserProfile } from '../types';
import { calculatePopularityScore } from '../baselines/popularity-baseline';

// ============================================
// Constants
// ============================================

/** Users with overall confidence below this are "cold" */
export const COLD_START_THRESHOLD = 0.3;

// ============================================
// Detection
// ============================================

/**
 * Check if a user is in cold-start state.
 */
export function isColdStartUser(profile: StructuredUserProfile): boolean {
  return profile.confidence.overall < COLD_START_THRESHOLD;
}

// ============================================
// Cold-Start Satisfaction
// ============================================

/**
 * Calculate satisfaction for a cold-start user.
 *
 * Strategy:
 * - Use popularity as the primary signal (higher-rated = more likely to satisfy)
 * - Apply a "neutrality" adjustment to prevent extreme scores
 * - Cold users should never score below 0.35 or above 0.65
 *
 * Formula:
 *   popNorm = popularity / maxPopularity  (normalized to [0, 1])
 *   coldScore = 0.5 + 0.3 × (popNorm − 0.5)
 *
 * This maps popularity [0, 1] → satisfaction [0.35, 0.65]
 *
 * Rationale: We don't know what the user wants, so we assume
 * popular restaurants are moderately satisfying. The narrow range
 * prevents cold users from having extreme influence on Nash Welfare.
 */
export function calculateColdStartSatisfaction(
  restaurant: Restaurant,
  _profile: StructuredUserProfile,
  maxPopularity: number = 15
): number {
  const pop = calculatePopularityScore(restaurant);
  const popNorm = Math.min(1, pop / maxPopularity);
  return 0.5 + 0.3 * (popNorm - 0.5);
}

// ============================================
// Robust Nash Welfare
// ============================================

interface SatisfactionEntry {
  userId: string;
  score: number;
  isCold: boolean;
}

/**
 * Calculate Nash Welfare that's robust to cold-start users.
 *
 * Problem with standard Nash Welfare = (Π u_i)^(1/n):
 * If a cold user gets a random low score (e.g., 0.1), it drags
 * the entire product down even though we have no confidence in
 * that score.
 *
 * Solution: Separate warm and cold users
 *   1. Nash_warm = geometric mean of warm user scores
 *   2. Avg_cold  = arithmetic mean of cold user scores
 *   3. Nash_adjusted = Nash_warm^w × Avg_cold^(1−w)
 *      where w = #warm / #total
 *
 * When all users are warm: Nash_adjusted = Nash_warm (standard)
 * When all users are cold: Nash_adjusted = Avg_cold (popularity-based)
 */
export function calculateRobustNashWelfare(
  satisfactions: SatisfactionEntry[]
): number {
  if (satisfactions.length === 0) return 0;

  const warm = satisfactions.filter(s => !s.isCold);
  const cold = satisfactions.filter(s => s.isCold);

  // All cold → use average (arithmetic mean)
  if (warm.length === 0) {
    const avg = cold.reduce((sum, s) => sum + s.score, 0) / cold.length;
    return avg;
  }

  // All warm → standard Nash (geometric mean)
  if (cold.length === 0) {
    const product = warm.reduce((prod, s) => prod * Math.max(s.score, 0.001), 1);
    return Math.pow(product, 1 / warm.length);
  }

  // Mixed: blend Nash_warm with Avg_cold
  const warmWeight = warm.length / satisfactions.length;

  const warmProduct = warm.reduce((prod, s) => prod * Math.max(s.score, 0.001), 1);
  const nashWarm = Math.pow(warmProduct, 1 / warm.length);

  const avgCold = cold.reduce((sum, s) => sum + s.score, 0) / cold.length;

  // Blended: Nash_adjusted = Nash_warm^w × Avg_cold^(1−w)
  return Math.pow(nashWarm, warmWeight) * Math.pow(Math.max(avgCold, 0.001), 1 - warmWeight);
}
