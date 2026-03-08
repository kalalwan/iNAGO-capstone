/**
 * Sparse Retrieval Module
 *
 * MIE451 Concept: Boolean retrieval + TF-IDF scoring
 *
 * Stage 1 of the hybrid retrieval pipeline.
 * Uses the inverted index for fast candidate filtering:
 *   - Boolean AND for hard constraints (must match)
 *   - TF-IDF scoring for soft constraints (should match)
 */

import {
  InvertedIndex,
  normalizeTerm,
  getPostingList,
  getIDF,
  intersectPostings,
} from './inverted-index';
import {
  Restaurant,
  HardConstraint,
  SoftConstraint,
  StructuredUserProfile,
} from '../types';
import { extractConstraints } from '../fairness';

// ============================================
// Types
// ============================================

export interface SparseRetrievalResult {
  restaurantId: string;
  sparseScore: number;
  matchedTerms: string[];
  passesHardConstraints: boolean;
}

// ============================================
// Hard Constraint → Query Terms
// ============================================

/**
 * Convert a hard constraint into positive and negative query terms.
 *
 * Dietary:
 *   { type: 'dietary', value: 'vegan' } → mustMatch: ["vegan"]
 *   { type: 'dietary', value: 'halal' } → mustMatch: ["halal"]
 *
 * Allergy:
 *   { type: 'allergy', value: 'peanut' } → mustNotMatch: ["peanut", "nut"]
 */
export function constraintToTerms(constraint: HardConstraint): {
  mustMatch: string[];
  mustNotMatch: string[];
} {
  const value = constraint.value.toLowerCase();

  switch (constraint.type) {
    case 'dietary':
      return { mustMatch: [normalizeTerm(value)], mustNotMatch: [] };

    case 'allergy':
      // For allergies, we want to exclude restaurants with the allergen
      if (value === 'peanut' || value === 'nut-free') {
        return { mustMatch: [], mustNotMatch: ['peanut', 'nut', 'tree-nut'] };
      }
      return { mustMatch: [], mustNotMatch: [normalizeTerm(value)] };

    case 'accessibility':
      return { mustMatch: [normalizeTerm(value)], mustNotMatch: [] };

    default:
      return { mustMatch: [], mustNotMatch: [] };
  }
}

// ============================================
// Soft Constraint → Weighted Query Terms
// ============================================

/**
 * Convert soft constraints to weighted query terms.
 *
 * Each term gets a query weight = constraint.weight × IDF(term)
 * This means rare constraint terms get amplified.
 */
export function softConstraintsToWeightedTerms(
  constraints: SoftConstraint[],
  index: InvertedIndex
): Map<string, number> {
  const weights = new Map<string, number>();

  for (const constraint of constraints) {
    const term = normalizeTerm(constraint.value);
    // Skip negative constraints (handled separately)
    if (term.startsWith('not-')) continue;

    const idf = getIDF(index, term);
    // queryWeight = constraint.weight × IDF (rare terms boosted)
    const queryWeight = constraint.weight * Math.max(idf, 0.1);
    const existing = weights.get(term) || 0;
    weights.set(term, existing + queryWeight);
  }

  return weights;
}

// ============================================
// Sparse Scoring
// ============================================

/**
 * Score a restaurant against weighted query terms using TF-IDF.
 *
 * MIE451 Section 1.11:
 *   score(q, d) = Σ_{t ∈ q} queryWeight(t) × tfidf(t, d)
 */
export function scoreSparse(
  restaurantId: string,
  queryWeights: Map<string, number>,
  index: InvertedIndex
): { score: number; matchedTerms: string[] } {
  let score = 0;
  const matchedTerms: string[] = [];

  for (const [term, queryWeight] of queryWeights) {
    const postings = index.termIndex.get(term);
    if (postings && postings.has(restaurantId)) {
      const docTfIdf = postings.get(restaurantId)!;
      score += queryWeight * docTfIdf;
      matchedTerms.push(term);
    }
  }

  return { score, matchedTerms };
}

// ============================================
// Main Sparse Retrieval
// ============================================

/**
 * Retrieve candidates using Boolean filtering + TF-IDF scoring.
 *
 * Algorithm:
 * 1. Combine hard constraints from ALL user profiles (intersection)
 * 2. For positive hard constraints: Boolean AND (must all appear)
 * 3. For negative hard constraints: exclude restaurants with those terms
 * 4. For soft constraints: build weighted query, score with TF-IDF
 * 5. Return top candidates sorted by sparse score
 */
export function sparseRetrieve(
  index: InvertedIndex,
  restaurants: Restaurant[],
  profiles: StructuredUserProfile[],
  limit: number = 50
): SparseRetrievalResult[] {
  // Step 1: Gather all hard and soft constraints from all profiles
  const allHard: HardConstraint[] = [];
  const allSoft: SoftConstraint[] = [];
  for (const profile of profiles) {
    const constraints = extractConstraints(profile);
    allHard.push(...constraints.hard);
    allSoft.push(...constraints.soft);
  }

  // Step 2: Build positive and negative term sets from hard constraints
  const positiveTermLists: Map<string, number>[] = [];
  const negativeTerms = new Set<string>();

  for (const hard of allHard) {
    const { mustMatch, mustNotMatch } = constraintToTerms(hard);
    for (const term of mustMatch) {
      const postings = getPostingList(index, term);
      if (postings.size > 0) {
        positiveTermLists.push(postings);
      }
    }
    for (const term of mustNotMatch) {
      negativeTerms.add(normalizeTerm(term));
    }
  }

  // Step 3: Determine feasible set via Boolean operations
  const restaurantIds = new Set(restaurants.map(r => r.id));
  let feasibleIds: Set<string>;

  if (positiveTermLists.length > 0) {
    // Boolean AND — intersect all positive posting lists
    feasibleIds = intersectPostings(positiveTermLists);
  } else {
    // No positive hard constraints — all restaurants are feasible
    feasibleIds = new Set(restaurantIds);
  }

  // Step 4: Remove restaurants matching negative terms
  for (const term of negativeTerms) {
    const postings = getPostingList(index, term);
    for (const id of postings.keys()) {
      feasibleIds.delete(id);
    }
  }

  // If Boolean filtering leaves nothing, fall back to full set
  // (the fairness layer will still penalize hard constraint violations)
  if (feasibleIds.size === 0) {
    feasibleIds = new Set(restaurantIds);
  }

  // Step 5: Build weighted query from soft constraints
  const queryWeights = softConstraintsToWeightedTerms(allSoft, index);

  // Step 6: Score all feasible restaurants
  const results: SparseRetrievalResult[] = [];

  for (const id of feasibleIds) {
    const { score, matchedTerms } = scoreSparse(id, queryWeights, index);
    results.push({
      restaurantId: id,
      sparseScore: score,
      matchedTerms,
      passesHardConstraints: true,
    });
  }

  // Step 7: Sort by sparse score descending, return top candidates
  results.sort((a, b) => b.sparseScore - a.sparseScore);
  return results.slice(0, limit);
}
