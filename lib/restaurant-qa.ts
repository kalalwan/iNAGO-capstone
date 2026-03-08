/**
 * Restaurant Q&A Module
 *
 * Detects user questions about restaurants and answers them
 * using the restaurant data, without requiring an API call.
 */

import { Restaurant, ScoredRestaurant, FairnessResult } from './types';

interface RecommendationContext {
  candidates: ScoredRestaurant[];
  recommendation: string;
  fairnessResult: FairnessResult;
}

export function detectQuestion(message: string): boolean {
  const lower = message.toLowerCase().trim();

  // Starts with question words
  if (/^(does|is|how|what|where|can|do|are|which|will|would|could|should)\b/.test(lower)) {
    return true;
  }

  // Contains a question mark
  if (lower.includes('?')) {
    return true;
  }

  // Implicit questions
  if (/\b(tell me about|what about|how about|info on|details on)\b/.test(lower)) {
    return true;
  }

  return false;
}

export function answerQuestion(
  message: string,
  restaurants: Restaurant[],
  recentRecommendation: RecommendationContext | null
): string | null {
  const lower = message.toLowerCase().trim();

  // Try to find which restaurant the question is about
  const restaurant = resolveRestaurant(lower, restaurants, recentRecommendation);

  if (!restaurant) {
    // Generic questions not about a specific restaurant
    if (/\b(how many|how much)\b.*\b(restaurant|option|choice)/.test(lower)) {
      return `We have ${restaurants.length} Toronto restaurants in our database to choose from!`;
    }
    return null;
  }

  // Price questions
  if (/\b(price|cost|expensive|cheap|afford|budget|how much)\b/.test(lower)) {
    const priceLabels: Record<string, string> = {
      '$': 'budget-friendly (under $15)',
      '$$': 'moderate ($15-30)',
      '$$$': 'upscale ($30-60)',
      '$$$$': 'fine dining ($60+)',
    };
    return `${restaurant.name} is ${priceLabels[restaurant.price] || restaurant.price}. It has a ${restaurant.rating}/5 rating from ${restaurant.reviewCount} reviews.`;
  }

  // Distance / location questions
  if (/\b(far|distance|close|near|where|location|address|drive|walk)\b/.test(lower)) {
    return `${restaurant.name} is located at ${restaurant.address} in ${restaurant.location}. You can find directions on their website.`;
  }

  // Cuisine / food type questions
  if (/\b(what kind|what type|cuisine|food|serve|menu|what do they)\b/.test(lower)) {
    const tagStr = restaurant.tags.length > 0 ? ` Known for: ${restaurant.tags.slice(0, 5).join(', ')}.` : '';
    return `${restaurant.name} serves ${restaurant.cuisine} cuisine.${tagStr}`;
  }

  // Rating / quality questions
  if (/\b(good|rating|review|worth|recommend|popular)\b/.test(lower)) {
    const quality = restaurant.rating >= 4.5 ? 'excellent' :
                    restaurant.rating >= 4 ? 'very good' :
                    restaurant.rating >= 3.5 ? 'good' : 'decent';
    return `${restaurant.name} has a ${quality} rating of ${restaurant.rating}/5 based on ${restaurant.reviewCount} reviews.`;
  }

  // Feature / tag questions (parking, outdoor, etc.)
  if (/\b(parking|outdoor|patio|reservation|delivery|takeout|vegetarian|vegan|gluten)\b/.test(lower)) {
    const feature = lower.match(/\b(parking|outdoor|patio|reservation|delivery|takeout|vegetarian|vegan|gluten[\s-]?free)\b/)?.[0];
    if (feature) {
      const tags = restaurant.tags.map(t => t.toLowerCase());
      const desc = restaurant.description.toLowerCase();
      const hasFeature = tags.some(t => t.includes(feature)) || desc.includes(feature);

      if (hasFeature) {
        return `Yes, ${restaurant.name} appears to offer ${feature} based on their profile.`;
      } else {
        return `I don't see ${feature} specifically listed for ${restaurant.name}. You might want to check their website or call them directly: ${restaurant.phone || 'phone not available'}.`;
      }
    }
  }

  // General "tell me about" / "what about"
  if (/\b(tell me|what about|info|details)\b/.test(lower)) {
    return `${restaurant.name} (${restaurant.cuisine}) — ${restaurant.price}, ${restaurant.rating}/5 from ${restaurant.reviewCount} reviews. Located at ${restaurant.address} in ${restaurant.location}.${restaurant.description ? ` ${restaurant.description.slice(0, 150)}...` : ''}`;
  }

  // If we identified a restaurant but can't answer the specific question
  return `I found ${restaurant.name} but I'm not sure about that specific detail. You can check their website${restaurant.website ? ` at ${restaurant.website}` : ''} or Yelp page for more info.`;
}

function resolveRestaurant(
  lower: string,
  restaurants: Restaurant[],
  recentRecommendation: RecommendationContext | null,
): Restaurant | null {
  // Check for explicit restaurant name mention
  for (const r of restaurants) {
    if (lower.includes(r.name.toLowerCase())) {
      return r;
    }
  }

  // Check for partial name matches (first word of name)
  for (const r of restaurants) {
    const firstName = r.name.toLowerCase().split(/\s+/)[0];
    if (firstName.length > 3 && lower.includes(firstName)) {
      return r;
    }
  }

  // Pronoun references — "that place", "the restaurant", "it", "this one"
  if (/\b(that place|the restaurant|this place|this one|that one|the place|it)\b/.test(lower)) {
    if (recentRecommendation?.fairnessResult?.restaurant) {
      return recentRecommendation.fairnessResult.restaurant;
    }
    if (recentRecommendation?.candidates && recentRecommendation.candidates.length > 0) {
      return recentRecommendation.candidates[0];
    }
  }

  return null;
}
