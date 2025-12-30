// ============================================
// Core Message Types
// ============================================

export interface Message {
  id: string;
  userId: string;
  userName: string;
  text: string;
  timestamp: number;
}

// ============================================
// Restaurant Types
// ============================================

export interface Restaurant {
  id: string;
  name: string;
  cuisine: string;
  price: string;
  rating: number;
  reviewCount: number;
  description: string;
  location: string;
  address: string;
  phone: string;
  website: string;
  yelp_url: string;
  tags: string[];
  images: string[];
  lat: number;
  lon: number;
}

export interface RestaurantWithEmbedding extends Restaurant {
  embedding: number[];
}

export interface ScoredRestaurant extends Restaurant {
  score: number;
  userSatisfaction?: UserSatisfactionResult[];
  fairnessMetrics?: GroupFairnessMetrics;
}

// ============================================
// Constraint Types
// ============================================

export type DietaryType =
  | 'vegan'
  | 'vegetarian'
  | 'pescatarian'
  | 'gluten-free'
  | 'dairy-free'
  | 'keto'
  | 'halal'
  | 'kosher'
  | 'nut-free'
  | 'other';

export type ConstraintStrictness = 'strict' | 'flexible';

export interface DietaryRestriction {
  type: DietaryType;
  strictness: ConstraintStrictness;
  since?: number; // timestamp when they started this diet
}

export interface HardConstraint {
  type: 'dietary' | 'allergy' | 'accessibility';
  value: string;
  reason?: string;
}

export interface SoftConstraint {
  type: 'cuisine' | 'price' | 'location' | 'ambiance';
  value: string;
  weight: number; // 1-5 importance scale
}

export interface BonusConstraint {
  type: 'parking' | 'outdoor' | 'reservation' | 'late-night';
  value: boolean;
}

export interface UserConstraints {
  hard: HardConstraint[];
  soft: SoftConstraint[];
  bonus: BonusConstraint[];
}

// ============================================
// Cuisine Preference Types
// ============================================

export interface CuisinePreference {
  cuisine: string;
  score: number; // 1-10 preference strength
  lastMentioned: number; // timestamp
  frequency: number; // how often they mention it
}

// ============================================
// Structured User Profile
// ============================================

export interface StructuredUserProfile {
  id: string;
  name: string;
  color: string;

  // Dietary & Health (Hard Constraints)
  dietary: {
    restrictions: DietaryRestriction[];
    allergies: string[];
    religious: 'halal' | 'kosher' | null;
    medicalConditions: string[];
  };

  // Cuisine Preferences (Soft Constraints)
  cuisinePreferences: {
    favorites: CuisinePreference[];
    dislikes: string[];
    adventurousness: number; // 1-5 scale
  };

  // Budget (Soft Constraint)
  budget: {
    preferred: '$' | '$$' | '$$$' | '$$$$' | null;
    maxAcceptable: '$' | '$$' | '$$$' | '$$$$' | null;
    flexibility: number; // 1-5 how flexible on price
  };

  // Location (Soft Constraint)
  location: {
    preferredAreas: string[];
    maxDistance: number; // km
    hasTransportation: boolean;
  };

  // Dining Style (Bonus)
  diningStyle: {
    preferredAmbiance: ('casual' | 'upscale' | 'trendy' | 'quiet' | 'lively')[];
    groupSizePreference: 'intimate' | 'medium' | 'large' | null;
    timePreference: 'lunch' | 'dinner' | 'late-night' | 'any';
  };

  // Historical Data
  history: {
    visitedRestaurants: string[];
    ratings: Record<string, number>;
    lastUpdated: number;
    totalInteractions: number;
  };

  // Confidence Scores (0-1)
  confidence: {
    dietary: number;
    cuisine: number;
    budget: number;
    location: number;
    overall: number;
  };
}

// ============================================
// Fairness Types
// ============================================

export interface UserSatisfactionResult {
  userId: string;
  userName: string;
  score: number; // 0-1
  satisfied: boolean; // false if hard constraint violated
  breakdown: {
    hardConstraintsMet: boolean;
    hardFailure?: HardConstraint;
    softScores: Record<string, number>;
    bonusScore: number;
  };
}

export interface GroupFairnessMetrics {
  utilitarian: number;  // Average satisfaction (sum / n)
  egalitarian: number;  // Minimum satisfaction (Rawlsian)
  nash: number;         // Geometric mean (Nash welfare)
  gini: number;         // Inequality measure (0 = equal, 1 = unequal)
}

export type FairnessMode = 'utilitarian' | 'egalitarian' | 'balanced';

export interface FairnessResult {
  restaurant: Restaurant;
  metrics: GroupFairnessMetrics;
  userSatisfaction: UserSatisfactionResult[];
  explanation: string;
  isParetoEfficient: boolean;
}

// ============================================
// Extracted Preferences (from chat)
// ============================================

export interface ExtractedPreferences {
  dietary?: DietaryRestriction[];
  allergies?: string[];
  cuisines?: string[];
  cuisineDislikes?: string[];
  price?: '$' | '$$' | '$$$' | '$$$$';
  location?: string[];
  ambiance?: string[];
  negations?: string[]; // things they explicitly don't want
}

// ============================================
// Legacy Types (for backwards compatibility)
// ============================================

export interface UserProfile {
  id: string;
  name: string;
  color: string;
  preferences: string[];
}

// Old memory format (for migration)
export interface LegacyUserMemory {
  preferences: string;
  dietaryRestrictions: string[];
  favoriteCuisines: string[];
  pricePreference: string;
  locationPreference: string;
  lastUpdated: number;
}
