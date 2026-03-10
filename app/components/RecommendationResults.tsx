'use client';

import { GroupFairnessMetrics, UserSatisfactionResult, Vote, SessionUser } from '@/lib/types';
import { ThumbsUp, ThumbsDown, BarChart3, CheckCircle2, XCircle } from 'lucide-react';
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
  votes?: Vote[];
  currentUserId?: string;
  users?: SessionUser[];
  onVote?: (restaurantId: string, vote: 'up' | 'down') => void;
}

export default function RecommendationResults({
  candidates,
  recommendation,
  totalRestaurants,
  fairnessResult,
  votes = [],
  currentUserId,
  users = [],
  onVote,
}: RecommendationResultsProps) {
  const getVoteCounts = (restaurantId: string) => {
    const restaurantVotes = votes.filter(v => v.restaurantId === restaurantId);
    return {
      up: restaurantVotes.filter(v => v.vote === 'up').length,
      down: restaurantVotes.filter(v => v.vote === 'down').length,
    };
  };

  const getUserVote = (restaurantId: string): 'up' | 'down' | null => {
    if (!currentUserId) return null;
    const v = votes.find(v => v.restaurantId === restaurantId && v.userId === currentUserId);
    return v?.vote ?? null;
  };

  // ---- Vote Analytics Computation ----
  const totalVoters = new Set(votes.map(v => v.userId)).size;
  const hasVotes = votes.length > 0 && candidates.length > 0;

  // Per-candidate analytics: approval rate vs predicted scores
  const candidateAnalytics = candidates.map(c => {
    const counts = getVoteCounts(c.id);
    const totalOnThis = counts.up + counts.down;
    const approvalRate = totalOnThis > 0 ? counts.up / totalOnThis : null;
    return {
      id: c.id,
      name: c.name,
      matchScore: c.score,
      nashScore: c.fairnessMetrics?.nash ?? null,
      approvalRate,
      upVotes: counts.up,
      downVotes: counts.down,
      totalVotes: totalOnThis,
    };
  });

  // Did the system's top pick (fairnessResult) get the highest approval?
  const systemTopPickId = fairnessResult?.restaurantId;
  const systemTopPickApproval = candidateAnalytics.find(c => c.id === systemTopPickId)?.approvalRate ?? null;
  const bestApproval = candidateAnalytics.reduce((best, c) =>
    (c.approvalRate !== null && (best === null || c.approvalRate > best)) ? c.approvalRate : best,
    null as number | null
  );
  const topPickIsGroupFavorite = systemTopPickApproval !== null && bestApproval !== null
    && systemTopPickApproval >= bestApproval;

  // Per-user: predicted satisfaction vs actual vote on system top pick
  const perUserAccuracy = fairnessResult?.userSatisfaction.map(sat => {
    const userVoteOnTop = systemTopPickId
      ? votes.find(v => v.userId === sat.userId && v.restaurantId === systemTopPickId)
      : null;
    const userName = users.find(u => u.id === sat.userId)?.name ?? sat.userName;
    return {
      userId: sat.userId,
      userName,
      predictedScore: sat.score,
      actualVote: userVoteOnTop?.vote ?? null,
      agrees: userVoteOnTop ? (
        (sat.score >= 0.5 && userVoteOnTop.vote === 'up') ||
        (sat.score < 0.5 && userVoteOnTop.vote === 'down')
      ) : null,
    };
  }) ?? [];

  const usersWhoVoted = perUserAccuracy.filter(u => u.actualVote !== null);
  const agreementCount = usersWhoVoted.filter(u => u.agrees).length;
  const agreementRate = usersWhoVoted.length > 0 ? agreementCount / usersWhoVoted.length : null;

  return (
    <>
      {/* Retrieval Results */}
      {candidates.length > 0 && (
        <div className="mb-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">
            Top Matches from {totalRestaurants} Toronto Restaurants
          </h3>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {candidates.map((c) => {
              const counts = getVoteCounts(c.id);
              const myVote = getUserVote(c.id);

              return (
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

                  {/* Voting */}
                  {onVote && (
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
                      <button
                        onClick={() => onVote(c.id, 'up')}
                        className={cn(
                          "flex items-center gap-1 px-2 py-1 rounded-md transition-colors",
                          myVote === 'up'
                            ? "bg-green-100 text-green-700"
                            : "text-gray-400 hover:bg-green-50 hover:text-green-600"
                        )}
                      >
                        <ThumbsUp size={12} />
                        <span className="text-[10px] font-mono">{counts.up}</span>
                      </button>
                      <button
                        onClick={() => onVote(c.id, 'down')}
                        className={cn(
                          "flex items-center gap-1 px-2 py-1 rounded-md transition-colors",
                          myVote === 'down'
                            ? "bg-red-100 text-red-700"
                            : "text-gray-400 hover:bg-red-50 hover:text-red-600"
                        )}
                      >
                        <ThumbsDown size={12} />
                        <span className="text-[10px] font-mono">{counts.down}</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
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

      {/* Vote Analytics — Predicted vs Actual */}
      {hasVotes && (
        <div className="bg-gradient-to-br from-amber-50 to-orange-50 p-4 rounded-xl border border-amber-200 mt-4">
          <h4 className="font-semibold text-sm text-amber-800 mb-3 flex items-center gap-2">
            <BarChart3 size={16} />
            Vote Analytics — Predicted vs. Actual
          </h4>

          {/* Summary row */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="bg-white/80 rounded-lg p-2 text-center">
              <div className="text-[10px] text-gray-500">Total Voters</div>
              <div className="text-lg font-bold text-gray-700">{totalVoters}</div>
            </div>
            <div className="bg-white/80 rounded-lg p-2 text-center">
              <div className="text-[10px] text-gray-500">Top Pick Approved</div>
              <div className="text-lg font-bold">
                {topPickIsGroupFavorite ? (
                  <span className="text-green-600">Yes</span>
                ) : systemTopPickApproval !== null ? (
                  <span className="text-red-600">No</span>
                ) : (
                  <span className="text-gray-400">--</span>
                )}
              </div>
            </div>
            <div className="bg-white/80 rounded-lg p-2 text-center">
              <div className="text-[10px] text-gray-500">Prediction Accuracy</div>
              <div className={cn(
                "text-lg font-bold",
                agreementRate !== null && agreementRate >= 0.7 ? "text-green-600" :
                agreementRate !== null && agreementRate >= 0.4 ? "text-yellow-600" : "text-gray-400"
              )}>
                {agreementRate !== null ? `${(agreementRate * 100).toFixed(0)}%` : '--'}
              </div>
            </div>
          </div>

          {/* Per-candidate: Approval Rate vs Predicted Score */}
          <div className="mb-4">
            <div className="text-xs font-medium text-gray-600 mb-2">Candidate Approval vs. System Score</div>
            <div className="space-y-2">
              {candidateAnalytics.map(c => (
                <div key={c.id} className="bg-white/60 rounded-lg p-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className={cn(
                      "text-xs font-medium truncate max-w-[120px]",
                      c.id === systemTopPickId ? "text-indigo-700" : "text-gray-700"
                    )}>
                      {c.name}
                      {c.id === systemTopPickId && (
                        <span className="text-[9px] text-indigo-500 ml-1">(pick)</span>
                      )}
                    </span>
                    <div className="flex items-center gap-3 text-[10px] font-mono">
                      <span className="text-green-600">
                        {c.approvalRate !== null ? `${(c.approvalRate * 100).toFixed(0)}% approval` : 'no votes'}
                      </span>
                      <span className="text-gray-400">|</span>
                      <span className="text-blue-600">{(c.matchScore * 100).toFixed(0)}% match</span>
                      {c.nashScore !== null && (
                        <>
                          <span className="text-gray-400">|</span>
                          <span className="text-purple-600">{(c.nashScore * 100).toFixed(0)}% Nash</span>
                        </>
                      )}
                    </div>
                  </div>
                  {/* Dual bar: approval (green) vs match score (blue) */}
                  <div className="flex gap-1">
                    <div className="flex-1">
                      <div className="h-1.5 bg-gray-200 rounded-full">
                        <div
                          className="h-full bg-green-500 rounded-full transition-all"
                          style={{ width: `${(c.approvalRate ?? 0) * 100}%` }}
                        />
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="h-1.5 bg-gray-200 rounded-full">
                        <div
                          className="h-full bg-blue-500 rounded-full transition-all"
                          style={{ width: `${c.matchScore * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1 mt-0.5">
                    <span className="flex-1 text-[9px] text-green-600">approval</span>
                    <span className="flex-1 text-[9px] text-blue-600">predicted</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Per-user: Predicted Satisfaction vs Actual Vote */}
          {perUserAccuracy.length > 0 && systemTopPickId && (
            <div>
              <div className="text-xs font-medium text-gray-600 mb-2">
                Per-User: Predicted Satisfaction vs. Vote on Top Pick
              </div>
              <div className="space-y-1.5">
                {perUserAccuracy.map(u => (
                  <div key={u.userId} className="flex items-center gap-2 bg-white/60 rounded-lg px-2 py-1.5">
                    <span className="text-xs w-16 truncate font-medium">{u.userName}</span>
                    <div className="flex-1 h-2 bg-gray-200 rounded-full">
                      <div
                        className="h-full bg-purple-500 rounded-full transition-all"
                        style={{ width: `${u.predictedScore * 100}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-mono text-purple-600 w-8">
                      {(u.predictedScore * 100).toFixed(0)}%
                    </span>
                    <div className="w-14 flex justify-center">
                      {u.actualVote === 'up' ? (
                        <span className="flex items-center gap-0.5 text-green-600">
                          <ThumbsUp size={10} />
                          <span className="text-[10px]">up</span>
                        </span>
                      ) : u.actualVote === 'down' ? (
                        <span className="flex items-center gap-0.5 text-red-600">
                          <ThumbsDown size={10} />
                          <span className="text-[10px]">down</span>
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-400">--</span>
                      )}
                    </div>
                    <div className="w-5">
                      {u.agrees === true && <CheckCircle2 size={14} className="text-green-500" />}
                      {u.agrees === false && <XCircle size={14} className="text-red-500" />}
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-[10px] text-gray-500 mt-2 italic">
                A prediction &quot;agrees&quot; when score &ge; 50% and user voted up, or score &lt; 50% and user voted down.
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
