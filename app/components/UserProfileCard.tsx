'use client';

import { useState } from 'react';
import { StructuredUserProfile } from '@/lib/types';
import { Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

interface UserProfileCardProps {
  profile: StructuredUserProfile;
  isCurrentUser: boolean;
  userColor: string;
  onReset?: () => void;
  showRawJson?: boolean;
}

function getProfileSummary(profile: StructuredUserProfile): string {
  const parts: string[] = [];

  if (profile.dietary.restrictions.length > 0) {
    const restrictions = profile.dietary.restrictions.map(r =>
      r.strictness === 'strict' ? r.type.toUpperCase() : r.type
    );
    parts.push(restrictions.join(', '));
  }

  if (profile.dietary.allergies.length > 0) {
    parts.push(`allergic to ${profile.dietary.allergies.join(', ')}`);
  }

  if (profile.cuisinePreferences.favorites.length > 0) {
    const top3 = profile.cuisinePreferences.favorites.slice(0, 3).map(c => c.cuisine);
    parts.push(`likes ${top3.join(', ')}`);
  }

  if (profile.budget.preferred) {
    const priceLabels: Record<string, string> = {
      $: 'budget-friendly',
      $$: 'moderate',
      $$$: 'upscale',
      $$$$: 'luxury',
    };
    parts.push(priceLabels[profile.budget.preferred] || profile.budget.preferred);
  }

  if (profile.location.preferredAreas.length > 0) {
    parts.push(`prefers ${profile.location.preferredAreas[0]}`);
  }

  return parts.length > 0 ? parts.join(' \u2022 ') : 'No preferences saved yet';
}

export default function UserProfileCard({ profile, isCurrentUser, userColor, onReset, showRawJson = false }: UserProfileCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const hasHardConstraints =
    profile.dietary.restrictions.filter(r => r.strictness === 'strict').length > 0 ||
    profile.dietary.allergies.length > 0 ||
    !!profile.dietary.religious;

  return (
    <div
      className="rounded-lg shadow-sm border overflow-hidden"
      style={{ borderColor: `${userColor}40`, backgroundColor: `${userColor}08` }}
    >
      {/* Header */}
      <div
        className="p-3 cursor-pointer hover:bg-white/30 transition-colors"
        style={{ backgroundColor: `${userColor}15` }}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: userColor }}
            />
            <span className="font-semibold text-sm">{profile.name}</span>
            {isCurrentUser && (
              <span className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full">you</span>
            )}
            <span className="text-[10px] text-gray-400">
              (confidence: {(profile.confidence.overall * 100).toFixed(0)}%)
            </span>
          </div>
          <div className="flex items-center gap-2">
            {onReset && (
              <button
                onClick={(e) => { e.stopPropagation(); onReset(); }}
                className="text-gray-400 hover:text-red-500 transition-colors"
                title={`Reset ${profile.name}'s profile`}
              >
                <Trash2 size={12} />
              </button>
            )}
            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </div>
        </div>

        <p className="text-xs text-gray-600 mt-1">{getProfileSummary(profile)}</p>
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="border-t bg-white/50 p-3 space-y-3">
          {showRawJson ? (
            <pre className="text-[10px] bg-gray-900 text-green-400 p-3 rounded-lg overflow-x-auto max-h-64 overflow-y-auto">
              {JSON.stringify(profile, null, 2)}
            </pre>
          ) : (
            <>
              {/* Hard Constraints */}
              <div>
                <div className="text-[10px] font-semibold text-red-700 uppercase mb-1">
                  Hard Constraints (Must Satisfy)
                </div>
                {hasHardConstraints ? (
                  <div className="bg-red-50 rounded p-2 space-y-1">
                    {profile.dietary.restrictions.filter(r => r.strictness === 'strict').map(r => (
                      <div key={r.type} className="flex items-center gap-2 text-xs">
                        <span className="text-red-600 font-mono">dietary:</span>
                        <span className="bg-red-100 text-red-800 px-1.5 py-0.5 rounded font-medium">{r.type}</span>
                        <span className="text-gray-400 text-[10px]">strictness: strict</span>
                      </div>
                    ))}
                    {profile.dietary.allergies.map(a => (
                      <div key={a} className="flex items-center gap-2 text-xs">
                        <span className="text-red-600 font-mono">allergy:</span>
                        <span className="bg-red-100 text-red-800 px-1.5 py-0.5 rounded font-medium">{a}</span>
                      </div>
                    ))}
                    {profile.dietary.religious && (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-red-600 font-mono">religious:</span>
                        <span className="bg-red-100 text-red-800 px-1.5 py-0.5 rounded font-medium">{profile.dietary.religious}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-[10px] text-gray-400 italic">None detected</div>
                )}
              </div>

              {/* Soft Constraints */}
              <div>
                <div className="text-[10px] font-semibold text-blue-700 uppercase mb-1">
                  Soft Constraints (Weighted Preferences)
                </div>
                <div className="bg-blue-50 rounded p-2 space-y-2">
                  {profile.dietary.restrictions.filter(r => r.strictness === 'flexible').length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[10px] text-gray-500">Dietary (flexible):</div>
                      {profile.dietary.restrictions.filter(r => r.strictness === 'flexible').map(r => (
                        <div key={r.type} className="flex items-center gap-2 text-xs ml-2">
                          <span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded">{r.type}</span>
                          <span className="text-gray-400 text-[10px]">weight: 3</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {profile.cuisinePreferences.favorites.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[10px] text-gray-500">Cuisine Preferences:</div>
                      {profile.cuisinePreferences.favorites.map(c => (
                        <div key={c.cuisine} className="flex items-center gap-2 text-xs ml-2">
                          <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">{c.cuisine}</span>
                          <span className="text-gray-500 font-mono text-[10px]">
                            score: {c.score.toFixed(1)} | freq: {c.frequency} | weight: {Math.ceil(c.score / 2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {profile.cuisinePreferences.dislikes.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[10px] text-gray-500">Cuisine Dislikes:</div>
                      {profile.cuisinePreferences.dislikes.map(d => (
                        <div key={d} className="flex items-center gap-2 text-xs ml-2">
                          <span className="bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">not-{d}</span>
                          <span className="text-gray-400 text-[10px]">weight: 3</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {profile.budget.preferred && (
                    <div className="space-y-1">
                      <div className="text-[10px] text-gray-500">Budget:</div>
                      <div className="flex items-center gap-2 text-xs ml-2">
                        <span className="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">{profile.budget.preferred}</span>
                        <span className="text-gray-500 font-mono text-[10px]">
                          flexibility: {profile.budget.flexibility}/5 | weight: {6 - profile.budget.flexibility}
                        </span>
                      </div>
                    </div>
                  )}

                  {profile.location.preferredAreas.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[10px] text-gray-500">Location:</div>
                      {profile.location.preferredAreas.map(loc => (
                        <div key={loc} className="flex items-center gap-2 text-xs ml-2">
                          <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">{loc}</span>
                          <span className="text-gray-400 text-[10px]">weight: 2</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {profile.diningStyle.preferredAmbiance.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[10px] text-gray-500">Ambiance:</div>
                      {profile.diningStyle.preferredAmbiance.map(amb => (
                        <div key={amb} className="flex items-center gap-2 text-xs ml-2">
                          <span className="bg-pink-100 text-pink-700 px-1.5 py-0.5 rounded">{amb}</span>
                          <span className="text-gray-400 text-[10px]">weight: 1</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {profile.dietary.restrictions.filter(r => r.strictness === 'flexible').length === 0 &&
                   profile.cuisinePreferences.favorites.length === 0 &&
                   profile.cuisinePreferences.dislikes.length === 0 &&
                   !profile.budget.preferred &&
                   profile.location.preferredAreas.length === 0 &&
                   profile.diningStyle.preferredAmbiance.length === 0 && (
                    <div className="text-[10px] text-gray-400 italic">No soft preferences extracted yet</div>
                  )}
                </div>
              </div>

              {/* Confidence Scores */}
              <div>
                <div className="text-[10px] font-semibold text-gray-600 uppercase mb-1">
                  Confidence Scores
                </div>
                <div className="grid grid-cols-5 gap-1">
                  {Object.entries(profile.confidence).map(([key, value]) => (
                    <div key={key} className="bg-gray-100 rounded p-1.5 text-center">
                      <div className="text-[9px] text-gray-500 capitalize">{key}</div>
                      <div className={cn(
                        "text-xs font-bold",
                        value > 0.7 ? "text-green-600" :
                        value > 0.4 ? "text-yellow-600" : "text-gray-400"
                      )}>
                        {(value * 100).toFixed(0)}%
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Metadata */}
              <div className="text-[10px] text-gray-400 border-t pt-2">
                Last updated: {new Date(profile.history.lastUpdated).toLocaleString()} |
                Interactions: {profile.history.totalInteractions}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
