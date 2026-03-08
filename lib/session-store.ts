/**
 * Session Store
 *
 * Client-side API wrapper for server-side session management.
 * All sessions are stored on the server so multiple browsers
 * can access the same session by code.
 */

import {
  Session,
  SessionMessage,
  StructuredUserProfile,
  Vote,
} from './types';

const API_BASE = '/api/sessions';

// ============================================
// Session CRUD
// ============================================

export async function createSession(hostName: string): Promise<{ session: Session; userId: string }> {
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'create', hostName }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to create session');
  }
  return res.json();
}

export async function joinSession(
  sessionId: string,
  userName: string
): Promise<{ session: Session; userId: string } | { error: string }> {
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'join', sessionId, userName }),
  });
  if (!res.ok) {
    const err = await res.json();
    return { error: err.error || 'Failed to join session' };
  }
  return res.json();
}

export async function getSession(sessionId: string): Promise<Session | null> {
  try {
    const res = await fetch(`${API_BASE}?id=${encodeURIComponent(sessionId)}`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function listRecentSessions(): Promise<
  { id: string; createdAt: number; userCount: number; hostName: string }[]
> {
  try {
    const res = await fetch(`${API_BASE}?list=1`);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  await fetch(`${API_BASE}?id=${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
}

// ============================================
// Messages
// ============================================

export async function addMessage(
  sessionId: string,
  userId: string,
  content: string
): Promise<SessionMessage | null> {
  try {
    const res = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'addMessage', sessionId, userId, content }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.message;
  } catch {
    return null;
  }
}

export async function addSystemMessage(
  sessionId: string,
  content: string
): Promise<SessionMessage | null> {
  try {
    const res = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'addSystemMessage', sessionId, content }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.message;
  } catch {
    return null;
  }
}

// ============================================
// Voting
// ============================================

export async function submitVote(
  sessionId: string,
  userId: string,
  restaurantId: string,
  vote: 'up' | 'down'
): Promise<{ vote: Vote; votes: Vote[] } | null> {
  try {
    const res = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'vote', sessionId, userId, restaurantId, vote }),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// ============================================
// Profile & Session Updates
// ============================================

export async function updateUserProfile(
  sessionId: string,
  userId: string,
  profile: StructuredUserProfile
): Promise<void> {
  await fetch(API_BASE, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'updateProfile', sessionId, userId, profile }),
  });
}

export async function updateSession(session: Session): Promise<void> {
  await fetch(API_BASE, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session }),
  });
}
