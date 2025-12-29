const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

// Read CSV
const csvPath = path.join(__dirname, '../../DATA-HERE/data/yelp_restaurants_toronto_final.csv');
const csvContent = fs.readFileSync(csvPath, 'utf-8');

// Parse CSV
const records = parse(csvContent, {
  columns: true,
  skip_empty_lines: true,
  bom: true
});

console.log(`Parsed ${records.length} restaurants`);
console.log('Sample record keys:', Object.keys(records[0]));

// Transform to our Restaurant format
const restaurants = records.map((r, index) => {
  // Parse categories from string like "['Canadian (New)']"
  let categories = [];
  try {
    categories = JSON.parse(r.categories.replace(/'/g, '"'));
  } catch (e) {
    categories = [r.categories];
  }

  // Parse neighborhoods
  let neighborhoods = [];
  try {
    neighborhoods = JSON.parse(r.neighborhoods.replace(/'/g, '"'));
  } catch (e) {
    neighborhoods = [r.neighborhoods];
  }

  // Parse type/tags
  let tags = [];
  try {
    tags = JSON.parse(r.type.replace(/'/g, '"'));
  } catch (e) {
    tags = [];
  }

  // Extract address parts
  const address = r.address || '';

  return {
    id: r.place_id,
    name: r.name,
    cuisine: categories.join(', '),
    price: r.price_x || r.price_y || '$',
    rating: parseFloat(r.rating) || 0,
    reviewCount: parseInt(r.review_count) || 0,
    description: `${r.name} - ${categories.join(', ')}. Located in ${neighborhoods.join(', ') || 'Toronto'}. ${tags.slice(0, 3).join(', ')}.`,
    location: neighborhoods.join(', ') || 'Toronto',
    address: address,
    phone: r.phone || '',
    website: r.website || '',
    yelp_url: r.yelp_url || '',
    tags: [...categories.map(c => c.toLowerCase()), ...tags.map(t => t.toLowerCase().replace(' restaurant', ''))].slice(0, 10),
    images: [],
    lat: parseFloat(r.lat) || 0,
    lon: parseFloat(r.lon) || 0
  };
});

// Try to parse images for first few
restaurants.forEach((rest, i) => {
  try {
    const images = JSON.parse(records[i].images.replace(/'/g, '"'));
    rest.images = images.slice(0, 3); // Keep first 3 images
  } catch (e) {
    rest.images = [];
  }
});

console.log('\nSample transformed restaurant:');
console.log(JSON.stringify(restaurants[0], null, 2));

// Write to JSON file
const outputPath = path.join(__dirname, '../lib/restaurants.json');
fs.writeFileSync(outputPath, JSON.stringify(restaurants, null, 2));
console.log(`\nWritten ${restaurants.length} restaurants to ${outputPath}`);

// Also create a TypeScript export file
const tsContent = `// Auto-generated from yelp_restaurants_toronto_final.csv
import restaurantsData from './restaurants.json';
import { Restaurant } from './types';

export const RESTAURANTS: Restaurant[] = restaurantsData as Restaurant[];
`;

const tsPath = path.join(__dirname, '../lib/restaurant-data.ts');
fs.writeFileSync(tsPath, tsContent);
console.log(`Written TypeScript wrapper to ${tsPath}`);
