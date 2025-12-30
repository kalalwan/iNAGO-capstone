/**
 * User Profile Utilities
 *
 * Handles profile creation, updates, local preference extraction,
 * and localStorage persistence.
 */

import {
  StructuredUserProfile,
  DietaryRestriction,
  DietaryType,
  CuisinePreference,
  ExtractedPreferences,
  LegacyUserMemory,
} from './types';
import { createEmptyProfile } from './fairness';

const STORAGE_KEY = 'inago-user-profiles-v2';
const LEGACY_STORAGE_KEY = 'inago-user-memories';

// ============================================
// Local Preference Extraction (No API)
// ============================================

/**
 * Extract preferences from a message using regex patterns (no API call)
 */
export function extractLocalPreferences(message: string): ExtractedPreferences {
  const lower = message.toLowerCase();
  const result: ExtractedPreferences = {};

  // Dietary detection patterns
  const dietaryPatterns: Record<DietaryType, RegExp> = {
    vegan: /\b(vegan|plant-based|no animal products?)\b/,
    vegetarian: /\b(vegetarian|veggie|no meat)\b/,
    pescatarian: /\b(pescatarian|fish only)\b/,
    'gluten-free': /\b(gluten-free|gluten free|celiac|no gluten)\b/,
    'dairy-free': /\b(dairy-free|dairy free|lactose|no dairy)\b/,
    keto: /\b(keto|ketogenic|low carb)\b/,
    halal: /\b(halal)\b/,
    kosher: /\b(kosher)\b/,
    'nut-free': /\b(nut-free|nut free|nut allergy|no nuts?)\b/,
    other: /\b(dietary restriction)\b/,
  };

  result.dietary = [];
  for (const [diet, pattern] of Object.entries(dietaryPatterns)) {
    if (pattern.test(lower)) {
      // Check if it's strict based on language
      const strictPatterns = /\b(strict|always|must|need|can't eat|cannot eat|allergic)\b/;
      const strictness = strictPatterns.test(lower) ? 'strict' : 'flexible';
      result.dietary.push({
        type: diet as DietaryType,
        strictness,
      });
    }
  }

  // Allergy detection
  const allergyPatterns = /\b(allergic to|allergy to|can't eat|cannot eat)\s+(\w+)/gi;
  const allergies: string[] = [];
  let allergyMatch;
  while ((allergyMatch = allergyPatterns.exec(lower)) !== null) {
    allergies.push(allergyMatch[2]);
  }
  if (allergies.length > 0) {
    result.allergies = allergies;
  }

  // Cuisine detection
  const cuisines = [
    'italian', 'chinese', 'japanese', 'thai', 'indian', 'mexican',
    'korean', 'vietnamese', 'bbq', 'barbecue', 'sushi', 'pizza',
    'burger', 'seafood', 'mediterranean', 'french', 'greek',
    'middle eastern', 'turkish', 'spanish', 'american', 'asian',
    'african', 'ethiopian', 'caribbean', 'cuban', 'brazilian',
    'peruvian', 'ramen', 'noodles', 'steak', 'steakhouse', 'dim sum',
  ];

  const foundCuisines = cuisines.filter(c => lower.includes(c));
  if (foundCuisines.length > 0) {
    result.cuisines = foundCuisines;
  }

  // Cuisine dislikes
  const dislikePatterns = /\b(don't like|hate|dislike|no)\s+(\w+)/gi;
  const dislikes: string[] = [];
  let dislikeMatch;
  while ((dislikeMatch = dislikePatterns.exec(lower)) !== null) {
    const food = dislikeMatch[2];
    if (cuisines.includes(food)) {
      dislikes.push(food);
    }
  }
  if (dislikes.length > 0) {
    result.cuisineDislikes = dislikes;
  }

  // Price detection
  if (/\b(cheap|budget|affordable|inexpensive|low cost)\b/.test(lower)) {
    result.price = '$';
  } else if (/\b(moderate|mid-range|reasonable)\b/.test(lower)) {
    result.price = '$$';
  } else if (/\b(nice|upscale|fancy)\b/.test(lower)) {
    result.price = '$$$';
  } else if (/\b(expensive|luxury|splurge|high-end)\b/.test(lower)) {
    result.price = '$$$$';
  }

  // Location detection
  const locations = [
    'downtown', 'midtown', 'uptown', 'north york', 'scarborough',
    'etobicoke', 'mississauga', 'yorkville', 'queen west', 'king west',
    'liberty village', 'distillery', 'kensington', 'chinatown',
    'little italy', 'greektown', 'koreatown', 'annex',
  ];
  const foundLocations = locations.filter(l => lower.includes(l));
  if (foundLocations.length > 0) {
    result.location = foundLocations;
  }

  // Ambiance detection
  const ambianceMap: Record<string, string> = {
    casual: 'casual',
    relaxed: 'casual',
    chill: 'casual',
    upscale: 'upscale',
    fancy: 'upscale',
    elegant: 'upscale',
    trendy: 'trendy',
    hip: 'trendy',
    quiet: 'quiet',
    intimate: 'quiet',
    romantic: 'quiet',
    lively: 'lively',
    fun: 'lively',
    energetic: 'lively',
  };
  const foundAmbiance: string[] = [];
  for (const [word, category] of Object.entries(ambianceMap)) {
    if (lower.includes(word) && !foundAmbiance.includes(category)) {
      foundAmbiance.push(category);
    }
  }
  if (foundAmbiance.length > 0) {
    result.ambiance = foundAmbiance;
  }

  // Negation detection
  const negationPattern = /\b(no|don't want|not|avoid|skip|hate)\s+(\w+)/gi;
  const negations: string[] = [];
  let negMatch;
  while ((negMatch = negationPattern.exec(lower)) !== null) {
    negations.push(negMatch[2]);
  }
  if (negations.length > 0) {
    result.negations = negations;
  }

  return result;
}

/**
 * Determine if a message needs API extraction (complex/ambiguous)
 */
export function needsAPIExtraction(message: string, localResult: ExtractedPreferences): boolean {
  // If local extraction found dietary restrictions, probably don't need API
  const hasDietary = (localResult.dietary?.length || 0) > 0;
  const hasCuisines = (localResult.cuisines?.length || 0) > 0;
  const hasPrice = !!localResult.price;

  const foundSomething = hasDietary || hasCuisines || hasPrice;

  // Long/complex messages might need API for nuance
  const wordCount = message.split(/\s+/).length;
  const isLong = wordCount > 20;

  // Complex language patterns that local extraction might miss
  const hasComplexity = /\b(but|except|unless|if|maybe|sometimes|prefer|rather|depends)\b/i.test(message);

  // Questions about restaurants might need API understanding
  const isQuestion = message.includes('?');

  // If we found nothing locally and message is substantial, use API
  if (!foundSomething && wordCount > 5) return true;

  // If complex language, use API for better understanding
  if (hasComplexity && isLong) return true;

  return false;
}

// ============================================
// Profile Update Logic
// ============================================

/**
 * Update a user profile with newly extracted preferences
 */
export function updateProfile(
  currentProfile: StructuredUserProfile,
  extracted: ExtractedPreferences
): StructuredUserProfile {
  const updated = JSON.parse(JSON.stringify(currentProfile)) as StructuredUserProfile;
  const now = Date.now();

  // Update dietary restrictions
  if (extracted.dietary && extracted.dietary.length > 0) {
    for (const restriction of extracted.dietary) {
      const existing = updated.dietary.restrictions.find(r => r.type === restriction.type);
      if (existing) {
        // Reinforce existing - upgrade to strict if mentioned again
        if (restriction.strictness === 'strict') {
          existing.strictness = 'strict';
        }
        updated.confidence.dietary = Math.min(1, updated.confidence.dietary + 0.15);
      } else {
        // Add new restriction
        updated.dietary.restrictions.push({
          ...restriction,
          since: now,
        });
        updated.confidence.dietary = Math.max(updated.confidence.dietary, 0.6);
      }
    }
  }

  // Update allergies
  if (extracted.allergies) {
    for (const allergy of extracted.allergies) {
      if (!updated.dietary.allergies.includes(allergy)) {
        updated.dietary.allergies.push(allergy);
      }
    }
    updated.confidence.dietary = Math.min(1, updated.confidence.dietary + 0.2);
  }

  // Update cuisine preferences
  if (extracted.cuisines && extracted.cuisines.length > 0) {
    for (const cuisine of extracted.cuisines) {
      const existing = updated.cuisinePreferences.favorites.find(
        c => c.cuisine.toLowerCase() === cuisine.toLowerCase()
      );
      if (existing) {
        existing.score = Math.min(10, existing.score + 1.5);
        existing.frequency += 1;
        existing.lastMentioned = now;
      } else {
        updated.cuisinePreferences.favorites.push({
          cuisine,
          score: 6, // Start at moderate preference
          lastMentioned: now,
          frequency: 1,
        });
      }
    }
    // Sort by score and keep top 10
    updated.cuisinePreferences.favorites.sort((a, b) => b.score - a.score);
    updated.cuisinePreferences.favorites = updated.cuisinePreferences.favorites.slice(0, 10);
    updated.confidence.cuisine = Math.min(1, updated.confidence.cuisine + 0.1);
  }

  // Update cuisine dislikes
  if (extracted.cuisineDislikes) {
    for (const dislike of extracted.cuisineDislikes) {
      if (!updated.cuisinePreferences.dislikes.includes(dislike)) {
        updated.cuisinePreferences.dislikes.push(dislike);
      }
    }
  }

  // Update budget
  if (extracted.price) {
    updated.budget.preferred = extracted.price;
    updated.confidence.budget = Math.min(1, updated.confidence.budget + 0.2);
  }

  // Update location
  if (extracted.location && extracted.location.length > 0) {
    for (const loc of extracted.location) {
      if (!updated.location.preferredAreas.includes(loc)) {
        updated.location.preferredAreas.push(loc);
      }
    }
    updated.confidence.location = Math.min(1, updated.confidence.location + 0.15);
  }

  // Update ambiance
  if (extracted.ambiance) {
    for (const amb of extracted.ambiance) {
      const validAmbiance = amb as 'casual' | 'upscale' | 'trendy' | 'quiet' | 'lively';
      if (!updated.diningStyle.preferredAmbiance.includes(validAmbiance)) {
        updated.diningStyle.preferredAmbiance.push(validAmbiance);
      }
    }
  }

  // Apply time decay to cuisine preferences
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const decayRate = 0.95;
  for (const pref of updated.cuisinePreferences.favorites) {
    const weeksOld = (now - pref.lastMentioned) / weekMs;
    if (weeksOld > 1) {
      pref.score *= Math.pow(decayRate, weeksOld);
    }
  }
  // Remove very low scored preferences
  updated.cuisinePreferences.favorites = updated.cuisinePreferences.favorites.filter(
    p => p.score > 1
  );

  // Update history
  updated.history.lastUpdated = now;
  updated.history.totalInteractions += 1;

  // Update overall confidence
  updated.confidence.overall =
    (updated.confidence.dietary +
      updated.confidence.cuisine +
      updated.confidence.budget +
      updated.confidence.location) / 4;

  return updated;
}

// ============================================
// localStorage Persistence
// ============================================

/**
 * Load profiles from localStorage
 */
export function loadProfiles(): Record<string, StructuredUserProfile> {
  if (typeof window === 'undefined') return {};

  try {
    // Try new format first
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }

    // Try migrating from legacy format
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      const legacyData = JSON.parse(legacy) as Record<string, LegacyUserMemory>;
      const migrated = migrateLegacyProfiles(legacyData);
      saveProfiles(migrated);
      return migrated;
    }

    return {};
  } catch {
    return {};
  }
}

/**
 * Save profiles to localStorage
 */
export function saveProfiles(profiles: Record<string, StructuredUserProfile>): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
}

/**
 * Migrate legacy profile format to new structured format
 */
function migrateLegacyProfiles(
  legacy: Record<string, LegacyUserMemory>
): Record<string, StructuredUserProfile> {
  const userColors: Record<string, string> = {
    u1: 'bg-green-100 border-green-300',
    u2: 'bg-blue-100 border-blue-300',
    u3: 'bg-yellow-100 border-yellow-300',
    u4: 'bg-purple-100 border-purple-300',
  };

  const userNames: Record<string, string> = {
    u1: 'Aisha',
    u2: 'John',
    u3: 'Josh',
    u4: 'Kate',
  };

  const migrated: Record<string, StructuredUserProfile> = {};

  for (const [userId, legacyMem] of Object.entries(legacy)) {
    const profile = createEmptyProfile(
      userId,
      userNames[userId] || 'Unknown',
      userColors[userId] || 'bg-gray-100 border-gray-300'
    );

    // Migrate dietary restrictions
    if (legacyMem.dietaryRestrictions) {
      for (const diet of legacyMem.dietaryRestrictions) {
        profile.dietary.restrictions.push({
          type: diet as DietaryType,
          strictness: 'strict',
        });
      }
      profile.confidence.dietary = 0.7;
    }

    // Migrate cuisine preferences
    if (legacyMem.favoriteCuisines) {
      for (const cuisine of legacyMem.favoriteCuisines) {
        profile.cuisinePreferences.favorites.push({
          cuisine,
          score: 7,
          lastMentioned: legacyMem.lastUpdated || Date.now(),
          frequency: 1,
        });
      }
      profile.confidence.cuisine = 0.5;
    }

    // Migrate price preference
    if (legacyMem.pricePreference) {
      const priceMap: Record<string, '$' | '$$' | '$$$' | '$$$$'> = {
        budget: '$',
        moderate: '$$',
        upscale: '$$$',
      };
      profile.budget.preferred = priceMap[legacyMem.pricePreference] || '$$';
      profile.confidence.budget = 0.5;
    }

    // Migrate location preference
    if (legacyMem.locationPreference) {
      profile.location.preferredAreas.push(legacyMem.locationPreference);
      profile.confidence.location = 0.5;
    }

    profile.history.lastUpdated = legacyMem.lastUpdated || Date.now();
    profile.confidence.overall =
      (profile.confidence.dietary +
        profile.confidence.cuisine +
        profile.confidence.budget +
        profile.confidence.location) / 4;

    migrated[userId] = profile;
  }

  return migrated;
}

/**
 * Get a profile or create empty one if doesn't exist
 */
export function getOrCreateProfile(
  profiles: Record<string, StructuredUserProfile>,
  userId: string,
  userName: string,
  userColor: string
): StructuredUserProfile {
  if (profiles[userId]) {
    return profiles[userId];
  }
  return createEmptyProfile(userId, userName, userColor);
}

/**
 * Generate a human-readable summary of a profile
 */
export function getProfileSummary(profile: StructuredUserProfile): string {
  const parts: string[] = [];

  // Dietary
  if (profile.dietary.restrictions.length > 0) {
    const restrictions = profile.dietary.restrictions.map(r =>
      r.strictness === 'strict' ? r.type.toUpperCase() : r.type
    );
    parts.push(restrictions.join(', '));
  }

  // Allergies
  if (profile.dietary.allergies.length > 0) {
    parts.push(`allergic to ${profile.dietary.allergies.join(', ')}`);
  }

  // Cuisines
  if (profile.cuisinePreferences.favorites.length > 0) {
    const top3 = profile.cuisinePreferences.favorites.slice(0, 3).map(c => c.cuisine);
    parts.push(`likes ${top3.join(', ')}`);
  }

  // Budget
  if (profile.budget.preferred) {
    const priceLabels: Record<string, string> = {
      $: 'budget-friendly',
      $$: 'moderate',
      $$$: 'upscale',
      $$$$: 'luxury',
    };
    parts.push(priceLabels[profile.budget.preferred] || profile.budget.preferred);
  }

  // Location
  if (profile.location.preferredAreas.length > 0) {
    parts.push(`prefers ${profile.location.preferredAreas[0]}`);
  }

  return parts.length > 0 ? parts.join(' • ') : 'No preferences saved yet';
}
