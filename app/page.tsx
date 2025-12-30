"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { USERS } from '@/lib/data';
import { Message, StructuredUserProfile, GroupFairnessMetrics, UserSatisfactionResult, FairnessMode } from '@/lib/types';
import { Send, Sparkles, User, RotateCcw, Trash2, Scale, TrendingUp, Users, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'inago-user-profiles-v2';

// Load profiles from localStorage
const loadProfiles = (): Record<string, StructuredUserProfile> => {
  if (typeof window === 'undefined') return {};
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
};

// Save profiles to localStorage
const saveProfiles = (profiles: Record<string, StructuredUserProfile>) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
};

// Helper to get profile summary
const getProfileSummary = (profile: StructuredUserProfile): string => {
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

  return parts.length > 0 ? parts.join(' • ') : 'No preferences saved yet';
};

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

export default function Home() {
  const [activeUser, setActiveUser] = useState(USERS[0]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [preferences, setPreferences] = useState<Record<string, string>>({});
  const [recommendation, setRecommendation] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CandidateRestaurant[]>([]);
  const [loading, setLoading] = useState(false);
  const [totalRestaurants, setTotalRestaurants] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // User profiles (structured)
  const [userProfiles, setUserProfiles] = useState<Record<string, StructuredUserProfile>>({});

  // Fairness state
  const [fairnessMode, setFairnessMode] = useState<FairnessMode>('balanced');
  const [fairnessResult, setFairnessResult] = useState<FairnessResultData | null>(null);

  // Resizable panel state
  const [leftPanelWidth, setLeftPanelWidth] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load profiles on mount
  useEffect(() => {
    setUserProfiles(loadProfiles());
  }, []);

  // Save profiles whenever they change
  useEffect(() => {
    if (Object.keys(userProfiles).length > 0) {
      saveProfiles(userProfiles);
    }
  }, [userProfiles]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [messages]);

  // Handle mouse move for resizing
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !containerRef.current) return;
    const containerRect = containerRef.current.getBoundingClientRect();
    const newWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100;
    setLeftPanelWidth(Math.min(75, Math.max(25, newWidth)));
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const handleSend = async () => {
    if (!input.trim()) return;

    const newMessage: Message = {
      id: Date.now().toString(),
      userId: activeUser.id,
      userName: activeUser.name,
      text: input,
      timestamp: Date.now(),
    };

    const newMessages = [...messages, newMessage];
    setMessages(newMessages);
    setInput("");

    analyzeChat(newMessages);
  };

  const analyzeChat = async (msgs: Message[]) => {
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        body: JSON.stringify({
          messages: msgs,
          existingProfiles: userProfiles
        }),
      });
      const data = await res.json();

      if (!data.error) {
        // Update preferences for current session display
        if (data.preferences) {
          setPreferences(data.preferences);
        }

        // Update structured profiles
        if (data.profiles) {
          setUserProfiles(prev => ({
            ...prev,
            ...data.profiles
          }));
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const getRecommendation = async () => {
    setLoading(true);
    setRecommendation(null);
    setFairnessResult(null);

    try {
      const res = await fetch('/api/recommend', {
        method: 'POST',
        body: JSON.stringify({
          messages,
          preferences,
          userProfiles,
          fairnessMode
        }),
      });
      const data = await res.json();

      setCandidates(data.candidates || []);
      setRecommendation(data.recommendation || null);
      setTotalRestaurants(data.totalRestaurants || 0);

      if (data.fairnessResult) {
        setFairnessResult(data.fairnessResult);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const resetChat = () => {
    setMessages([]);
    setPreferences({});
    setRecommendation(null);
    setCandidates([]);
    setTotalRestaurants(0);
    setFairnessResult(null);
    setInput("");
  };

  const resetUserProfile = (userId: string) => {
    setUserProfiles(prev => {
      const newProfiles = { ...prev };
      delete newProfiles[userId];
      saveProfiles(newProfiles);
      return newProfiles;
    });
  };

  const resetAllProfiles = () => {
    setUserProfiles({});
    localStorage.removeItem(STORAGE_KEY);
  };

  const getUserProfile = (userId: string): StructuredUserProfile | null => {
    return userProfiles[userId] || null;
  };

  // Confidence indicator component
  const ConfidenceBar = ({ confidence }: { confidence: number }) => (
    <div className="w-full h-1.5 bg-gray-200 rounded-full mt-1">
      <div
        className={cn(
          "h-full rounded-full transition-all",
          confidence > 0.7 ? "bg-green-500" :
          confidence > 0.4 ? "bg-yellow-500" : "bg-gray-400"
        )}
        style={{ width: `${confidence * 100}%` }}
      />
    </div>
  );

  // Fairness mode selector
  const FairnessModeSelector = () => (
    <div className="flex items-center gap-2 mb-4">
      <Scale size={16} className="text-gray-500" />
      <span className="text-xs font-medium text-gray-500">Fairness Mode:</span>
      <div className="flex gap-1">
        {(['balanced', 'egalitarian', 'utilitarian'] as FairnessMode[]).map(mode => (
          <button
            key={mode}
            onClick={() => setFairnessMode(mode)}
            className={cn(
              "px-2 py-1 text-xs rounded-md transition-colors",
              fairnessMode === mode
                ? "bg-indigo-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            )}
            title={
              mode === 'balanced' ? 'Balance overall happiness with fairness' :
              mode === 'egalitarian' ? 'Prioritize the least happy person' :
              'Maximize total group happiness'
            }
          >
            {mode.charAt(0).toUpperCase() + mode.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );

  // Fairness metrics display
  const FairnessMetricsCard = ({ metrics, userSatisfaction }: {
    metrics: GroupFairnessMetrics;
    userSatisfaction: UserSatisfactionResult[];
  }) => (
    <div className="bg-gradient-to-br from-indigo-50 to-purple-50 p-4 rounded-xl border border-indigo-100 mb-4">
      <h4 className="font-semibold text-sm text-indigo-800 mb-3 flex items-center gap-2">
        <Scale size={16} />
        Fairness Analysis
      </h4>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-white/60 rounded-lg p-2">
          <div className="text-xs text-gray-500 flex items-center gap-1">
            <TrendingUp size={12} />
            Avg Satisfaction
          </div>
          <div className="text-lg font-bold text-indigo-700">
            {(metrics.utilitarian * 100).toFixed(0)}%
          </div>
        </div>
        <div className="bg-white/60 rounded-lg p-2">
          <div className="text-xs text-gray-500 flex items-center gap-1">
            <Users size={12} />
            Min Satisfaction
          </div>
          <div className="text-lg font-bold text-purple-700">
            {(metrics.egalitarian * 100).toFixed(0)}%
          </div>
        </div>
        <div className="bg-white/60 rounded-lg p-2 col-span-2">
          <div className="text-xs text-gray-500">Inequality Index (lower is better)</div>
          <div className="w-full h-2 bg-gray-200 rounded-full mt-1">
            <div
              className={cn(
                "h-full rounded-full",
                metrics.gini < 0.2 ? "bg-green-500" :
                metrics.gini < 0.4 ? "bg-yellow-500" : "bg-red-500"
              )}
              style={{ width: `${metrics.gini * 100}%` }}
            />
          </div>
          <div className="text-xs text-gray-400 mt-1">{(metrics.gini * 100).toFixed(0)}% inequality</div>
        </div>
      </div>

      {/* Per-user satisfaction */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-gray-600">Per-Person Satisfaction</div>
        {userSatisfaction.map(u => (
          <div key={u.userId} className="flex items-center gap-2">
            <span className="text-xs w-16 truncate">{u.userName}</span>
            <div className="flex-1 h-2 bg-gray-200 rounded-full">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  u.satisfied ? (
                    u.score > 0.7 ? "bg-green-500" :
                    u.score > 0.4 ? "bg-yellow-500" : "bg-orange-500"
                  ) : "bg-red-500"
                )}
                style={{ width: `${u.score * 100}%` }}
              />
            </div>
            <span className={cn(
              "text-xs font-mono w-10",
              u.satisfied ? "text-gray-600" : "text-red-600"
            )}>
              {(u.score * 100).toFixed(0)}%
            </span>
            {!u.satisfied && (
              <AlertCircle size={12} className="text-red-500" />
            )}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <main ref={containerRef} className="flex h-screen bg-gray-50 text-gray-900 font-sans">

      {/* LEFT: Chat Interface */}
      <div
        className="flex flex-col border-r bg-white"
        style={{ width: `${leftPanelWidth}%` }}
      >
        <div className="p-4 border-b bg-white flex justify-between items-center shadow-sm z-10">
          <h1 className="font-bold text-xl text-indigo-600">iNAGO Eats</h1>
          <div className="flex items-center gap-3">
            <div className="flex gap-2">
              {USERS.map((u) => (
                <button
                  key={u.id}
                  onClick={() => setActiveUser(u)}
                  className={cn(
                    "px-3 py-1 rounded-full text-xs font-medium transition-all",
                    activeUser.id === u.id
                      ? "ring-2 ring-offset-1 ring-indigo-500 scale-105"
                      : "opacity-60 hover:opacity-100",
                    u.color
                  )}
                >
                  {u.name}
                </button>
              ))}
            </div>
            <button
              onClick={resetChat}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
              title="Reset chat"
            >
              <RotateCcw size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50/50">
          {messages.length === 0 && (
            <div className="text-center text-gray-400 mt-20">
              <p>Start chatting to get recommendations!</p>
              <p className="text-sm mt-2">Try: &quot;I&apos;m vegan&quot;, &quot;I want BBQ&quot;, &quot;Let&apos;s keep it cheap&quot;</p>
            </div>
          )}

          {messages.map((m) => {
            const isMe = m.userId === activeUser.id;
            const user = USERS.find(u => u.id === m.userId);
            return (
              <div key={m.id} className={cn("flex flex-col", isMe ? "items-end" : "items-start")}>
                <span className="text-xs text-gray-400 mb-1 ml-1">{m.userName}</span>
                <div className={cn(
                  "px-4 py-2 rounded-2xl max-w-xs shadow-sm",
                  user?.color
                )}>
                  {m.text}
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-4 bg-white border-t">
          <form
            onSubmit={(e) => { e.preventDefault(); handleSend(); }}
            className="flex gap-2"
          >
            <input
              className="flex-1 border border-gray-300 rounded-full px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Message as ${activeUser.name}...`}
            />
            <button
              type="submit"
              className="bg-indigo-600 text-white p-2 rounded-full hover:bg-indigo-700 transition-colors"
            >
              <Send size={20} />
            </button>
          </form>
        </div>
      </div>

      {/* Resizable Divider */}
      <div
        className="w-1 bg-gray-200 hover:bg-indigo-400 cursor-col-resize transition-colors flex-shrink-0 relative group"
        onMouseDown={() => setIsDragging(true)}
      >
        <div className="absolute inset-y-0 -left-1 -right-1 group-hover:bg-indigo-400/20" />
      </div>

      {/* RIGHT: AI Dashboard */}
      <div
        className="flex flex-col bg-slate-50 p-6 overflow-y-auto"
        style={{ width: `${100 - leftPanelWidth}%` }}
      >

        {/* Persistent User Profiles */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">User Profiles</h2>
            {Object.keys(userProfiles).length > 0 && (
              <button
                onClick={resetAllProfiles}
                className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1"
                title="Reset all profiles"
              >
                <Trash2 size={12} />
                Clear All
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {USERS.map((u) => {
              const profile = getUserProfile(u.id);
              return (
                <div key={u.id} className={cn("p-3 rounded-lg shadow-sm border", u.color, "bg-opacity-50")}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <User size={14} className="text-gray-500"/>
                      <span className="font-semibold text-sm">{u.name}</span>
                    </div>
                    {profile && (
                      <button
                        onClick={() => resetUserProfile(u.id)}
                        className="text-gray-400 hover:text-red-500 transition-colors"
                        title={`Reset ${u.name}'s profile`}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                  {profile ? (
                    <div className="text-xs text-gray-600 space-y-1">
                      <p className="leading-relaxed">{getProfileSummary(profile)}</p>

                      {/* Dietary tags */}
                      {profile.dietary.restrictions.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {profile.dietary.restrictions.map(r => (
                            <span
                              key={r.type}
                              className={cn(
                                "px-1.5 py-0.5 rounded text-[10px]",
                                r.strictness === 'strict'
                                  ? "bg-red-100 text-red-700"
                                  : "bg-green-100 text-green-700"
                              )}
                            >
                              {r.type}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Cuisine tags */}
                      {profile.cuisinePreferences.favorites.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {profile.cuisinePreferences.favorites.slice(0, 3).map(c => (
                            <span key={c.cuisine} className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px]">
                              {c.cuisine}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Confidence bar */}
                      <div className="mt-2">
                        <span className="text-[10px] text-gray-400">Profile confidence</span>
                        <ConfidenceBar confidence={profile.confidence.overall} />
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 italic">No preferences saved yet</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <hr className="border-gray-200 my-4" />

        {/* Live Session Preferences */}
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Current Session</h2>
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(preferences).map(([user, pref]) => (
              <div key={user} className="bg-white p-3 rounded-lg shadow-sm border border-gray-100">
                <div className="flex items-center gap-2 mb-1">
                  <User size={14} className="text-gray-400"/>
                  <span className="font-semibold text-sm">{user}</span>
                </div>
                <p className="text-xs text-gray-600 leading-relaxed">{pref}</p>
              </div>
            ))}
            {Object.keys(preferences).length === 0 && (
              <div className="text-sm text-gray-400 italic col-span-2">Chat preferences will appear here...</div>
            )}
          </div>
        </div>

        <hr className="border-gray-200 my-4" />

        {/* Fairness Mode Selector */}
        <FairnessModeSelector />

        {/* Action Area */}
        <div className="flex flex-col gap-4">
          <button
            onClick={getRecommendation}
            disabled={messages.length === 0 || loading}
            className="flex items-center justify-center gap-2 w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-xl font-medium shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="animate-pulse">Analyzing fairness...</span>
            ) : (
              <>
                <Sparkles size={18} />
                Generate Fair Recommendation
              </>
            )}
          </button>

          {/* Fairness Metrics */}
          {fairnessResult && (
            <FairnessMetricsCard
              metrics={fairnessResult.metrics}
              userSatisfaction={fairnessResult.userSatisfaction}
            />
          )}

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
                      <span className="text-gray-400">•</span>
                      <span>{c.price}</span>
                    </div>
                    <div className="text-gray-400 text-[10px] mt-1 truncate">{c.location}</div>
                    <div className="flex justify-between items-center mt-2">
                      <span className="text-green-600 font-mono font-semibold">{(c.score * 100).toFixed(0)}% match</span>
                      {c.fairnessMetrics && (
                        <span className="text-purple-600 font-mono text-[10px]">
                          {(c.fairnessMetrics.egalitarian * 100).toFixed(0)}% fair
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
        </div>
      </div>
    </main>
  );
}
