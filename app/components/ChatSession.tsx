'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Session,
  SessionMessage,
  StructuredUserProfile,
  GroupFairnessMetrics,
  UserSatisfactionResult,
} from '@/lib/types';
import {
  updateSession,
  addMessage as storeAddMessage,
  addSystemMessage,
  getSession,
} from '@/lib/session-store';
import UserProfileCard from './UserProfileCard';
import FairnessMetricsCard from './FairnessMetricsCard';
import RecommendationResults from './RecommendationResults';
import {
  Send,
  Sparkles,
  RotateCcw,
  Scale,
  Code,
  Copy,
  Check,
  LogOut,
  Users,
} from 'lucide-react';
import {
  ConversationState,
  initConversation,
  processMessage as processConversationMessage,
  handleCritique,
  getReadinessStatus,
  generateElicitationQuestions,
} from '@/lib/conversation-engine';
import { createEmptyProfile } from '@/lib/fairness';
import InCarMode from './InCarMode';
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

interface ChatSessionProps {
  session: Session;
  currentUserId: string;
  onLeaveSession: () => void;
}

export default function ChatSession({ session: initialSession, currentUserId, onLeaveSession }: ChatSessionProps) {
  const [session, setSession] = useState<Session>(initialSession);
  const [input, setInput] = useState('');
  const [preferences, setPreferences] = useState<Record<string, string>>({});
  const [recommendation, setRecommendation] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CandidateRestaurant[]>([]);
  const [loading, setLoading] = useState(false);
  const [totalRestaurants, setTotalRestaurants] = useState(0);
  const [fairnessResult, setFairnessResult] = useState<FairnessResultData | null>(null);
  const [showRawJson, setShowRawJson] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inCarMode, setInCarMode] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Conversation engine state
  const [convState, setConvState] = useState<ConversationState>(() =>
    initConversation(initialSession.users)
  );

  // Resizable panel state
  const [leftPanelWidth, setLeftPanelWidth] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentUser = session.users.find(u => u.id === currentUserId);
  const isHost = session.createdBy === currentUserId;
  const readiness = getReadinessStatus(session.users);

  // Send initial greeting when session starts
  useEffect(() => {
    if (!convState.hasGreeted && session.messages.length === 0) {
      const dummyMessage: SessionMessage = {
        id: 'init',
        userId: currentUserId,
        userName: currentUser?.name || '',
        userColor: currentUser?.color || '',
        content: '',
        timestamp: Date.now(),
        type: 'user',
      };
      const { updatedState, systemResponse } = processConversationMessage(
        convState,
        dummyMessage,
        session.users,
      );
      setConvState(updatedState);
      if (systemResponse) {
        (async () => {
          await addSystemMessage(session.id, systemResponse);
          const refreshed = await getSession(session.id);
          if (refreshed) setSession(refreshed);
        })();
      }
    }
  // Only run once on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh session from server periodically (for multi-user sync)
  useEffect(() => {
    const interval = setInterval(async () => {
      const refreshed = await getSession(session.id);
      if (refreshed) {
        setSession(refreshed);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [session.id]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(scrollToBottom, [session.messages]);

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
    if (!input.trim() || !currentUser) return;

    const newMsg = await storeAddMessage(session.id, currentUserId, input.trim());
    if (!newMsg) return;

    // Refresh session from store
    let refreshed = await getSession(session.id);
    if (refreshed) {
      setSession(refreshed);
    }
    setInput('');

    // Process through conversation engine
    if (newMsg && refreshed) {
      const { updatedState, systemResponse } = processConversationMessage(
        convState,
        newMsg,
        refreshed.users,
      );

      // If critique detected, update the user's profile
      if (updatedState.phase === 'critique' && updatedState.critiques.length > convState.critiques.length) {
        const latestCritique = updatedState.critiques[updatedState.critiques.length - 1];
        const user = refreshed.users.find(u => u.id === latestCritique.userId);
        if (user) {
          user.profile = handleCritique(latestCritique, user.profile);
          await updateSession(refreshed);
        }
      }

      setConvState(updatedState);

      if (systemResponse) {
        await addSystemMessage(session.id, systemResponse);
        refreshed = await getSession(session.id);
        if (refreshed) setSession(refreshed);
      }

      // Analyze chat for preference extraction
      analyzeChat(refreshed!);
    }
  };

  const analyzeChat = async (currentSession: Session) => {
    try {
      // Convert session messages to the format the API expects
      const apiMessages = currentSession.messages
        .filter(m => m.type !== 'system')
        .map(m => ({
          userId: m.userId,
          userName: m.userName,
          text: m.content,
          timestamp: m.timestamp,
        }));

      // Build existing profiles from session users
      const existingProfiles: Record<string, StructuredUserProfile> = {};
      for (const user of currentSession.users) {
        existingProfiles[user.id] = user.profile;
      }

      const res = await fetch('/api/analyze', {
        method: 'POST',
        body: JSON.stringify({
          messages: apiMessages,
          existingProfiles,
        }),
      });
      const data = await res.json();

      if (!data.error) {
        if (data.preferences) {
          setPreferences(data.preferences);
        }

        // Update profiles in session
        if (data.profiles) {
          const refreshed = await getSession(currentSession.id);
          if (refreshed) {
            for (const [userId, profile] of Object.entries(data.profiles)) {
              const user = refreshed.users.find(u => u.id === userId);
              if (user) {
                user.profile = profile as StructuredUserProfile;
              }
            }
            await updateSession(refreshed);
            setSession(refreshed);
          }
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
      // Build profiles and preferences from session
      const userProfiles: Record<string, StructuredUserProfile> = {};
      for (const user of session.users) {
        userProfiles[user.id] = user.profile;
      }

      const apiMessages = session.messages
        .filter(m => m.type !== 'system')
        .map(m => ({
          userId: m.userId,
          userName: m.userName,
          text: m.content,
          timestamp: m.timestamp,
        }));

      const res = await fetch('/api/recommend', {
        method: 'POST',
        body: JSON.stringify({
          messages: apiMessages,
          preferences,
          userProfiles,
        }),
      });
      const data = await res.json();

      setCandidates(data.candidates || []);
      setRecommendation(data.recommendation || null);
      setTotalRestaurants(data.totalRestaurants || 0);

      if (data.fairnessResult) {
        setFairnessResult(data.fairnessResult);
      }

      // Update conversation state to recommendation phase
      setConvState(prev => ({ ...prev, phase: 'recommendation' }));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const resetChat = async () => {
    const refreshed = await getSession(session.id);
    if (refreshed) {
      refreshed.messages = [];
      refreshed.recommendations = null;
      await updateSession(refreshed);
      setSession(refreshed);
    }
    setPreferences({});
    setRecommendation(null);
    setCandidates([]);
    setTotalRestaurants(0);
    setFairnessResult(null);
    setInput('');
  };

  const resetUserProfile = async (userId: string) => {
    const refreshed = await getSession(session.id);
    if (refreshed) {
      const user = refreshed.users.find(u => u.id === userId);
      if (user) {
        user.profile = createEmptyProfile(userId, user.name, user.color);
        await updateSession(refreshed);
        setSession(refreshed);
      }
    }
  };

  const handleAskQuestions = async () => {
    const questions = generateElicitationQuestions(session.users);
    if (questions.length > 0) {
      await addSystemMessage(session.id, questions[0].question);
      const refreshed = await getSession(session.id);
      if (refreshed) setSession(refreshed);
    }
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(session.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (inCarMode) {
    return (
      <InCarMode
        session={session}
        currentUserId={currentUserId}
        convState={convState}
        onConvStateChange={setConvState}
        onSessionChange={setSession}
        onBack={() => setInCarMode(false)}
      />
    );
  }

  return (
    <main ref={containerRef} className="flex h-screen bg-gray-50 text-gray-900 font-sans">

      {/* LEFT: Chat Interface */}
      <div
        className="flex flex-col border-r bg-white"
        style={{ width: `${leftPanelWidth}%` }}
      >
        {/* Header */}
        <div className="p-4 border-b bg-white flex justify-between items-center shadow-sm z-10">
          <div className="flex items-center gap-3">
            <h1 className="font-bold text-xl text-indigo-600">iNAGO Eats</h1>
            <button
              onClick={handleCopyCode}
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded-md text-xs font-mono transition-all",
                copied ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              )}
              title="Copy session code"
            >
              {session.id}
              {copied ? <Check size={12} /> : <Copy size={12} />}
            </button>
          </div>
          <div className="flex items-center gap-3">
            {/* User pills */}
            <div className="flex gap-2">
              {session.users.map((u) => (
                <div
                  key={u.id}
                  className={cn(
                    "px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1",
                    u.id === currentUserId
                      ? "ring-2 ring-offset-1 ring-indigo-500"
                      : "opacity-70"
                  )}
                  style={{
                    backgroundColor: `${u.color}20`,
                    borderColor: u.color,
                    border: `1px solid ${u.color}60`,
                  }}
                >
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: u.color }} />
                  {u.name}
                  {u.isHost && <span className="text-[9px] opacity-60 ml-0.5">★</span>}
                </div>
              ))}
            </div>
            <button
              onClick={() => setInCarMode(true)}
              className="px-3 py-1 text-xs font-medium bg-gray-800 text-white rounded-full hover:bg-gray-700 transition-colors"
              title="Switch to In-Car Mode"
            >
              In-Car Mode
            </button>
            <button
              onClick={resetChat}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
              title="Reset chat"
            >
              <RotateCcw size={18} />
            </button>
            <button
              onClick={onLeaveSession}
              className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
              title="Leave session"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50/50">
          {session.messages.length === 0 && (
            <div className="text-center text-gray-400 mt-20">
              <p>Start chatting to get recommendations!</p>
              <p className="text-sm mt-2">Try: &quot;I&apos;m vegan&quot;, &quot;I want BBQ&quot;, &quot;Let&apos;s keep it cheap&quot;</p>
            </div>
          )}

          {session.messages.map((m) => {
            if (m.type === 'system') {
              return (
                <div key={m.id} className="flex justify-center">
                  <div className="bg-indigo-50 text-indigo-700 px-4 py-2 rounded-lg text-sm max-w-md text-center border border-indigo-100">
                    {m.content}
                  </div>
                </div>
              );
            }

            const isMe = m.userId === currentUserId;
            return (
              <div key={m.id} className={cn("flex flex-col", isMe ? "items-end" : "items-start")}>
                <div className="flex items-center gap-1.5 mb-1 ml-1">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: m.userColor }} />
                  <span className="text-xs text-gray-400">{m.userName}</span>
                </div>
                <div
                  className="px-4 py-2 rounded-2xl max-w-xs shadow-sm"
                  style={{
                    backgroundColor: `${m.userColor}15`,
                    border: `1px solid ${m.userColor}30`,
                  }}
                >
                  {m.content}
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Readiness Indicator */}
        <div className={cn(
          "px-4 py-2 text-xs flex items-center justify-between",
          readiness.ready
            ? "bg-green-50 text-green-700 border-t border-green-200"
            : "bg-amber-50 text-amber-700 border-t border-amber-200"
        )}>
          <span>{readiness.message}</span>
          {!readiness.ready && (
            <button
              onClick={handleAskQuestions}
              className="text-xs bg-amber-100 hover:bg-amber-200 text-amber-800 px-2 py-1 rounded transition-colors"
            >
              Ask Me Questions
            </button>
          )}
        </div>

        {/* Input */}
        <div className="p-4 bg-white border-t">
          <form
            onSubmit={(e) => { e.preventDefault(); handleSend(); }}
            className="flex gap-2"
          >
            <input
              className="flex-1 border border-gray-300 rounded-full px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Message as ${currentUser?.name || 'you'}...`}
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
        {/* User Profiles */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">User Profiles (Extracted)</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowRawJson(!showRawJson)}
                className={cn(
                  "text-xs flex items-center gap-1 px-2 py-1 rounded transition-colors",
                  showRawJson ? "bg-indigo-100 text-indigo-700" : "text-gray-500 hover:bg-gray-100"
                )}
                title="Toggle raw JSON view"
              >
                <Code size={12} />
                JSON
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {session.users.map((u) => (
              <UserProfileCard
                key={u.id}
                profile={u.profile}
                isCurrentUser={u.id === currentUserId}
                userColor={u.color}
                onReset={() => resetUserProfile(u.id)}
                showRawJson={showRawJson}
              />
            ))}
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
                  <Users size={14} className="text-gray-400"/>
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

        {/* Selection Method Banner */}
        <div className="flex items-center gap-2 mb-4 p-3 bg-indigo-50 rounded-lg border border-indigo-100">
          <Scale size={16} className="text-indigo-600" />
          <div className="text-xs text-indigo-700">
            <span className="font-semibold">Selection: </span>
            Pareto Filtering + Nash Welfare
          </div>
        </div>

        {/* Action Area */}
        <div className="flex flex-col gap-4">
          {isHost ? (
            <button
              onClick={getRecommendation}
              disabled={session.messages.filter(m => m.type !== 'system').length === 0 || loading}
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
          ) : (
            <div className="text-center text-sm text-gray-400 py-3 bg-gray-100 rounded-xl">
              Waiting for host to generate recommendation...
            </div>
          )}

          {/* Fairness Metrics */}
          {fairnessResult && (
            <FairnessMetricsCard
              metrics={fairnessResult.metrics}
              userSatisfaction={fairnessResult.userSatisfaction}
              users={session.users}
            />
          )}

          {/* Recommendation Results */}
          <RecommendationResults
            candidates={candidates}
            recommendation={recommendation || ''}
            totalRestaurants={totalRestaurants}
            fairnessResult={fairnessResult}
          />
        </div>
      </div>
    </main>
  );
}
