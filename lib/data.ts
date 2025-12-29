import { Restaurant } from './types';
import restaurantsData from './restaurants.json';

// Import 356 real Toronto restaurants from Yelp data
export const RESTAURANTS: Restaurant[] = restaurantsData as Restaurant[];

export const USERS = [
  { id: "u1", name: "Aisha", color: "bg-green-100 border-green-300" }, // Vegan
  { id: "u2", name: "John", color: "bg-blue-100 border-blue-300" },   // BBQ Lover
  { id: "u3", name: "Josh", color: "bg-yellow-100 border-yellow-300" }, // Cheap/Downtown
  { id: "u4", name: "Kate", color: "bg-purple-100 border-purple-300" }, // Easy going
];
