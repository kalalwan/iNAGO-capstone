import { NextResponse } from 'next/server';
import OpenAI from 'openai';

export async function POST(req: Request) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const { messages } = await req.json();

  // Create a conversation string
  const conversationText = messages.map((m: { userName: string; text: string }) => `${m.userName}: ${m.text}`).join('\n');

  const systemPrompt = `
    You are an AI assistant analyzing a group chat about dinner plans.
    Extract the key preferences for EACH user.
    Return a JSON object where keys are user names and values are strings summarizing their specific constraints (diet, cuisine, budget, location).
    Example: { "Aisha": "Vegan, likes asian", "John": "Wants BBQ ribs, hates sushi" }
  `;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo-0125", // Fast and cheap for this task
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: conversationText }
      ],
      response_format: { type: "json_object" }
    });

    const content = response.choices[0].message.content;
    return NextResponse.json(JSON.parse(content || "{}"));
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to analyze" }, { status: 500 });
  }
}
