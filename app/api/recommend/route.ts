import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { RESTAURANTS } from '@/lib/data';
import {
  selectBestRestaurant,
  calculateGroupFairness,
  createEmptyProfile,
} from '@/lib/fairness';
import { getProfileSummary } from '@/lib/profile-utils';
import {
  StructuredUserProfile,
  ScoredRestaurant,
  FairnessResult,
} from '@/lib/types';
import {
  hybridRetrieve,
  DEFAULT_CONFIG,
} from '@/lib/retrieval/hybrid-retrieval';
import { getPopularityBaseline } from '@/lib/baselines/popularity-baseline';

// Haversine distance calculation (km)
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Cache for restaurant embeddings (persists across requests in serverless)
let restaurantEmbeddingsCache: { id: string; embedding: number[] }[] | null = null;

export async function POST(req: Request) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const {
    preferences,
    messages,
    userProfiles,
    userLocation,
  } = await req.json();

  // Convert profiles to StructuredUserProfile format
  const profiles: StructuredUserProfile[] = [];
  if (userProfiles && typeof userProfiles === 'object') {
    for (const [, profile] of Object.entries(userProfiles)) {
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
      if (typeof pref === 'string' && pref.toLowerCase().includes('vegan')) {
        profile.dietary.restrictions.push({ type: 'vegan', strictness: 'strict' });
      }
      profiles.push(profile);
    }
  }

  // 1. Synthesize a "Group Query" for embedding-based dense retrieval
  const profileSummaries = profiles.map(p => getProfileSummary(p)).join(' ');
  const currentPrefs = Object.values(preferences || {}).join(' ');
  const groupQuery = `${currentPrefs} ${profileSummaries}`.trim() || 'good restaurant toronto';

  try {
    // 2. Get embeddings for the hybrid pipeline's dense stage
    let embeddingData: {
      queryVector: number[];
      restaurantEmbeddings: { id: string; embedding: number[] }[];
    } | undefined;

    try {
      const queryEmbeddingResponse = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: groupQuery,
      });
      const queryVector = queryEmbeddingResponse.data[0].embedding;

      // Get or compute restaurant embeddings
      if (!restaurantEmbeddingsCache) {
        console.log('[Recommend] Computing embeddings for', RESTAURANTS.length, 'restaurants...');
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
        console.log('[Recommend] Embeddings cached for', restaurantEmbeddingsCache.length, 'restaurants');
      }

      embeddingData = {
        queryVector,
        restaurantEmbeddings: restaurantEmbeddingsCache,
      };
    } catch (embError) {
      // Embedding API failed — hybrid pipeline will fall back to feature vectors
      console.warn('[Recommend] Embedding API unavailable, using feature-vector-only mode:', embError);
    }

    // 3. Run hybrid retrieval pipeline (sparse + dense + RRF)
    const hybridResult = hybridRetrieve(
      RESTAURANTS,
      profiles,
      DEFAULT_CONFIG,
      embeddingData
    );

    let topCandidates = hybridResult.candidates;
    const index = hybridResult.index;

    console.log('[Recommend] Hybrid retrieval:', JSON.stringify(hybridResult.diagnostics));

    // 4. Apply distance bonus if user location provided
    if (userLocation) {
      topCandidates = topCandidates.map(r => {
        if (r.lat && r.lon) {
          const distance = haversineDistance(
            userLocation.lat, userLocation.lon,
            r.lat, r.lon
          );
          const distanceBonus = Math.max(0, 0.05 * (1 - distance / 20));
          return { ...r, score: r.score + distanceBonus };
        }
        return r;
      });
      // Re-sort after distance adjustment
      topCandidates.sort((a, b) => b.score - a.score);
    }

    // 5. Apply mathematical fairness scoring (now with index for CBF + cold-start)
    let fairnessResult: FairnessResult | null = null;
    let candidatesWithFairness: ScoredRestaurant[] = topCandidates;

    if (profiles.length > 0) {
      // Calculate fairness for all candidates (with inverted index for feature vectors)
      candidatesWithFairness = topCandidates.map(restaurant => {
        const { metrics, userSatisfaction } = calculateGroupFairness(restaurant, profiles, index);
        return {
          ...restaurant,
          fairnessMetrics: metrics,
          userSatisfaction,
        };
      });

      // Select best using Pareto filtering + robust Nash Welfare
      fairnessResult = selectBestRestaurant(topCandidates, profiles, 'balanced', index);
    }

    // 6. Compute popularity baseline for comparison
    const popularityBaseline = getPopularityBaseline(RESTAURANTS, profiles, 3);

    // 7. Build display candidates
    const topForDisplay = candidatesWithFairness.slice(0, 6);

    // 8. Generate LLM explanation
    const conversationText = messages.map((m: { userName: string; text: string }) =>
      `${m.userName}: ${m.text}`
    ).join('\n');

    let llmExplanation = '';
    if (fairnessResult) {
      const reasoningPrompt = `
        You are a Group Dining Recommender for Toronto.

        Based on the fairness analysis, we've selected: ${fairnessResult.restaurant.name}

        The Group Conversation:
        ${conversationText}

        User Profiles:
        ${profiles.map(p => `${p.name}: ${getProfileSummary(p)}`).join('\n')}

        Fairness Metrics (Pareto + Nash Welfare):
        - Nash Welfare: ${(fairnessResult.metrics.nash * 100).toFixed(0)}% (selection criterion)
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
        llmExplanation = fairnessResult.explanation;
      }
    } else {
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
        distance: userLocation && r.lat && r.lon
          ? haversineDistance(userLocation.lat, userLocation.lon, r.lat, r.lon)
          : undefined,
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
      selectionMethod: 'hybrid-pareto-nash',
      // Baseline comparison data for evaluation
      baselineComparison: {
        popularityTop3: popularityBaseline.map(r => ({
          id: r.id,
          name: r.name,
          score: r.score,
        })),
      },
      retrievalDiagnostics: hybridResult.diagnostics,
    });

  } catch (error) {
    console.error('Recommendation error:', error);

    // If everything fails, try feature-vector-only fallback (no API needed)
    try {
      const fallbackResult = hybridRetrieve(RESTAURANTS, profiles);
      const fallbackCandidates = fallbackResult.candidates.slice(0, 4);

      return NextResponse.json({
        candidates: fallbackCandidates.map(r => ({
          id: r.id,
          name: r.name,
          cuisine: r.cuisine,
          price: r.price,
          rating: r.rating,
          location: r.location,
          address: r.address,
          score: r.score,
        })),
        recommendation: `Based on your group's preferences, we recommend **${fallbackCandidates[0]?.name || 'a restaurant'}**. (Generated offline — embedding API was unavailable.)`,
        totalRestaurants: RESTAURANTS.length,
        fairnessResult: null,
        selectionMethod: 'hybrid-fallback',
      });
    } catch {
      return NextResponse.json({
        error: "Recommendation failed — please try again",
        candidates: [],
        recommendation: "Unable to generate a recommendation right now. Please try again in a moment.",
        totalRestaurants: RESTAURANTS.length,
        fairnessResult: null,
        selectionMethod: 'error-fallback',
      }, { status: 200 });
    }
  }
}
