import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import {
  extractLocalPreferences,
  needsAPIExtraction,
  updateProfile,
  getOrCreateProfile,
  getProfileSummary,
} from '@/lib/profile-utils';
import { StructuredUserProfile, ExtractedPreferences } from '@/lib/types';

// Debounce tracking - prevent rapid API calls
let lastAPICall = 0;
const API_DEBOUNCE_MS = 2000;

export async function POST(req: Request) {
  const { messages, existingProfiles } = await req.json();

  // Parse existing profiles or start fresh
  const profiles: Record<string, StructuredUserProfile> = existingProfiles || {};

  // Track which users spoke in this batch
  const updatedUsers: Set<string> = new Set();
  const userMessages: Record<string, string[]> = {};

  // Collect messages per user
  for (const msg of messages) {
    if (!userMessages[msg.userId]) {
      userMessages[msg.userId] = [];
    }
    userMessages[msg.userId].push(msg.text);
    updatedUsers.add(msg.userId);
  }

  // Process each user's messages with local extraction first
  let needsAPIForAny = false;
  const localExtractions: Record<string, ExtractedPreferences> = {};

  for (const [userId, texts] of Object.entries(userMessages)) {
    const combinedText = texts.join(' ');
    const localResult = extractLocalPreferences(combinedText);
    localExtractions[userId] = localResult;

    // Check if any user needs API extraction
    if (needsAPIExtraction(combinedText, localResult)) {
      needsAPIForAny = true;
    }

    // Get or create profile for this user
    const userName = messages.find((m: { userId: string; userName: string }) => m.userId === userId)?.userName || 'Unknown';
    const userColor = getColorForUser(userId);
    let profile = getOrCreateProfile(profiles, userId, userName, userColor);

    // Apply local extraction immediately
    if (Object.keys(localResult).length > 0) {
      profile = updateProfile(profile, localResult);
      profiles[userId] = profile;
    }
  }

  // Only call API if needed and not debounced
  const now = Date.now();
  const shouldCallAPI = needsAPIForAny && (now - lastAPICall > API_DEBOUNCE_MS);

  if (shouldCallAPI) {
    try {
      lastAPICall = now;
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const conversationText = messages.map((m: { userName: string; text: string }) =>
        `${m.userName}: ${m.text}`
      ).join('\n');

      const systemPrompt = `
        You are an AI assistant analyzing a group chat about dinner plans.
        Extract detailed preferences for EACH user including:
        - Dietary restrictions (vegan, vegetarian, gluten-free, halal, etc.) and their strictness
        - Allergies
        - Cuisine preferences (favorites and dislikes)
        - Budget preferences (cheap/moderate/expensive)
        - Location preferences
        - Ambiance preferences (casual, upscale, quiet, lively)

        Return a JSON object with this structure:
        {
          "users": {
            "UserName": {
              "dietary": [{"type": "vegan", "strictness": "strict"}],
              "allergies": ["peanuts"],
              "cuisines": ["thai", "japanese"],
              "cuisineDislikes": ["sushi"],
              "price": "$" | "$$" | "$$$" | "$$$$",
              "location": ["downtown"],
              "ambiance": ["casual"]
            }
          }
        }

        Only include fields that were explicitly mentioned or strongly implied.
        Use "strict" for hard requirements, "flexible" for preferences.
      `;

      const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo-0125",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: conversationText }
        ],
        response_format: { type: "json_object" }
      });

      const content = response.choices[0].message.content;
      const parsed = JSON.parse(content || "{}");

      // Merge API results into profiles
      if (parsed.users) {
        for (const [userName, prefs] of Object.entries(parsed.users)) {
          // Find userId from userName
          const msg = messages.find((m: { userName: string; userId: string }) => m.userName === userName);
          if (msg) {
            const userId = msg.userId;
            let profile = profiles[userId];
            if (profile) {
              profile = updateProfile(profile, prefs as ExtractedPreferences);
              profiles[userId] = profile;
            }
          }
        }
      }
    } catch (error) {
      console.error('API extraction error (falling back to local):', error);
      // Local extraction already applied, continue
    }
  }

  // Build response with both legacy format (for current UI) and new format
  const legacyPreferences: Record<string, string> = {};
  for (const [userId, profile] of Object.entries(profiles)) {
    legacyPreferences[profile.name] = getProfileSummary(profile);
  }

  return NextResponse.json({
    preferences: legacyPreferences,
    profiles: profiles,
    usedAPI: shouldCallAPI,
  });
}

// Helper to get color class for user
function getColorForUser(userId: string): string {
  const colors: Record<string, string> = {
    u1: 'bg-green-100 border-green-300',
    u2: 'bg-blue-100 border-blue-300',
    u3: 'bg-yellow-100 border-yellow-300',
    u4: 'bg-purple-100 border-purple-300',
  };
  return colors[userId] || 'bg-gray-100 border-gray-300';
}
