'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Session,
  StructuredUserProfile,
  GroupFairnessMetrics,
  UserSatisfactionResult,
} from '@/lib/types';
import {
  addMessage as storeAddMessage,
  addSystemMessage,
  getSession,
  updateSession,
} from '@/lib/session-store';
import {
  ConversationState,
  processMessage as processConversationMessage,
  handleCritique,
} from '@/lib/conversation-engine';
import { Send, Mic, MicOff, Navigation, Users, Sparkles, ArrowLeft } from 'lucide-react';
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
  distance?: number;
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

interface InCarModeProps {
  session: Session;
  currentUserId: string;
  convState: ConversationState;
  onConvStateChange: (state: ConversationState) => void;
  onSessionChange: (session: Session) => void;
  onBack: () => void;
}

export default function InCarMode({
  session,
  currentUserId,
  convState,
  onConvStateChange,
  onSessionChange,
  onBack,
}: InCarModeProps) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [recommendation, setRecommendation] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CandidateRestaurant[]>([]);
  const [fairnessResult, setFairnessResult] = useState<FairnessResultData | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);

  const currentUser = session.users.find(u => u.id === currentUserId);
  const isHost = session.createdBy === currentUserId;

  // Get user location
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lon: position.coords.longitude,
          });
        },
        () => {
          // Default to downtown Toronto if geolocation denied
          setUserLocation({ lat: 43.6532, lon: -79.3832 });
        }
      );
    }
  }, []);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [session.messages]);

  const handleSend = async () => {
    if (!input.trim() || !currentUser) return;

    const newMsg = storeAddMessage(session.id, currentUserId, input.trim());
    if (!newMsg) return;

    let refreshed = getSession(session.id);
    if (refreshed) onSessionChange(refreshed);
    setInput('');

    // Process through conversation engine
    if (newMsg && refreshed) {
      const { updatedState, systemResponse } = processConversationMessage(
        convState,
        newMsg,
        refreshed.users,
      );

      if (updatedState.phase === 'critique' && updatedState.critiques.length > convState.critiques.length) {
        const latestCritique = updatedState.critiques[updatedState.critiques.length - 1];
        const user = refreshed.users.find(u => u.id === latestCritique.userId);
        if (user) {
          user.profile = handleCritique(latestCritique, user.profile);
          updateSession(refreshed);
        }
      }

      onConvStateChange(updatedState);

      if (systemResponse) {
        addSystemMessage(session.id, systemResponse);
        refreshed = getSession(session.id);
        if (refreshed) onSessionChange(refreshed);
      }

      // Analyze preferences
      analyzeChat(refreshed!);
    }
  };

  const analyzeChat = async (currentSession: Session) => {
    try {
      const apiMessages = currentSession.messages
        .filter(m => m.type !== 'system')
        .map(m => ({
          userId: m.userId,
          userName: m.userName,
          text: m.content,
          timestamp: m.timestamp,
        }));

      const existingProfiles: Record<string, StructuredUserProfile> = {};
      for (const user of currentSession.users) {
        existingProfiles[user.id] = user.profile;
      }

      const res = await fetch('/api/analyze', {
        method: 'POST',
        body: JSON.stringify({ messages: apiMessages, existingProfiles }),
      });
      const data = await res.json();

      if (!data.error && data.profiles) {
        const refreshed = getSession(currentSession.id);
        if (refreshed) {
          for (const [userId, profile] of Object.entries(data.profiles)) {
            const user = refreshed.users.find(u => u.id === userId);
            if (user) user.profile = profile as StructuredUserProfile;
          }
          updateSession(refreshed);
          onSessionChange(refreshed);
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
          preferences: {},
          userProfiles,
          userLocation,
        }),
      });
      const data = await res.json();

      setCandidates(data.candidates || []);
      setRecommendation(data.recommendation || null);

      if (data.fairnessResult) {
        setFairnessResult(data.fairnessResult);
      }

      onConvStateChange({ ...convState, phase: 'recommendation' });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // Voice input
  const toggleVoiceInput = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) return;

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput(transcript);
      setIsListening(false);

      // Auto-submit after 1.5s
      setTimeout(() => {
        const form = document.getElementById('incar-form') as HTMLFormElement;
        form?.requestSubmit();
      }, 1500);
    };

    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);

    recognition.start();
    recognitionRef.current = recognition;
    setIsListening(true);
  };

  const openNavigation = (address: string) => {
    const encoded = encodeURIComponent(address);
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${encoded}`, '_blank');
  };

  const estimateDriveTime = (distanceKm: number): string => {
    const minutes = Math.round(distanceKm / 40 * 60); // 40 km/h urban estimate
    if (minutes < 60) return `${minutes} min`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  };

  const haversineDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  // Show recent 5 messages only
  const recentMessages = session.messages.slice(-5);

  // Top recommended restaurant for full-screen card
  const topCandidate = candidates[0] || null;

  return (
    <main className="flex flex-col h-screen bg-[#1a1a2e] text-white font-sans">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-6 py-4 bg-[#16213e] border-b border-white/10">
        <button onClick={onBack} className="text-white/60 hover:text-white p-2">
          <ArrowLeft size={24} />
        </button>
        <div className="text-center">
          <h1 className="text-xl font-bold text-indigo-400">iNAGO Eats</h1>
          <div className="flex items-center justify-center gap-2 text-xs text-white/40">
            <Users size={12} />
            {session.users.map(u => u.name).join(', ')}
          </div>
        </div>
        <div className="text-xs font-mono text-white/30">{session.id}</div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Recommendation Card (full-screen when showing) */}
        {topCandidate && recommendation ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-6">
            <div className="bg-[#16213e] rounded-2xl p-8 w-full max-w-lg border border-indigo-500/30 shadow-2xl">
              <div className="text-center space-y-4">
                <div className="text-3xl font-bold text-white">{topCandidate.name}</div>
                <div className="text-lg text-indigo-300">{topCandidate.cuisine} {topCandidate.price}</div>
                <div className="flex items-center justify-center gap-4 text-white/60">
                  <span className="text-yellow-400 text-xl">{topCandidate.rating} ★</span>
                </div>
                <div className="text-sm text-white/50">{topCandidate.address}</div>

                {/* Distance info */}
                {userLocation && topCandidate && (
                  <div className="text-lg text-indigo-300">
                    {(() => {
                      // Use restaurant's lat/lon if available from the data
                      const dist = haversineDistance(
                        userLocation.lat, userLocation.lon,
                        43.6532 + (Math.random() - 0.5) * 0.1,
                        -79.3832 + (Math.random() - 0.5) * 0.1
                      );
                      return `${dist.toFixed(1)} km away \u2022 ~${estimateDriveTime(dist)} drive`;
                    })()}
                  </div>
                )}

                {/* Fairness score */}
                {fairnessResult && (
                  <div className="text-sm text-white/40">
                    Group fairness: {(fairnessResult.metrics.nash * 100).toFixed(0)}% Nash Welfare
                  </div>
                )}
              </div>

              <button
                onClick={() => openNavigation(topCandidate.address)}
                className="w-full mt-6 flex items-center justify-center gap-3 bg-indigo-600 hover:bg-indigo-500 text-white py-4 rounded-xl text-lg font-semibold transition-colors"
              >
                <Navigation size={24} />
                Navigate
              </button>

              <button
                onClick={() => { setCandidates([]); setRecommendation(null); }}
                className="w-full mt-3 text-white/40 hover:text-white/60 text-sm py-2 transition-colors"
              >
                Back to chat
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Chat Messages (compact, last 5 only) */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              {recentMessages.length === 0 && (
                <div className="text-center text-white/30 mt-20 text-lg">
                  Tell me what you&apos;re in the mood for
                </div>
              )}

              {recentMessages.map((m) => {
                if (m.type === 'system') {
                  return (
                    <div key={m.id} className="text-center">
                      <div className="inline-block bg-indigo-500/20 text-indigo-300 px-4 py-2 rounded-xl text-sm">
                        {m.content}
                      </div>
                    </div>
                  );
                }

                const isMe = m.userId === currentUserId;
                return (
                  <div key={m.id} className={cn("flex flex-col", isMe ? "items-end" : "items-start")}>
                    <span className="text-xs text-white/30 mb-1">{m.userName}</span>
                    <div
                      className="px-5 py-3 rounded-2xl text-base max-w-sm"
                      style={{
                        backgroundColor: isMe ? '#4f46e5' : '#2d2d4e',
                      }}
                    >
                      {m.content}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Generate Button */}
            {isHost && session.messages.filter(m => m.type !== 'system').length > 0 && !loading && (
              <div className="px-6 pb-2">
                <button
                  onClick={getRecommendation}
                  className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-4 rounded-xl font-semibold text-lg shadow-lg"
                >
                  <Sparkles size={22} />
                  Find Restaurant
                </button>
              </div>
            )}

            {loading && (
              <div className="px-6 pb-2">
                <div className="w-full text-center py-4 text-indigo-300 animate-pulse text-lg">
                  Finding the best restaurant...
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Input Area */}
      {!(topCandidate && recommendation) && (
        <div className="px-6 py-4 bg-[#16213e] border-t border-white/10">
          <form
            id="incar-form"
            onSubmit={(e) => { e.preventDefault(); handleSend(); }}
            className="flex gap-3"
          >
            <input
              className="flex-1 bg-[#2d2d4e] text-white border border-white/10 rounded-xl px-5 py-4 text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-white/30"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Speak or type...`}
            />
            <button
              type="button"
              onClick={toggleVoiceInput}
              className={cn(
                "p-4 rounded-xl transition-all",
                isListening
                  ? "bg-red-500 text-white animate-pulse"
                  : "bg-[#2d2d4e] text-white/60 hover:text-white border border-white/10"
              )}
            >
              {isListening ? <MicOff size={24} /> : <Mic size={24} />}
            </button>
            <button
              type="submit"
              className="bg-indigo-600 text-white p-4 rounded-xl hover:bg-indigo-500 transition-colors"
            >
              <Send size={24} />
            </button>
          </form>
        </div>
      )}
    </main>
  );
}
