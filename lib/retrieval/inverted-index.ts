/**
 * Inverted Index for Restaurant Retrieval
 *
 * MIE451 Concept: Information Retrieval with TF-IDF weighting
 *
 * Maps terms (tags, cuisines, locations, features) to the set of
 * restaurants containing that term, along with TF-IDF weights.
 */

import { Restaurant } from '../types';

// ============================================
// Types
// ============================================

export interface InvertedIndex {
  /** term -> { restaurantId -> tf-idf score } */
  termIndex: Map<string, Map<string, number>>;
  /** IDF value for each term */
  idfValues: Map<string, number>;
  /** How many restaurants contain each term */
  documentFrequency: Map<string, number>;
  /** Total number of restaurants */
  totalDocuments: number;
}

// ============================================
// Synonym Map
// ============================================

const SYNONYM_MAP: Record<string, string> = {
  'bbq': 'barbecue',
  'barbeque': 'barbecue',
  'veggie': 'vegetarian',
  'veg': 'vegetarian',
  'plant-based': 'vegan',
  'gf': 'gluten-free',
  'gluten free': 'gluten-free',
  'dairy free': 'dairy-free',
  'nut free': 'nut-free',
  'sushi bars': 'sushi',
  'cocktail bars': 'bar',
  'wine bars': 'bar',
  'sports bars': 'bar',
  'canadian (new)': 'canadian',
  'breakfast & brunch': 'brunch',
  'southern (us)': 'southern',
  'fast food': 'fast-food',
};

// ============================================
// Term Normalization
// ============================================

/**
 * Normalize a term for indexing:
 * - Lowercase
 * - Strip extra whitespace
 * - Apply synonym mapping
 */
export function normalizeTerm(term: string): string {
  const lower = term.toLowerCase().trim();
  return SYNONYM_MAP[lower] ?? lower;
}

// ============================================
// Term Extraction
// ============================================

/**
 * Extract searchable terms from a restaurant.
 *
 * Sources:
 * - cuisine field (split by comma)
 * - tags array
 * - location field (split by comma)
 * - price level as a categorical term
 */
export function extractTerms(restaurant: Restaurant): string[] {
  const terms: string[] = [];

  // Cuisine (may be comma-separated like "Japanese, Sushi Bars")
  const cuisineParts = restaurant.cuisine.split(/[,/]/).map(s => s.trim()).filter(Boolean);
  for (const part of cuisineParts) {
    terms.push(normalizeTerm(part));
  }

  // Tags
  for (const tag of restaurant.tags) {
    terms.push(normalizeTerm(tag));
  }

  // Location (split by comma for multi-part like "Kensington Market, Downtown Core")
  const locationParts = restaurant.location.split(',').map(s => s.trim()).filter(Boolean);
  for (const part of locationParts) {
    terms.push(normalizeTerm(part));
  }

  // Price level as categorical term
  const priceTerms = normalizePriceToTerms(restaurant.price);
  terms.push(...priceTerms);

  // Rating tier
  if (restaurant.rating >= 4.5) terms.push('highly-rated');
  else if (restaurant.rating >= 4.0) terms.push('well-rated');
  else if (restaurant.rating >= 3.5) terms.push('average-rated');

  // Dietary tags from description (lightweight keyword scan)
  const desc = restaurant.description.toLowerCase();
  if (desc.includes('vegan')) terms.push('vegan');
  if (desc.includes('vegetarian')) terms.push('vegetarian');
  if (desc.includes('gluten-free') || desc.includes('gluten free')) terms.push('gluten-free');
  if (desc.includes('halal')) terms.push('halal');
  if (desc.includes('kosher')) terms.push('kosher');

  // Deduplicate
  return [...new Set(terms)];
}

/**
 * Normalize the various price formats in the data into standard terms.
 */
function normalizePriceToTerms(price: string): string[] {
  switch (price) {
    case '$': return ['cheap', 'budget'];
    case '$$': return ['moderate'];
    case '$$$': return ['upscale'];
    case '$$$$': return ['luxury', 'expensive'];
    default:
      // Handle "CA$10–20" style
      if (price.includes('10') || price.includes('1–10')) return ['cheap', 'budget'];
      if (price.includes('20') && !price.includes('100')) return ['moderate'];
      if (price.includes('100')) return ['luxury', 'expensive'];
      return ['moderate'];
  }
}

// ============================================
// IDF Calculation
// ============================================

/**
 * IDF(t) = log₁₀(N / df_t)
 *
 * High IDF = rare/discriminative term.
 * Low IDF  = common/uninformative term.
 */
export function calculateIDF(df: number, N: number): number {
  if (df <= 0) return 0;
  return Math.log10(N / df);
}

// ============================================
// Build Index
// ============================================

/**
 * Build an inverted index from restaurant data.
 *
 * Algorithm (MIE451 Section 1.4):
 * 1. Collect all documents (restaurants)
 * 2. Tokenize & normalize terms per document
 * 3. Calculate TF per document
 * 4. Calculate DF across corpus
 * 5. Compute IDF = log₁₀(N / DF)
 * 6. Store TF-IDF = (1 + log₁₀(TF)) × IDF per document–term pair
 */
export function buildInvertedIndex(restaurants: Restaurant[]): InvertedIndex {
  const N = restaurants.length;
  const documentFrequency = new Map<string, number>();
  const termIndex = new Map<string, Map<string, number>>();

  // Step 1-3: Extract terms and count TF per document, DF across corpus
  const docTermFreqs: { id: string; tfs: Map<string, number> }[] = [];

  for (const restaurant of restaurants) {
    const terms = extractTerms(restaurant);
    const tf = new Map<string, number>();
    const seen = new Set<string>();

    for (const term of terms) {
      tf.set(term, (tf.get(term) || 0) + 1);
      if (!seen.has(term)) {
        seen.add(term);
        documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
      }
    }

    docTermFreqs.push({ id: restaurant.id, tfs: tf });
  }

  // Step 4-5: Calculate IDF for each term
  const idfValues = new Map<string, number>();
  for (const [term, df] of documentFrequency) {
    idfValues.set(term, calculateIDF(df, N));
  }

  // Step 6: Build TF-IDF postings
  for (const { id, tfs } of docTermFreqs) {
    for (const [term, rawTf] of tfs) {
      const tfWeight = 1 + Math.log10(rawTf); // Log-frequency TF weighting
      const idf = idfValues.get(term) || 0;
      const tfidf = tfWeight * idf;

      if (!termIndex.has(term)) {
        termIndex.set(term, new Map());
      }
      termIndex.get(term)!.set(id, tfidf);
    }
  }

  return { termIndex, idfValues, documentFrequency, totalDocuments: N };
}

// ============================================
// Query Helpers
// ============================================

/**
 * Look up which restaurant IDs contain a term.
 */
export function getPostingList(index: InvertedIndex, term: string): Map<string, number> {
  const normalized = normalizeTerm(term);
  return index.termIndex.get(normalized) || new Map();
}

/**
 * Get the IDF weight for a term.
 * Returns 0 if term is not in the index.
 */
export function getIDF(index: InvertedIndex, term: string): number {
  const normalized = normalizeTerm(term);
  return index.idfValues.get(normalized) || 0;
}

/**
 * Boolean AND intersection of posting lists.
 *
 * MIE451 Section 1.4 — INTERSECT algorithm, O(x + y).
 * Returns restaurant IDs present in ALL posting lists.
 */
export function intersectPostings(lists: Map<string, number>[]): Set<string> {
  if (lists.length === 0) return new Set();

  // Sort by list size (smallest first) for query optimization
  const sorted = [...lists].sort((a, b) => a.size - b.size);
  let result = new Set(sorted[0].keys());

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    const intersection = new Set<string>();
    for (const id of result) {
      if (next.has(id)) intersection.add(id);
    }
    result = intersection;
    if (result.size === 0) break;
  }

  return result;
}
