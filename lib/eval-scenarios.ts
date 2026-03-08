/**
 * Evaluation Scenarios
 *
 * Pre-defined test scenarios for evaluating the fairness system.
 */

import { StructuredUserProfile, DietaryRestriction } from './types';
import { createEmptyProfile } from './fairness';

export interface EvalScenario {
  name: string;
  description: string;
  users: EvalUser[];
  expectedBehavior: string;
}

interface EvalUser {
  name: string;
  dietary?: DietaryRestriction[];
  allergies?: string[];
  cuisines?: string[];
  cuisineDislikes?: string[];
  budget?: '$' | '$$' | '$$$' | '$$$$';
  location?: string[];
  ambiance?: ('casual' | 'upscale' | 'trendy' | 'quiet' | 'lively')[];
}

export function buildProfileFromEvalUser(user: EvalUser, index: number): StructuredUserProfile {
  const colors = ['#22c55e', '#3b82f6', '#eab308', '#a855f7', '#ef4444', '#06b6d4'];
  const profile = createEmptyProfile(
    `eval-${index}`,
    user.name,
    colors[index % colors.length]
  );

  if (user.dietary) {
    profile.dietary.restrictions = user.dietary;
    profile.confidence.dietary = 0.8;
  }

  if (user.allergies) {
    profile.dietary.allergies = user.allergies;
    profile.confidence.dietary = Math.max(profile.confidence.dietary, 0.8);
  }

  if (user.cuisines) {
    profile.cuisinePreferences.favorites = user.cuisines.map((c, i) => ({
      cuisine: c,
      score: 8 - i, // Decreasing preference
      lastMentioned: Date.now(),
      frequency: 1,
    }));
    profile.confidence.cuisine = 0.8;
  }

  if (user.cuisineDislikes) {
    profile.cuisinePreferences.dislikes = user.cuisineDislikes;
  }

  if (user.budget) {
    profile.budget.preferred = user.budget;
    profile.confidence.budget = 0.8;
  }

  if (user.location) {
    profile.location.preferredAreas = user.location;
    profile.confidence.location = 0.7;
  }

  if (user.ambiance) {
    profile.diningStyle.preferredAmbiance = user.ambiance;
  }

  profile.confidence.overall =
    (profile.confidence.dietary +
      profile.confidence.cuisine +
      profile.confidence.budget +
      profile.confidence.location) / 4;

  return profile;
}

export const scenarios: EvalScenario[] = [
  {
    name: "Vegan + BBQ Lover",
    description: "Competing Hard Constraints",
    users: [
      {
        name: "Alice",
        dietary: [{ type: 'vegan', strictness: 'strict' }],
        cuisines: ['thai', 'indian'],
      },
      {
        name: "Bob",
        cuisines: ['bbq', 'steakhouse', 'american'],
        budget: '$$',
      },
    ],
    expectedBehavior: "Should find a restaurant satisfying vegan hard constraint that also has BBQ-adjacent options or diverse menu",
  },
  {
    name: "All Users Agree",
    description: "Easy Case — Everyone wants Italian",
    users: [
      { name: "A", cuisines: ['italian'] },
      { name: "B", cuisines: ['italian'] },
      { name: "C", cuisines: ['italian'], budget: '$$' },
    ],
    expectedBehavior: "Should recommend an affordable Italian restaurant with high utilitarian score",
  },
  {
    name: "Budget Extremes",
    description: "One wants $, another wants $$$$",
    users: [
      { name: "Cheap Charlie", budget: '$', cuisines: ['chinese', 'thai'] },
      { name: "Fancy Fiona", budget: '$$$$', cuisines: ['french', 'japanese'] },
    ],
    expectedBehavior: "Nash welfare should favor a moderate middle-ground option ($$)",
  },
  {
    name: "Single User",
    description: "Degenerate group case — solo diner",
    users: [
      {
        name: "Solo",
        cuisines: ['japanese', 'ramen'],
        budget: '$$',
      },
    ],
    expectedBehavior: "Should recommend best Japanese/ramen match; fairness metrics are trivially perfect",
  },
  {
    name: "Six Diverse Users",
    description: "Large group with very different preferences",
    users: [
      { name: "Vegan Val", dietary: [{ type: 'vegan', strictness: 'strict' }] },
      { name: "Meat Mike", cuisines: ['steakhouse', 'bbq'] },
      { name: "Budget Ben", budget: '$' },
      { name: "Fancy Fran", budget: '$$$$', ambiance: ['upscale'] as ('upscale')[] },
      { name: "Downtown Dan", location: ['downtown'] },
      { name: "Asian Amy", cuisines: ['chinese', 'japanese', 'thai'] },
    ],
    expectedBehavior: "Should handle 6+ users; Nash welfare will penalize options that leave anyone at 0",
  },
  {
    name: "Allergy Safety",
    description: "Nut allergy is a strict hard constraint",
    users: [
      {
        name: "Nut-Free Nancy",
        allergies: ['peanut'],
        cuisines: ['italian', 'mediterranean'],
      },
      {
        name: "Open Oliver",
        cuisines: ['thai', 'italian'],
        budget: '$$',
      },
    ],
    expectedBehavior: "Should not recommend restaurants that mention nuts/peanuts; hard constraint must be satisfied",
  },
  {
    name: "Same Cuisine, Different Locations",
    description: "Both want sushi but in different areas",
    users: [
      { name: "North Nina", cuisines: ['sushi', 'japanese'], location: ['north york'] },
      { name: "West Will", cuisines: ['sushi', 'japanese'], location: ['queen west'] },
    ],
    expectedBehavior: "Should find a Japanese/sushi restaurant accessible to both; location is a soft constraint",
  },
  {
    name: "Halal Requirement",
    description: "Religious dietary constraint + preferences",
    users: [
      {
        name: "Halal Hassan",
        dietary: [{ type: 'halal', strictness: 'strict' }],
        cuisines: ['middle eastern', 'indian'],
        budget: '$$',
      },
      {
        name: "Flexible Felix",
        cuisines: ['mediterranean', 'indian'],
        budget: '$$',
      },
    ],
    expectedBehavior: "Must satisfy halal hard constraint; Indian/Mediterranean overlap should score well",
  },
  {
    name: "Nash vs Utilitarian",
    description: "Scenario where Nash and utilitarian select differently",
    users: [
      {
        name: "Passionate Pat",
        cuisines: ['korean'],
        budget: '$',
      },
      {
        name: "Mild Mary",
        cuisines: ['american', 'italian', 'chinese'],
        budget: '$$',
      },
      {
        name: "Meh Mike",
        cuisines: ['american', 'italian'],
        budget: '$$',
      },
    ],
    expectedBehavior: "Nash should avoid options where one user has very low satisfaction even if average is higher",
  },
  {
    name: "Gluten-Free + Pizza Lover",
    description: "Hard constraint conflicts with a cuisine preference",
    users: [
      {
        name: "GF Grace",
        dietary: [{ type: 'gluten-free', strictness: 'strict' }],
        cuisines: ['salad', 'seafood'],
      },
      {
        name: "Pizza Pete",
        cuisines: ['italian', 'pizza'],
        budget: '$$',
      },
    ],
    expectedBehavior: "Should find Italian/pizza place with gluten-free options, or a compromise cuisine",
  },
];
