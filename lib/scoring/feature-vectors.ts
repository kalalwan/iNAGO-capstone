/**
 * Feature Vector Construction for Content-Based Filtering
 *
 * MIE451 Concept: User/item feature vectors for CBF (Module 5.2)
 *
 * Replaces the "group query → single embedding" approach with
 * explicit feature vectors that enable per-user scoring.
 *
 * Each feature dimension represents a restaurant attribute.
 * User vectors encode preferences; restaurant vectors encode attributes.
 * Scoring uses cosine similarity of these vectors.
 */

import { Restaurant, StructuredUserProfile } from '../types';
import { InvertedIndex, getIDF, normalizeTerm } from '../retrieval/inverted-index';

// ============================================
// Feature Schema
// ============================================

/**
 * Cuisine categories observed in the Toronto restaurant data.
 * These become one-hot features in the vector.
 */
const CUISINE_CATEGORIES = [
  'italian', 'japanese', 'chinese', 'thai', 'indian', 'korean',
  'vietnamese', 'mexican', 'american', 'mediterranean', 'middle eastern',
  'french', 'seafood', 'barbecue', 'steakhouse', 'sushi', 'ramen',
  'pizza', 'brunch', 'cafe', 'canadian', 'greek', 'caribbean',
  'ethiopian', 'turkish', 'spanish', 'peruvian',
] as const;

const PRICE_LEVELS = ['cheap', 'moderate', 'upscale', 'luxury'] as const;

const LOCATION_AREAS = [
  'downtown core', 'entertainment district', 'financial district',
  'yorkville', 'kensington market', 'liberty village', 'little italy',
  'chinatown', 'queen west', 'king west', 'harbourfront',
  'north york', 'scarborough', 'etobicoke',
] as const;

const AMBIANCE_TYPES = ['casual', 'upscale', 'trendy', 'quiet', 'lively'] as const;

const DIETARY_FEATURES = ['vegan', 'vegetarian', 'gluten-free', 'halal', 'kosher'] as const;

// Index offsets into the flat vector
const CUISINE_OFFSET = 0;
const PRICE_OFFSET = CUISINE_CATEGORIES.length;
const LOCATION_OFFSET = PRICE_OFFSET + PRICE_LEVELS.length;
const AMBIANCE_OFFSET = LOCATION_OFFSET + LOCATION_AREAS.length;
const DIETARY_OFFSET = AMBIANCE_OFFSET + AMBIANCE_TYPES.length;
const RATING_OFFSET = DIETARY_OFFSET + DIETARY_FEATURES.length;
const POPULARITY_OFFSET = RATING_OFFSET + 1;
export const TOTAL_DIMENSIONS = POPULARITY_OFFSET + 1;

// ============================================
// Restaurant Feature Vector
// ============================================

/**
 * Build a feature vector for a restaurant.
 *
 * Binary features for categorical attributes,
 * normalized [0,1] for continuous attributes.
 */
export function buildRestaurantFeatureVector(
  restaurant: Restaurant,
  index: InvertedIndex
): Float32Array {
  const vec = new Float32Array(TOTAL_DIMENSIONS);
  const tags = restaurant.tags.map(t => normalizeTerm(t));
  const cuisine = normalizeTerm(restaurant.cuisine);
  const location = restaurant.location.toLowerCase();
  const desc = restaurant.description.toLowerCase();

  // Cuisine features (one-hot, IDF-weighted)
  for (let i = 0; i < CUISINE_CATEGORIES.length; i++) {
    const cat = CUISINE_CATEGORIES[i];
    if (cuisine.includes(cat) || tags.includes(cat)) {
      const idf = getIDF(index, cat);
      vec[CUISINE_OFFSET + i] = Math.max(1, idf); // At least 1 if present
    }
  }

  // Price features (one-hot)
  const priceIdx = getPriceIndex(restaurant.price);
  if (priceIdx >= 0) {
    vec[PRICE_OFFSET + priceIdx] = 1;
  }

  // Location features (may match multiple: "Entertainment District, Downtown Core")
  for (let i = 0; i < LOCATION_AREAS.length; i++) {
    if (location.includes(LOCATION_AREAS[i])) {
      vec[LOCATION_OFFSET + i] = 1;
    }
  }

  // Ambiance features (inferred from price/tags)
  if (restaurant.price === '$' || tags.includes('fast-food')) {
    vec[AMBIANCE_OFFSET + 0] = 1; // casual
  }
  if (restaurant.price === '$$$' || restaurant.price === '$$$$') {
    vec[AMBIANCE_OFFSET + 1] = 1; // upscale
  }
  if (tags.includes('trendy') || tags.includes('hip')) {
    vec[AMBIANCE_OFFSET + 2] = 1; // trendy
  }

  // Dietary features
  for (let i = 0; i < DIETARY_FEATURES.length; i++) {
    const diet = DIETARY_FEATURES[i];
    if (tags.includes(diet) || cuisine.includes(diet) || desc.includes(diet)) {
      const idf = getIDF(index, diet);
      vec[DIETARY_OFFSET + i] = Math.max(1, idf); // IDF-weighted
    }
  }

  // Rating (normalized 0-1, centered at 3.5)
  vec[RATING_OFFSET] = Math.max(0, Math.min(1, (restaurant.rating - 1) / 4));

  // Popularity = log₁₀(reviewCount + 1) normalized
  const maxLogReviews = Math.log10(5001); // assume max ~5000 reviews
  vec[POPULARITY_OFFSET] = Math.min(1, Math.log10(restaurant.reviewCount + 1) / maxLogReviews);

  return vec;
}

// ============================================
// User Feature Vector
// ============================================

/**
 * Build a feature vector for a user based on their profile.
 *
 * Key differences from restaurant vector:
 *   - Cuisine dims weighted by preference score × confidence × IDF
 *   - Budget/location/ambiance weighted by confidence
 *   - IDF weighting ensures rare preferences count more
 *
 * MIE451 IDF formula applied:
 *   weight = preferenceScore × confidence × IDF(term)
 */
export function buildUserFeatureVector(
  profile: StructuredUserProfile,
  index: InvertedIndex
): Float32Array {
  const vec = new Float32Array(TOTAL_DIMENSIONS);

  // Cuisine preference features
  for (const pref of profile.cuisinePreferences.favorites) {
    const normalized = normalizeTerm(pref.cuisine);
    const catIndex = CUISINE_CATEGORIES.indexOf(normalized as typeof CUISINE_CATEGORIES[number]);
    if (catIndex >= 0) {
      const idf = getIDF(index, normalized);
      // weight = preferenceScore(1-10) × confidence(0-1) × IDF
      // Normalized score: pref.score is 1-10, divide by 10
      vec[CUISINE_OFFSET + catIndex] =
        (pref.score / 10) * profile.confidence.cuisine * Math.max(idf, 0.5);
    }
  }

  // Cuisine dislikes (negative weight)
  for (const dislike of profile.cuisinePreferences.dislikes) {
    const normalized = normalizeTerm(dislike);
    const catIndex = CUISINE_CATEGORIES.indexOf(normalized as typeof CUISINE_CATEGORIES[number]);
    if (catIndex >= 0) {
      vec[CUISINE_OFFSET + catIndex] = -0.5 * profile.confidence.cuisine;
    }
  }

  // Price preference
  if (profile.budget.preferred) {
    const priceIdx = getPriceIndex(profile.budget.preferred);
    if (priceIdx >= 0) {
      vec[PRICE_OFFSET + priceIdx] = profile.confidence.budget;
      // Add partial weight to adjacent price levels based on flexibility
      const flex = profile.budget.flexibility / 5; // 0-1
      if (priceIdx > 0) {
        vec[PRICE_OFFSET + priceIdx - 1] = flex * profile.confidence.budget * 0.5;
      }
      if (priceIdx < PRICE_LEVELS.length - 1) {
        vec[PRICE_OFFSET + priceIdx + 1] = flex * profile.confidence.budget * 0.5;
      }
    }
  }

  // Location preferences
  for (const area of profile.location.preferredAreas) {
    const normalized = area.toLowerCase();
    for (let i = 0; i < LOCATION_AREAS.length; i++) {
      if (LOCATION_AREAS[i].includes(normalized) || normalized.includes(LOCATION_AREAS[i])) {
        vec[LOCATION_OFFSET + i] = profile.confidence.location;
      }
    }
  }

  // Ambiance preferences
  for (const amb of profile.diningStyle.preferredAmbiance) {
    const ambIdx = AMBIANCE_TYPES.indexOf(amb);
    if (ambIdx >= 0) {
      vec[AMBIANCE_OFFSET + ambIdx] = 0.8; // Fixed weight (ambiance has no confidence)
    }
  }

  // Dietary requirements (hard constraints get maximum weight via IDF)
  for (const restriction of profile.dietary.restrictions) {
    if (restriction.strictness === 'strict') {
      const normalized = normalizeTerm(restriction.type);
      const dietIdx = DIETARY_FEATURES.indexOf(normalized as typeof DIETARY_FEATURES[number]);
      if (dietIdx >= 0) {
        const idf = getIDF(index, normalized);
        // Hard constraint: maximum weight
        vec[DIETARY_OFFSET + dietIdx] = Math.max(2, idf * 2);
      }
    }
  }

  // Rating preference: everyone prefers higher-rated restaurants
  vec[RATING_OFFSET] = 0.5; // Moderate preference for quality

  // Popularity: slight preference for popular places (evidence of quality)
  vec[POPULARITY_OFFSET] = 0.3;

  return vec;
}

// ============================================
// Scoring
// ============================================

/**
 * Score a user–restaurant pair via cosine similarity of feature vectors.
 *
 * MIE451 Section 1.12: Vector Space Model with cosine similarity
 *
 * cos(u, r) = (u · r) / (|u| × |r|)
 *
 * Returns value in [0, 1] (clamped, since negatives are possible
 * from dislikes but we floor at 0).
 */
export function scoreUserRestaurant(
  userVector: Float32Array,
  restaurantVector: Float32Array
): number {
  let dot = 0;
  let normU = 0;
  let normR = 0;

  for (let i = 0; i < userVector.length; i++) {
    dot += userVector[i] * restaurantVector[i];
    normU += userVector[i] * userVector[i];
    normR += restaurantVector[i] * restaurantVector[i];
  }

  const magnitude = Math.sqrt(normU) * Math.sqrt(normR);
  if (magnitude === 0) return 0;

  // Cosine similarity in [-1, 1], clamp to [0, 1]
  return Math.max(0, Math.min(1, dot / magnitude));
}

/**
 * Batch score all restaurants for one user.
 * Returns an array of scores aligned with the input restaurant vectors.
 */
export function batchScoreRestaurants(
  userVector: Float32Array,
  restaurantVectors: Float32Array[]
): number[] {
  return restaurantVectors.map(rv => scoreUserRestaurant(userVector, rv));
}

// ============================================
// Helpers
// ============================================

function getPriceIndex(price: string): number {
  switch (price) {
    case '$': return 0;
    case '$$': return 1;
    case '$$$': return 2;
    case '$$$$': return 3;
    default:
      // Handle "CA$10–20" style
      if (price.includes('1–10') || price.includes('10–20')) return 0;
      if (price.includes('20–30') || price.includes('20–40')) return 1;
      if (price.includes('100')) return 3;
      return 1; // Default moderate
  }
}
