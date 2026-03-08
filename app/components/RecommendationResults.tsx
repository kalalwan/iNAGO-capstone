'use client';

import { GroupFairnessMetrics, UserSatisfactionResult } from '@/lib/types';
import { cn } from '@/lib/utils';

interface CandidateRestaurant {
  id: string;
  name: string;
  cuisine: string;
  price: string;
  rating: number;
  location: string;
  address: string;
  score: number;
  fairnessMetrics?: GroupFairnessMetrics;
  userSatisfaction?: UserSatisfactionResult[];
}

interface FairnessResultData {
  restaurantId: string;
  restaurantName: string;
  metrics: GroupFairnessMetrics;
  userSatisfaction: UserSatisfactionResult[];
  isParetoEfficient: boolean;
}

interface RecommendationResultsProps {
  candidates: CandidateRestaurant[];
  recommendation: string;
  totalRestaurants: number;
  fairnessResult: FairnessResultData | null;
}

export default function RecommendationResults({
  candidates,
  recommendation,
  totalRestaurants,
  fairnessResult,
}: RecommendationResultsProps) {
  return (
    <>
      {/* Retrieval Results */}
      {candidates.length > 0 && (
        <div className="mb-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">
            Top Matches from {totalRestaurants} Toronto Restaurants
          </h3>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {candidates.map((c) => (
              <div
                key={c.id}
                className={cn(
                  "min-w-[160px] bg-white p-3 rounded-lg border text-xs shadow-sm",
                  fairnessResult?.restaurantId === c.id && "ring-2 ring-indigo-500"
                )}
              >
                <div className="font-bold truncate text-sm">{c.name}</div>
                <div className="text-gray-500 mt-1">{c.cuisine}</div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-yellow-600">{c.rating} ★</span>
                  <span className="text-gray-400">&bull;</span>
                  <span>{c.price}</span>
                </div>
                <div className="text-gray-400 text-[10px] mt-1 truncate">{c.location}</div>
                <div className="flex justify-between items-center mt-2">
                  <span className="text-green-600 font-mono font-semibold">{(c.score * 100).toFixed(0)}% match</span>
                  {c.fairnessMetrics && (
                    <span className="text-purple-600 font-mono text-[10px]">
                      Nash: {(c.fairnessMetrics.nash * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Final Output */}
      {recommendation && (
        <div className="bg-white p-6 rounded-xl shadow-md border border-indigo-100">
          <h3 className="font-bold text-lg mb-2 text-gray-800 flex items-center gap-2">
            Recommendation
            {fairnessResult?.isParetoEfficient && (
              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                Pareto Efficient
              </span>
            )}
          </h3>
          <div className="prose prose-sm text-gray-700 whitespace-pre-wrap">
            {recommendation}
          </div>
        </div>
      )}
    </>
  );
}
