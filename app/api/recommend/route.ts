import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { RESTAURANTS } from '@/lib/data';
import { cosineSimilarity } from '@/lib/utils';

// Cache for restaurant embeddings (persists across requests in serverless)
let restaurantEmbeddingsCache: { id: string; embedding: number[] }[] | null = null;

export async function POST(req: Request) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const { preferences, messages, userMemories } = await req.json();

  // 1. Synthesize a "Group Query" from preferences AND persistent memories
  const currentPrefs = Object.values(preferences || {}).join(' ');
  const memoryValues = Object.values(userMemories || {}) as { preferences?: string }[];
  const persistentPrefs = memoryValues
    .map((m) => m.preferences || '')
    .join(' ');
  const groupQuery = `${currentPrefs} ${persistentPrefs}`.trim();

  try {
    // 2. Embed the Group Query
    const queryEmbeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: groupQuery,
    });
    const queryVector = queryEmbeddingResponse.data[0].embedding;

    // 3. Get or compute restaurant embeddings (batch embed for efficiency)
    if (!restaurantEmbeddingsCache) {
      console.log('Computing embeddings for', RESTAURANTS.length, 'restaurants...');

      // Create description texts for all restaurants
      const restaurantTexts = RESTAURANTS.map(rest =>
        `${rest.name} ${rest.cuisine} ${rest.description} ${rest.price} ${rest.location} ${rest.tags.join(' ')}`
      );

      // Batch embed all restaurants in one API call (OpenAI supports up to 2048 inputs)
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

    // 4. Score all restaurants using cosine similarity
    const scoredRestaurants = RESTAURANTS.map((rest, idx) => {
      const embedding = restaurantEmbeddingsCache![idx].embedding;
      return {
        ...rest,
        score: cosineSimilarity(queryVector, embedding)
      };
    });

    // 5. Retrieve Top Candidates
    const topCandidates = scoredRestaurants
      .sort((a, b) => b.score - a.score)
      .slice(0, 6); // Get top 6 for more options

    // 6. Fairness & Final Selection (The "LLM Reasoning Layer")
    const conversationText = messages.map((m: { userName: string; text: string }) => `${m.userName}: ${m.text}`).join('\n');

    const reasoningPrompt = `
      You are a Group Dining Recommender for Toronto restaurants.

      The Group Conversation:
      ${conversationText}

      Current Session Preferences:
      ${JSON.stringify(preferences, null, 2)}

      Persistent User Profiles (long-term preferences from past sessions):
      ${JSON.stringify(userMemories || {}, null, 2)}

      Top Retrieved Candidates (based on semantic search across ${RESTAURANTS.length} Toronto restaurants):
      ${JSON.stringify(topCandidates.map(r => ({
        name: r.name,
        cuisine: r.cuisine,
        price: r.price,
        rating: r.rating,
        reviewCount: r.reviewCount,
        location: r.location,
        address: r.address,
        tags: r.tags.slice(0, 5),
        matchScore: (r.score * 100).toFixed(1) + '%'
      })), null, 2)}

      Task:
      1. Analyze the candidates against BOTH the current session preferences AND the persistent user profiles.
      2. The persistent profiles contain long-term preferences that should always be considered (e.g., if a user is always vegan, respect that even if not mentioned in the current chat).
      3. Select the ONE best restaurant that maximizes group fairness (satisfies constraints like vegan options for Aisha while giving John his meat if possible, or finding a middle ground).
      4. Explain WHY you picked it and why others were rejected.
      5. If no perfect match exists, suggest the best compromise.
      6. Include practical details like the address and what to expect.
    `;

    const finalRecResponse = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      messages: [{ role: "system", content: reasoningPrompt }],
    });

    return NextResponse.json({
      candidates: topCandidates.slice(0, 4), // Return top 4 to UI
      recommendation: finalRecResponse.choices[0].message.content,
      totalRestaurants: RESTAURANTS.length
    });

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Recommendation failed" }, { status: 500 });
  }
}
