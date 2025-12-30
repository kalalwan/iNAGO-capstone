import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { RESTAURANTS } from '@/lib/data';
import { cosineSimilarity } from '@/lib/utils';
import {
  selectBestRestaurant,
  calculateGroupFairness,
  createEmptyProfile,
} from '@/lib/fairness';
import { getProfileSummary } from '@/lib/profile-utils';
import {
  StructuredUserProfile,
  FairnessMode,
  ScoredRestaurant,
  FairnessResult,
} from '@/lib/types';

// Cache for restaurant embeddings (persists across requests in serverless)
let restaurantEmbeddingsCache: { id: string; embedding: number[] }[] | null = null;

// Try to load pre-computed embeddings
async function loadPrecomputedEmbeddings(): Promise<{ id: string; embedding: number[] }[] | null> {
  try {
    // In production, embeddings would be loaded from a file or database
    // For now, we'll compute them on first request and cache
    return null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const {
    preferences,
    messages,
    userProfiles,
    fairnessMode = 'balanced'
  } = await req.json();

  // Convert profiles to StructuredUserProfile format
  const profiles: StructuredUserProfile[] = [];
  if (userProfiles && typeof userProfiles === 'object') {
    for (const [userId, profile] of Object.entries(userProfiles)) {
      if (profile && typeof profile === 'object' && 'name' in (profile as object)) {
        profiles.push(profile as StructuredUserProfile);
      }
    }
  }

  // If no profiles, create minimal ones from preferences
  if (profiles.length === 0 && preferences) {
    for (const [userName, pref] of Object.entries(preferences)) {
      const profile = createEmptyProfile(
        userName.toLowerCase().replace(/\s+/g, '-'),
        userName,
        'bg-gray-100 border-gray-300'
      );
      // Add any dietary info we can extract from preference string
      if (typeof pref === 'string' && pref.toLowerCase().includes('vegan')) {
        profile.dietary.restrictions.push({ type: 'vegan', strictness: 'strict' });
      }
      profiles.push(profile);
    }
  }

  // 1. Synthesize a "Group Query" from profiles
  const profileSummaries = profiles.map(p => getProfileSummary(p)).join(' ');
  const currentPrefs = Object.values(preferences || {}).join(' ');
  const groupQuery = `${currentPrefs} ${profileSummaries}`.trim() || 'good restaurant toronto';

  try {
    // 2. Embed the Group Query
    const queryEmbeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: groupQuery,
    });
    const queryVector = queryEmbeddingResponse.data[0].embedding;

    // 3. Get or compute restaurant embeddings
    if (!restaurantEmbeddingsCache) {
      // Try loading pre-computed
      restaurantEmbeddingsCache = await loadPrecomputedEmbeddings();

      if (!restaurantEmbeddingsCache) {
        console.log('Computing embeddings for', RESTAURANTS.length, 'restaurants...');

        const restaurantTexts = RESTAURANTS.map(rest =>
          `${rest.name} ${rest.cuisine} ${rest.description} ${rest.price} ${rest.location} ${rest.tags.join(' ')}`
        );

        const batchEmbeddingResponse = await openai.embeddings.create({
          model: "text-embedding-3-small",
          input: restaurantTexts,
        });

        restaurantEmbeddingsCache = RESTAURANTS.map((rest, idx) => ({
          id: rest.id,
          embedding: batchEmbeddingResponse.data[idx].embedding,
        }));

        console.log('Embeddings cached for', restaurantEmbeddingsCache.length, 'restaurants');
      }
    }

    // 4. Score all restaurants using cosine similarity
    const scoredRestaurants: ScoredRestaurant[] = RESTAURANTS.map((rest, idx) => {
      const embedding = restaurantEmbeddingsCache![idx].embedding;
      return {
        ...rest,
        score: cosineSimilarity(queryVector, embedding)
      };
    });

    // 5. Retrieve Top Candidates (expanded pool for fairness filtering)
    const topCandidates = scoredRestaurants
      .sort((a, b) => b.score - a.score)
      .slice(0, 15); // Get more candidates for fairness analysis

    // 6. Apply Mathematical Fairness Scoring
    let fairnessResult: FairnessResult | null = null;
    let candidatesWithFairness: ScoredRestaurant[] = topCandidates;

    if (profiles.length > 0) {
      // Calculate fairness for all candidates
      candidatesWithFairness = topCandidates.map(restaurant => {
        const { metrics, userSatisfaction } = calculateGroupFairness(restaurant, profiles);
        return {
          ...restaurant,
          fairnessMetrics: metrics,
          userSatisfaction,
        };
      });

      // Select best using fairness algorithm
      fairnessResult = selectBestRestaurant(
        topCandidates,
        profiles,
        fairnessMode as FairnessMode
      );
    }

    // 7. Build enhanced response with fairness data
    const topForDisplay = candidatesWithFairness.slice(0, 6);

    // 8. Generate LLM explanation (optional enhancement)
    const conversationText = messages.map((m: { userName: string; text: string }) =>
      `${m.userName}: ${m.text}`
    ).join('\n');

    let llmExplanation = '';
    if (fairnessResult) {
      // Use shorter prompt when we have fairness data
      const reasoningPrompt = `
        You are a Group Dining Recommender for Toronto.

        Based on the fairness analysis, we've selected: ${fairnessResult.restaurant.name}

        The Group Conversation:
        ${conversationText}

        User Profiles:
        ${profiles.map(p => `${p.name}: ${getProfileSummary(p)}`).join('\n')}

        Fairness Metrics:
        - Average satisfaction: ${(fairnessResult.metrics.utilitarian * 100).toFixed(0)}%
        - Minimum satisfaction: ${(fairnessResult.metrics.egalitarian * 100).toFixed(0)}%
        - Inequality: ${(fairnessResult.metrics.gini * 100).toFixed(0)}%

        Per-person satisfaction:
        ${fairnessResult.userSatisfaction.map(u => `- ${u.userName}: ${(u.score * 100).toFixed(0)}%`).join('\n')}

        Provide a brief (2-3 sentence) explanation of why this restaurant is a good choice for the group.
        Focus on how it accommodates everyone's needs. Include the address.
      `;

      try {
        const finalRecResponse = await openai.chat.completions.create({
          model: "gpt-4-turbo",
          messages: [{ role: "system", content: reasoningPrompt }],
          max_tokens: 300,
        });
        llmExplanation = finalRecResponse.choices[0].message.content || '';
      } catch (error) {
        console.error('LLM explanation error:', error);
        // Fall back to generated explanation
        llmExplanation = fairnessResult.explanation;
      }
    } else {
      // No profiles - use original LLM approach
      const reasoningPrompt = `
        You are a Group Dining Recommender for Toronto restaurants.

        The Group Conversation:
        ${conversationText}

        Current Session Preferences:
        ${JSON.stringify(preferences, null, 2)}

        Top Retrieved Candidates:
        ${JSON.stringify(topForDisplay.map(r => ({
          name: r.name,
          cuisine: r.cuisine,
          price: r.price,
          rating: r.rating,
          location: r.location,
          address: r.address,
          tags: r.tags.slice(0, 5),
          matchScore: (r.score * 100).toFixed(1) + '%'
        })), null, 2)}

        Select the ONE best restaurant and explain why. Be concise (3-4 sentences).
        Include the address and practical details.
      `;

      const finalRecResponse = await openai.chat.completions.create({
        model: "gpt-4-turbo",
        messages: [{ role: "system", content: reasoningPrompt }],
        max_tokens: 400,
      });

      llmExplanation = finalRecResponse.choices[0].message.content || '';
    }

    // Combine fairness explanation with LLM explanation
    const fullRecommendation = fairnessResult
      ? `${fairnessResult.explanation}\n\n---\n\n${llmExplanation}`
      : llmExplanation;

    return NextResponse.json({
      candidates: topForDisplay.slice(0, 4).map(r => ({
        id: r.id,
        name: r.name,
        cuisine: r.cuisine,
        price: r.price,
        rating: r.rating,
        location: r.location,
        address: r.address,
        score: r.score,
        fairnessMetrics: r.fairnessMetrics,
        userSatisfaction: r.userSatisfaction,
      })),
      recommendation: fullRecommendation,
      totalRestaurants: RESTAURANTS.length,
      fairnessResult: fairnessResult ? {
        restaurantId: fairnessResult.restaurant.id,
        restaurantName: fairnessResult.restaurant.name,
        metrics: fairnessResult.metrics,
        userSatisfaction: fairnessResult.userSatisfaction,
        isParetoEfficient: fairnessResult.isParetoEfficient,
      } : null,
      mode: fairnessMode,
    });

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Recommendation failed" }, { status: 500 });
  }
}
