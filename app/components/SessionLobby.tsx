'use client';

import { useState, useEffect } from 'react';
import { Session } from '@/lib/types';
import { createSession, joinSession, listRecentSessions, deleteSession } from '@/lib/session-store';
import { Plus, LogIn, Copy, Check, ArrowRight, Trash2, Clock, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SessionLobbyProps {
  onSessionReady: (session: Session, currentUserId: string) => void;
}

type LobbyState = 'landing' | 'create' | 'join';

export default function SessionLobby({ onSessionReady }: SessionLobbyProps) {
  const [state, setState] = useState<LobbyState>('landing');
  const [name, setName] = useState('');
  const [sessionCode, setSessionCode] = useState('');
  const [error, setError] = useState('');
  const [createdSession, setCreatedSession] = useState<{ session: Session; userId: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [recentSessions, setRecentSessions] = useState<{ id: string; createdAt: number; userCount: number; hostName: string }[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Load recent sessions on mount
  useEffect(() => {
    listRecentSessions().then(setRecentSessions);
  }, []);

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('Please enter your name');
      return;
    }
    setError('');
    setIsLoading(true);
    try {
      const result = await createSession(name.trim());
      setCreatedSession(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create session');
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoin = async () => {
    if (!name.trim()) {
      setError('Please enter your name');
      return;
    }
    if (!sessionCode.trim() || sessionCode.trim().length !== 6) {
      setError('Please enter a valid 6-character session code');
      return;
    }
    setError('');
    setIsLoading(true);
    try {
      const result = await joinSession(sessionCode.trim().toUpperCase(), name.trim());
      if ('error' in result) {
        setError(result.error);
        return;
      }
      onSessionReady(result.session, result.userId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to join session');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRejoin = async (sessionId: string) => {
    setIsLoading(true);
    try {
      const result = await joinSession(sessionId, name.trim() || 'Returning User');
      if ('error' in result) {
        setError(result.error);
        return;
      }
      onSessionReady(result.session, result.userId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to rejoin session');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyCode = () => {
    if (createdSession) {
      navigator.clipboard.writeText(createdSession.session.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    await deleteSession(sessionId);
    const updated = await listRecentSessions();
    setRecentSessions(updated);
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  // Landing State
  if (state === 'landing') {
    return (
      <main className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="text-center mb-10">
            <h1 className="text-5xl font-bold text-indigo-600 mb-3">iNAGO Eats</h1>
            <p className="text-gray-500 text-lg">Fair group dining decisions, powered by AI</p>
          </div>

          <div className="space-y-4 mb-8">
            <button
              onClick={() => setState('create')}
              className="w-full flex items-center justify-center gap-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-4 rounded-xl font-semibold text-lg shadow-lg hover:shadow-xl transition-all hover:scale-[1.02]"
            >
              <Plus size={22} />
              Create Session
            </button>
            <button
              onClick={() => setState('join')}
              className="w-full flex items-center justify-center gap-3 bg-white text-indigo-600 py-4 rounded-xl font-semibold text-lg shadow-md border-2 border-indigo-200 hover:border-indigo-400 hover:shadow-lg transition-all hover:scale-[1.02]"
            >
              <LogIn size={22} />
              Join Session
            </button>
          </div>

          {/* Recent Sessions */}
          {recentSessions.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Clock size={14} />
                Recent Sessions
              </h3>
              <div className="space-y-2">
                {recentSessions.map(s => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between bg-white rounded-lg p-3 shadow-sm border border-gray-100"
                  >
                    <div>
                      <span className="font-mono text-sm font-semibold text-indigo-600">{s.id}</span>
                      <span className="text-xs text-gray-400 ml-2">
                        {s.hostName} + {s.userCount - 1} others
                      </span>
                      <span className="text-xs text-gray-300 ml-2">{formatTime(s.createdAt)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleRejoin(s.id)}
                        className="text-xs text-indigo-600 hover:text-indigo-800 font-medium px-2 py-1 rounded hover:bg-indigo-50"
                      >
                        Rejoin
                      </button>
                      <button
                        onClick={() => handleDeleteSession(s.id)}
                        className="text-gray-300 hover:text-red-500 transition-colors p-1"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    );
  }

  // Create Session State
  if (state === 'create') {
    return (
      <main className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <button
            onClick={() => { setState('landing'); setError(''); setCreatedSession(null); }}
            className="text-sm text-gray-500 hover:text-gray-700 mb-6 flex items-center gap-1"
          >
            &larr; Back
          </button>

          <h2 className="text-2xl font-bold text-gray-800 mb-6">Create a Session</h2>

          {!createdSession ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Your Name</label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Enter your name"
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-lg"
                  onKeyDown={e => e.key === 'Enter' && handleCreate()}
                  autoFocus
                />
              </div>
              {error && <p className="text-red-500 text-sm">{error}</p>}
              <button
                onClick={handleCreate}
                disabled={!name.trim() || isLoading}
                className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Creating...' : 'Create & Get Code'}
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="bg-white rounded-xl p-6 shadow-lg border border-indigo-100 text-center">
                <p className="text-sm text-gray-500 mb-2">Share this code with your group:</p>
                <div className="flex items-center justify-center gap-3">
                  <span className="text-4xl font-mono font-bold text-indigo-600 tracking-widest">
                    {createdSession.session.id}
                  </span>
                  <button
                    onClick={handleCopyCode}
                    className={cn(
                      "p-2 rounded-lg transition-all",
                      copied ? "bg-green-100 text-green-600" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                    )}
                  >
                    {copied ? <Check size={20} /> : <Copy size={20} />}
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-3">
                  Others can join by entering this code
                </p>
              </div>

              <button
                onClick={() => onSessionReady(createdSession.session, createdSession.userId)}
                className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-4 rounded-xl font-semibold text-lg shadow-lg hover:shadow-xl transition-all hover:scale-[1.02]"
              >
                Start Chatting
                <ArrowRight size={20} />
              </button>
            </div>
          )}
        </div>
      </main>
    );
  }

  // Join Session State
  return (
    <main className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <button
          onClick={() => { setState('landing'); setError(''); }}
          className="text-sm text-gray-500 hover:text-gray-700 mb-6 flex items-center gap-1"
        >
          &larr; Back
        </button>

        <h2 className="text-2xl font-bold text-gray-800 mb-6">Join a Session</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Session Code</label>
            <input
              value={sessionCode}
              onChange={e => setSessionCode(e.target.value.toUpperCase().slice(0, 6))}
              placeholder="ABC123"
              className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-2xl font-mono text-center tracking-widest uppercase"
              maxLength={6}
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Your Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Enter your name"
              className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-lg"
              onKeyDown={e => e.key === 'Enter' && handleJoin()}
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            onClick={handleJoin}
            disabled={!name.trim() || sessionCode.length !== 6 || isLoading}
            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Users size={18} />
            {isLoading ? 'Joining...' : 'Join Session'}
          </button>
        </div>
      </div>
    </main>
  );
}
