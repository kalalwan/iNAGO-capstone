export interface Message {
  id: string;
  userId: string;
  userName: string;
  text: string;
  timestamp: number;
}

export interface UserProfile {
  id: string;
  name: string;
  color: string;
  preferences: string[]; // Extracted preferences
}

export interface Restaurant {
  id: string;
  name: string;
  cuisine: string;
  price: string;
  rating: number;
  reviewCount: number;
  description: string; // Used for embedding
  location: string;
  address: string;
  phone: string;
  website: string;
  yelp_url: string;
  tags: string[];
  images: string[];
  lat: number;
  lon: number;
}
