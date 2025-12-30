/**
 * Pre-compute restaurant embeddings and save to JSON
 * Run with: npx ts-node scripts/precompute-embeddings.ts
 */

import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';

// Load restaurants
const restaurantsPath = path.join(__dirname, '../lib/restaurants.json');
const restaurants = JSON.parse(fs.readFileSync(restaurantsPath, 'utf-8'));

async function precomputeEmbeddings() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('Error: OPENAI_API_KEY environment variable not set');
    console.error('Run: export OPENAI_API_KEY=your-key-here');
    process.exit(1);
  }

  const openai = new OpenAI({ apiKey });

  console.log(`Processing ${restaurants.length} restaurants...`);

  // Create description texts for all restaurants
  const restaurantTexts = restaurants.map((rest: {
    name: string;
    cuisine: string;
    description: string;
    price: string;
    location: string;
    tags: string[];
  }) =>
    `${rest.name} ${rest.cuisine} ${rest.description} ${rest.price} ${rest.location} ${rest.tags.join(' ')}`
  );

  console.log('Calling OpenAI embeddings API (batch request)...');

  try {
    // Batch embed all restaurants in one API call
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: restaurantTexts,
    });

    console.log(`Received ${response.data.length} embeddings`);

    // Create embeddings array
    const embeddings = restaurants.map((rest: { id: string }, idx: number) => ({
      id: rest.id,
      embedding: response.data[idx].embedding,
    }));

    // Save to JSON file
    const outputPath = path.join(__dirname, '../lib/restaurant-embeddings.json');
    fs.writeFileSync(outputPath, JSON.stringify(embeddings));

    console.log(`\nSuccess! Saved embeddings to ${outputPath}`);
    console.log(`File size: ${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Embedding dimensions: ${embeddings[0].embedding.length}`);

    // Calculate approximate cost
    const totalTokens = response.usage?.total_tokens || 0;
    const cost = (totalTokens / 1000) * 0.00002; // text-embedding-3-small pricing
    console.log(`\nAPI Usage:`);
    console.log(`  Total tokens: ${totalTokens}`);
    console.log(`  Estimated cost: $${cost.toFixed(4)}`);

  } catch (error) {
    console.error('Error calling OpenAI API:', error);
    process.exit(1);
  }
}

precomputeEmbeddings();
