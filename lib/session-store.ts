/**
 * Session Store
 *
 * Client-side session management using localStorage.
 * Manages session creation, joining, messaging, and profile updates.
 */

import {
  Session,
  SessionUser,
  SessionMessage,
  SessionSettings,
  StructuredUserProfile,
} from './types';
import { createEmptyProfile } from './fairness';

const SESSION_PREFIX = 'inago-session-';
const SESSION_INDEX_KEY = 'inago-session-index';

const USER_COLORS = [
  '#22c55e', // green
  '#3b82f6', // blue
  '#eab308', // yellow
  '#a855f7', // purple
  '#ef4444', // red
  '#06b6d4', // cyan
  '#f97316', // orange
  '#ec4899', // pink
];

function generateSessionCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Omit confusable chars (0/O, 1/I)
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function generateUserId(): string {
  return `u_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getNextColor(usedColors: string[]): string {
  for (const color of USER_COLORS) {
    if (!usedColors.includes(color)) {
      return color;
    }
  }
  return USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];
}

function saveSession(session: Session): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(`${SESSION_PREFIX}${session.id}`, JSON.stringify(session));

  // Update session index
  const index = getSessionIndex();
  const existing = index.findIndex(s => s.id === session.id);
  const entry = {
    id: session.id,
    createdAt: session.createdAt,
    userCount: session.users.length,
    hostName: session.users.find(u => u.isHost)?.name || 'Unknown',
  };
  if (existing >= 0) {
    index[existing] = entry;
  } else {
    index.push(entry);
  }
  localStorage.setItem(SESSION_INDEX_KEY, JSON.stringify(index));
}

function getSessionIndex(): { id: string; createdAt: number; userCount: number; hostName: string }[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(SESSION_INDEX_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function createSession(hostName: string): { session: Session; userId: string } {
  const sessionId = generateSessionCode();
  const userId = generateUserId();
  const now = Date.now();

  const hostProfile = createEmptyProfile(userId, hostName, USER_COLORS[0]);

  const host: SessionUser = {
    id: userId,
    name: hostName,
    color: USER_COLORS[0],
    joinedAt: now,
    isHost: true,
    profile: hostProfile,
  };

  const settings: SessionSettings = {
    maxUsers: 6,
    fairnessMode: 'balanced',
    allowLateJoin: true,
  };

  const session: Session = {
    id: sessionId,
    createdAt: now,
    createdBy: userId,
    status: 'waiting',
    users: [host],
    messages: [],
    recommendations: null,
    settings,
  };

  saveSession(session);
  return { session, userId };
}

export function joinSession(sessionId: string, userName: string): { session: Session; userId: string } | { error: string } {
  const session = getSession(sessionId);

  if (!session) {
    return { error: 'Session not found' };
  }

  if (session.users.length >= session.settings.maxUsers) {
    return { error: 'Session is full' };
  }

  if (!session.settings.allowLateJoin && session.status !== 'waiting') {
    return { error: 'Session has already started and does not allow late joins' };
  }

  const userId = generateUserId();
  const usedColors = session.users.map(u => u.color);
  const color = getNextColor(usedColors);
  const profile = createEmptyProfile(userId, userName, color);

  const newUser: SessionUser = {
    id: userId,
    name: userName,
    color,
    joinedAt: Date.now(),
    isHost: false,
    profile,
  };

  session.users.push(newUser);

  if (session.status === 'waiting') {
    session.status = 'active';
  }

  saveSession(session);
  return { session, userId };
}

export function addMessage(sessionId: string, userId: string, content: string): SessionMessage | null {
  const session = getSession(sessionId);
  if (!session) return null;

  const user = session.users.find(u => u.id === userId);
  if (!user) return null;

  const message: SessionMessage = {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    userId,
    userName: user.name,
    userColor: user.color,
    content,
    timestamp: Date.now(),
    type: 'user',
  };

  session.messages.push(message);

  if (session.status === 'waiting') {
    session.status = 'active';
  }

  saveSession(session);
  return message;
}

export function addSystemMessage(sessionId: string, content: string): SessionMessage | null {
  const session = getSession(sessionId);
  if (!session) return null;

  const message: SessionMessage = {
    id: `sys_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    userId: 'system',
    userName: 'iNAGO',
    userColor: '#6366f1',
    content,
    timestamp: Date.now(),
    type: 'system',
  };

  session.messages.push(message);
  saveSession(session);
  return message;
}

export function updateUserProfile(sessionId: string, userId: string, profile: StructuredUserProfile): void {
  const session = getSession(sessionId);
  if (!session) return;

  const user = session.users.find(u => u.id === userId);
  if (!user) return;

  user.profile = profile;
  saveSession(session);
}

export function updateSession(session: Session): void {
  saveSession(session);
}

export function getSession(sessionId: string): Session | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(`${SESSION_PREFIX}${sessionId}`);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

export function listRecentSessions(): { id: string; createdAt: number; userCount: number; hostName: string }[] {
  const index = getSessionIndex();
  // Sort by most recent first, limit to 10
  return index
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 10);
}

export function deleteSession(sessionId: string): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(`${SESSION_PREFIX}${sessionId}`);
  const index = getSessionIndex().filter(s => s.id !== sessionId);
  localStorage.setItem(SESSION_INDEX_KEY, JSON.stringify(index));
}
