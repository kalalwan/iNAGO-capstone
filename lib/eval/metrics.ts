/**
 * IR Evaluation Metrics
 *
 * MIE451 Module 1.14: Standard Information Retrieval evaluation metrics
 *
 * Implements:
 *   - Precision@K: fraction of top-K that are relevant
 *   - NDCG@K: normalized discounted cumulative gain
 *   - Baseline comparison: system vs popularity vs random
 */

import { Restaurant, StructuredUserProfile, ScoredRestaurant, GroupFairnessMetrics } from '../types';
import { calculateGroupFairness } from '../fairness';
import { getPopularityBaseline, getRandomBaseline } from '../baselines/popularity-baseline';
import { InvertedIndex } from '../retrieval/inverted-index';

// ============================================
// Types
// ============================================

export interface RelevanceJudgment {
  restaurantId: string;
  /** Graded relevance: 0 = not relevant, 1 = marginal, 2 = relevant, 3 = highly relevant */
  grade: number;
}

export interface PrecisionResult {
  k: number;
  precision: number;
  relevantCount: number;
}

export interface NDCGResult {
  k: number;
  dcg: number;
  idcg: number;
  ndcg: number;
}

export interface BaselineComparison {
  systemName: string;
  nashWelfare: number;
  utilitarian: number;
  egalitarian: number;
  gini: number;
  topPick: string;
}

export interface EvalMetricsSummary {
  precisionAt3: number;
  precisionAt5: number;
  ndcgAt5: number;
  ndcgAt10: number;
  baselineComparisons: BaselineComparison[];
  /** Lift over popularity baseline (Nash welfare) */
  nashLiftOverPopularity: number;
}

// ============================================
// Relevance Judgment Generation
// ============================================

/**
 * Auto-generate relevance judgments based on group fairness scores.
 *
 * Since we don't have human judgments, we use the fairness system itself:
 *   - Grade 3: Nash >= 0.6 and no hard violations
 *   - Grade 2: Nash >= 0.4 and no hard violations
 *   - Grade 1: Nash >= 0.2 and no hard violations
 *   - Grade 0: Nash < 0.2 or hard violations
 *
 * This is a proxy metric — in a real system, human judges would provide grades.
 */
export function autoGenerateRelevanceJudgments(
  restaurants: Restaurant[],
  profiles: StructuredUserProfile[],
  index?: InvertedIndex
): RelevanceJudgment[] {
  return restaurants.map(r => {
    const { metrics, userSatisfaction } = calculateGroupFairness(r, profiles, index);
    const allSatisfied = userSatisfaction.every(u => u.satisfied);

    let grade: number;
    if (!allSatisfied) {
      grade = 0;
    } else if (metrics.nash >= 0.6) {
      grade = 3;
    } else if (metrics.nash >= 0.4) {
      grade = 2;
    } else if (metrics.nash >= 0.2) {
      grade = 1;
    } else {
      grade = 0;
    }

    return { restaurantId: r.id, grade };
  });
}

// ============================================
// Precision@K
// ============================================

/**
 * Precision@K: fraction of top-K results that are relevant.
 *
 * MIE451 Module 1.14:
 *   P@K = |relevant ∩ top-K| / K
 *
 * A result is "relevant" if its grade >= threshold (default 2).
 */
export function precisionAtK(
  rankedList: ScoredRestaurant[],
  judgments: Map<string, number>,
  k: number,
  relevanceThreshold: number = 2
): PrecisionResult {
  const topK = rankedList.slice(0, k);
  let relevantCount = 0;

  for (const r of topK) {
    const grade = judgments.get(r.id) ?? 0;
    if (grade >= relevanceThreshold) {
      relevantCount++;
    }
  }

  return {
    k,
    precision: topK.length > 0 ? relevantCount / topK.length : 0,
    relevantCount,
  };
}

// ============================================
// NDCG@K
// ============================================

/**
 * Normalized Discounted Cumulative Gain at K.
 *
 * MIE451 Module 1.14:
 *   DCG@K = Σ_{i=1}^{K} (2^rel_i - 1) / log₂(i + 1)
 *   IDCG@K = DCG of ideal ranking (grades sorted descending)
 *   NDCG@K = DCG@K / IDCG@K
 *
 * Measures ranking quality: higher = better ranking of relevant items.
 */
export function ndcgAtK(
  rankedList: ScoredRestaurant[],
  judgments: Map<string, number>,
  k: number
): NDCGResult {
  const topK = rankedList.slice(0, k);

  // DCG
  let dcg = 0;
  for (let i = 0; i < topK.length; i++) {
    const grade = judgments.get(topK[i].id) ?? 0;
    dcg += (Math.pow(2, grade) - 1) / Math.log2(i + 2); // log₂(i+1+1) since i is 0-indexed
  }

  // IDCG: sort all grades descending, take top-K
  const allGrades = [...judgments.values()].sort((a, b) => b - a);
  let idcg = 0;
  for (let i = 0; i < Math.min(k, allGrades.length); i++) {
    idcg += (Math.pow(2, allGrades[i]) - 1) / Math.log2(i + 2);
  }

  return {
    k,
    dcg,
    idcg,
    ndcg: idcg > 0 ? dcg / idcg : 0,
  };
}

// ============================================
// Baseline Comparison
// ============================================

/**
 * Compare the system's recommendation against baselines.
 *
 * Computes group fairness metrics for:
 *   1. System's top pick
 *   2. Popularity baseline's top pick
 *   3. Random baseline's top pick (averaged over 5 runs)
 *
 * Returns comparison data for dashboard display.
 */
export function compareBaselines(
  systemCandidates: ScoredRestaurant[],
  restaurants: Restaurant[],
  profiles: StructuredUserProfile[],
  index?: InvertedIndex
): BaselineComparison[] {
  const comparisons: BaselineComparison[] = [];

  // 1. System recommendation (top pick from hybrid pipeline + fairness)
  if (systemCandidates.length > 0) {
    const top = systemCandidates[0];
    const { metrics } = calculateGroupFairness(top, profiles, index);
    comparisons.push({
      systemName: 'Hybrid + Nash',
      nashWelfare: metrics.nash,
      utilitarian: metrics.utilitarian,
      egalitarian: metrics.egalitarian,
      gini: metrics.gini,
      topPick: top.name,
    });
  }

  // 2. Popularity baseline
  const popBaseline = getPopularityBaseline(restaurants, profiles, 1);
  if (popBaseline.length > 0) {
    const popTop = popBaseline[0];
    const { metrics } = calculateGroupFairness(popTop, profiles, index);
    comparisons.push({
      systemName: 'Popularity',
      nashWelfare: metrics.nash,
      utilitarian: metrics.utilitarian,
      egalitarian: metrics.egalitarian,
      gini: metrics.gini,
      topPick: popTop.name,
    });
  }

  // 3. Random baseline (average over 5 runs)
  const randomRuns = 5;
  let randNash = 0, randUtil = 0, randEgal = 0, randGini = 0;
  let randomTopPick = '';

  for (let run = 0; run < randomRuns; run++) {
    const randBaseline = getRandomBaseline(restaurants, profiles, 1);
    if (randBaseline.length > 0) {
      const { metrics } = calculateGroupFairness(randBaseline[0], profiles, index);
      randNash += metrics.nash;
      randUtil += metrics.utilitarian;
      randEgal += metrics.egalitarian;
      randGini += metrics.gini;
      if (run === 0) randomTopPick = randBaseline[0].name;
    }
  }

  comparisons.push({
    systemName: 'Random (avg)',
    nashWelfare: randNash / randomRuns,
    utilitarian: randUtil / randomRuns,
    egalitarian: randEgal / randomRuns,
    gini: randGini / randomRuns,
    topPick: randomTopPick + ' (sample)',
  });

  return comparisons;
}

/**
 * Calculate full evaluation metrics for a scenario.
 */
export function calculateEvalMetrics(
  systemCandidates: ScoredRestaurant[],
  restaurants: Restaurant[],
  profiles: StructuredUserProfile[],
  index?: InvertedIndex
): EvalMetricsSummary {
  // Generate relevance judgments
  const judgmentList = autoGenerateRelevanceJudgments(restaurants, profiles, index);
  const judgments = new Map(judgmentList.map(j => [j.restaurantId, j.grade]));

  // Precision@K
  const p3 = precisionAtK(systemCandidates, judgments, 3);
  const p5 = precisionAtK(systemCandidates, judgments, 5);

  // NDCG@K
  const n5 = ndcgAtK(systemCandidates, judgments, 5);
  const n10 = ndcgAtK(systemCandidates, judgments, 10);

  // Baseline comparisons
  const baselines = compareBaselines(systemCandidates, restaurants, profiles, index);

  // Nash lift over popularity
  const systemNash = baselines.find(b => b.systemName === 'Hybrid + Nash')?.nashWelfare ?? 0;
  const popNash = baselines.find(b => b.systemName === 'Popularity')?.nashWelfare ?? 0;
  const nashLift = popNash > 0 ? (systemNash - popNash) / popNash : 0;

  return {
    precisionAt3: p3.precision,
    precisionAt5: p5.precision,
    ndcgAt5: n5.ndcg,
    ndcgAt10: n10.ndcg,
    baselineComparisons: baselines,
    nashLiftOverPopularity: nashLift,
  };
}
