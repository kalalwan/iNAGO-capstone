"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { USERS } from '@/lib/data';
import { Message } from '@/lib/types';
import { Send, Sparkles, User, RotateCcw, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// Persistent memory type for each user
interface UserMemory {
  preferences: string;
  dietaryRestrictions: string[];
  favoriteCuisines: string[];
  pricePreference: string;
  locationPreference: string;
  lastUpdated: number;
}

const STORAGE_KEY = 'inago-user-memories';

// Load memories from localStorage
const loadMemories = (): Record<string, UserMemory> => {
  if (typeof window === 'undefined') return {};
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
};

// Save memories to localStorage
const saveMemories = (memories: Record<string, UserMemory>) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(memories));
};

export default function Home() {
  const [activeUser, setActiveUser] = useState(USERS[0]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [preferences, setPreferences] = useState<Record<string, string>>({});
  const [recommendation, setRecommendation] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<{ id: string; name: string; cuisine: string; price: string; rating: number; location: string; score: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [totalRestaurants, setTotalRestaurants] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Persistent user memories
  const [userMemories, setUserMemories] = useState<Record<string, UserMemory>>({});

  // Resizable panel state
  const [leftPanelWidth, setLeftPanelWidth] = useState(50); // percentage
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load memories on mount
  useEffect(() => {
    setUserMemories(loadMemories());
  }, []);

  // Save memories whenever they change
  useEffect(() => {
    if (Object.keys(userMemories).length > 0) {
      saveMemories(userMemories);
    }
  }, [userMemories]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [messages]);

  // Handle mouse move for resizing
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !containerRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const newWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100;

    // Clamp between 25% and 75%
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

    // Trigger analysis every time (for MVP responsiveness)
    analyzeChat(newMessages);
  };

  const analyzeChat = async (msgs: Message[]) => {
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        body: JSON.stringify({
          messages: msgs,
          existingMemories: userMemories
        }),
      });
      const data = await res.json();
      // Only set preferences if we got valid data (not an error response)
      if (!data.error && typeof data === 'object') {
        setPreferences(data.preferences || data);

        // Update persistent memories if returned
        if (data.updatedMemories) {
          setUserMemories(prev => ({
            ...prev,
            ...data.updatedMemories
          }));
        } else {
          // Fallback: update memories from preferences
          const newMemories: Record<string, UserMemory> = { ...userMemories };
          Object.entries(data.preferences || data).forEach(([userName, pref]) => {
            const userId = USERS.find(u => u.name === userName)?.id;
            if (userId && typeof pref === 'string') {
              newMemories[userId] = {
                preferences: pref,
                dietaryRestrictions: extractDietaryRestrictions(pref),
                favoriteCuisines: extractCuisines(pref),
                pricePreference: extractPricePreference(pref),
                locationPreference: extractLocationPreference(pref),
                lastUpdated: Date.now()
              };
            }
          });
          setUserMemories(newMemories);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Helper functions to extract info from preference strings
  const extractDietaryRestrictions = (pref: string): string[] => {
    const restrictions: string[] = [];
    const lower = pref.toLowerCase();
    if (lower.includes('vegan')) restrictions.push('vegan');
    if (lower.includes('vegetarian')) restrictions.push('vegetarian');
    if (lower.includes('gluten-free') || lower.includes('gluten free')) restrictions.push('gluten-free');
    if (lower.includes('halal')) restrictions.push('halal');
    if (lower.includes('kosher')) restrictions.push('kosher');
    if (lower.includes('dairy-free') || lower.includes('dairy free')) restrictions.push('dairy-free');
    return restrictions;
  };

  const extractCuisines = (pref: string): string[] => {
    const cuisines: string[] = [];
    const lower = pref.toLowerCase();
    const cuisineTypes = ['italian', 'chinese', 'japanese', 'thai', 'indian', 'mexican', 'korean', 'vietnamese', 'bbq', 'seafood', 'sushi', 'pizza', 'burger', 'asian', 'mediterranean'];
    cuisineTypes.forEach(c => {
      if (lower.includes(c)) cuisines.push(c);
    });
    return cuisines;
  };

  const extractPricePreference = (pref: string): string => {
    const lower = pref.toLowerCase();
    if (lower.includes('cheap') || lower.includes('budget') || lower.includes('affordable')) return 'budget';
    if (lower.includes('expensive') || lower.includes('upscale') || lower.includes('fancy')) return 'upscale';
    if (lower.includes('moderate') || lower.includes('mid-range')) return 'moderate';
    return '';
  };

  const extractLocationPreference = (pref: string): string => {
    const lower = pref.toLowerCase();
    if (lower.includes('downtown')) return 'downtown';
    if (lower.includes('midtown')) return 'midtown';
    if (lower.includes('north')) return 'north';
    return '';
  };

  const getRecommendation = async () => {
    setLoading(true);
    setRecommendation(null);
    try {
      const res = await fetch('/api/recommend', {
        method: 'POST',
        body: JSON.stringify({
          messages,
          preferences,
          userMemories // Include persistent memories
        }),
      });
      const data = await res.json();
      setCandidates(data.candidates || []);
      setRecommendation(data.recommendation || null);
      setTotalRestaurants(data.totalRestaurants || 0);
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
    setInput("");
  };

  const resetUserMemory = (userId: string) => {
    setUserMemories(prev => {
      const newMemories = { ...prev };
      delete newMemories[userId];
      saveMemories(newMemories);
      return newMemories;
    });
  };

  const resetAllMemories = () => {
    setUserMemories({});
    localStorage.removeItem(STORAGE_KEY);
  };

  // Get memory for display
  const getUserMemory = (userId: string): UserMemory | null => {
    return userMemories[userId] || null;
  };

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

        {/* Persistent User Memories */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Persistent User Profiles</h2>
            {Object.keys(userMemories).length > 0 && (
              <button
                onClick={resetAllMemories}
                className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1"
                title="Reset all memories"
              >
                <Trash2 size={12} />
                Clear All
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {USERS.map((u) => {
              const memory = getUserMemory(u.id);
              return (
                <div key={u.id} className={cn("p-3 rounded-lg shadow-sm border", u.color, "bg-opacity-50")}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <User size={14} className="text-gray-500"/>
                      <span className="font-semibold text-sm">{u.name}</span>
                    </div>
                    {memory && (
                      <button
                        onClick={() => resetUserMemory(u.id)}
                        className="text-gray-400 hover:text-red-500 transition-colors"
                        title={`Reset ${u.name}'s memory`}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                  {memory ? (
                    <div className="text-xs text-gray-600 space-y-1">
                      <p className="leading-relaxed">{memory.preferences}</p>
                      {memory.dietaryRestrictions.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {memory.dietaryRestrictions.map(r => (
                            <span key={r} className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[10px]">
                              {r}
                            </span>
                          ))}
                        </div>
                      )}
                      {memory.favoriteCuisines.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {memory.favoriteCuisines.map(c => (
                            <span key={c} className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px]">
                              {c}
                            </span>
                          ))}
                        </div>
                      )}
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

        {/* Live Group Model (from current chat) */}
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

        {/* Action Area */}
        <div className="flex flex-col gap-4">
            <button
              onClick={getRecommendation}
              disabled={messages.length === 0 || loading}
              className="flex items-center justify-center gap-2 w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-xl font-medium shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="animate-pulse">Thinking...</span>
              ) : (
                <>
                  <Sparkles size={18} />
                  Generate Recommendation
                </>
              )}
            </button>

            {/* Retrieval Results */}
            {candidates.length > 0 && (
                <div className="mb-4">
                    <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">
                      Top Matches from {totalRestaurants} Toronto Restaurants
                    </h3>
                    <div className="flex gap-2 overflow-x-auto pb-2">
                        {candidates.map((c) => (
                            <div key={c.id} className="min-w-[160px] bg-white p-3 rounded-lg border text-xs shadow-sm">
                                <div className="font-bold truncate text-sm">{c.name}</div>
                                <div className="text-gray-500 mt-1">{c.cuisine}</div>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="text-yellow-600">{c.rating} ★</span>
                                  <span className="text-gray-400">•</span>
                                  <span>{c.price}</span>
                                </div>
                                <div className="text-gray-400 text-[10px] mt-1 truncate">{c.location}</div>
                                <div className="text-green-600 font-mono mt-2 font-semibold">{(c.score * 100).toFixed(0)}% match</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Final Output */}
            {recommendation && (
              <div className="bg-white p-6 rounded-xl shadow-md border border-indigo-100">
                <h3 className="font-bold text-lg mb-2 text-gray-800">Recommendation</h3>
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
