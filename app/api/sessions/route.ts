/**
 * Server-Side Session API
 *
 * Stores sessions in server memory so multiple browsers/devices
 * can access the same session by code.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  Session,
  SessionUser,
  SessionMessage,
  SessionSettings,
  StructuredUserProfile,
  Vote,
} from '@/lib/types';
import { createEmptyProfile } from '@/lib/fairness';

// ============================================
// In-Memory Session Store
// ============================================

const sessions = new Map<string, Session>();

const USER_COLORS = [
  '#22c55e', '#3b82f6', '#eab308', '#a855f7',
  '#ef4444', '#06b6d4', '#f97316', '#ec4899',
];

function generateSessionCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
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
    if (!usedColors.includes(color)) return color;
  }
  return USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];
}

// ============================================
// GET  /api/sessions?id=CODE       — get single session
// GET  /api/sessions?list=1        — list recent sessions
// ============================================

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  // List all sessions
  if (searchParams.get('list')) {
    const list = Array.from(sessions.values())
      .map(s => ({
        id: s.id,
        createdAt: s.createdAt,
        userCount: s.users.length,
        hostName: s.users.find(u => u.isHost)?.name || 'Unknown',
      }))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 10);
    return NextResponse.json(list);
  }

  // Get single session
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Missing session id' }, { status: 400 });
  }

  const session = sessions.get(id.toUpperCase());
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  return NextResponse.json(session);
}

// ============================================
// POST /api/sessions
// body: { action, ... }
// ============================================

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action } = body;

  switch (action) {
    // ---- CREATE ----
    case 'create': {
      const { hostName } = body as { hostName: string; action: string };
      if (!hostName) {
        return NextResponse.json({ error: 'Missing hostName' }, { status: 400 });
      }

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
        votes: [],
        settings,
      };

      sessions.set(sessionId, session);
      return NextResponse.json({ session, userId });
    }

    // ---- JOIN ----
    case 'join': {
      const { sessionId: joinId, userName } = body as { sessionId: string; userName: string; action: string };
      if (!joinId || !userName) {
        return NextResponse.json({ error: 'Missing sessionId or userName' }, { status: 400 });
      }

      const session = sessions.get(joinId.toUpperCase());
      if (!session) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 });
      }

      if (session.users.length >= session.settings.maxUsers) {
        return NextResponse.json({ error: 'Session is full' }, { status: 400 });
      }

      if (!session.settings.allowLateJoin && session.status !== 'waiting') {
        return NextResponse.json({ error: 'Session has already started and does not allow late joins' }, { status: 400 });
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

      return NextResponse.json({ session, userId });
    }

    // ---- ADD MESSAGE ----
    case 'addMessage': {
      const { sessionId: msgSid, userId: msgUid, content } = body as {
        sessionId: string; userId: string; content: string; action: string;
      };
      const session = sessions.get(msgSid);
      if (!session) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 });
      }
      const user = session.users.find(u => u.id === msgUid);
      if (!user) {
        return NextResponse.json({ error: 'User not found in session' }, { status: 404 });
      }

      const message: SessionMessage = {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        userId: msgUid,
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

      return NextResponse.json({ message });
    }

    // ---- VOTE ----
    case 'vote': {
      const { sessionId: voteSid, userId: voteUid, restaurantId, vote: voteDir } = body as {
        sessionId: string; userId: string; restaurantId: string; vote: 'up' | 'down'; action: string;
      };
      const session = sessions.get(voteSid);
      if (!session) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 });
      }
      if (!session.users.find(u => u.id === voteUid)) {
        return NextResponse.json({ error: 'User not found in session' }, { status: 404 });
      }

      // Initialize votes array for older sessions
      if (!session.votes) {
        session.votes = [];
      }

      // Upsert: remove existing vote by this user on this restaurant, then add new one
      session.votes = session.votes.filter(
        v => !(v.userId === voteUid && v.restaurantId === restaurantId)
      );
      const newVote: Vote = {
        restaurantId,
        userId: voteUid,
        vote: voteDir,
        timestamp: Date.now(),
      };
      session.votes.push(newVote);

      return NextResponse.json({ vote: newVote, votes: session.votes });
    }

    // ---- ADD SYSTEM MESSAGE ----
    case 'addSystemMessage': {
      const { sessionId: sysSid, content: sysContent } = body as {
        sessionId: string; content: string; action: string;
      };
      const session = sessions.get(sysSid);
      if (!session) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 });
      }

      const sysMsg: SessionMessage = {
        id: `sys_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        userId: 'system',
        userName: 'iNAGO',
        userColor: '#6366f1',
        content: sysContent,
        timestamp: Date.now(),
        type: 'system',
      };

      session.messages.push(sysMsg);
      return NextResponse.json({ message: sysMsg });
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
}

// ============================================
// PUT /api/sessions
// body: { sessionId, ...updates } — full session update or profile update
// ============================================

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { action } = body;

  if (action === 'updateProfile') {
    const { sessionId, userId, profile } = body as {
      sessionId: string; userId: string; profile: StructuredUserProfile; action: string;
    };
    const session = sessions.get(sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    const user = session.users.find(u => u.id === userId);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    user.profile = profile;
    return NextResponse.json({ ok: true });
  }

  // Full session update
  const { session: updatedSession } = body as { session: Session; action?: string };
  if (!updatedSession || !updatedSession.id) {
    return NextResponse.json({ error: 'Missing session data' }, { status: 400 });
  }
  sessions.set(updatedSession.id, updatedSession);
  return NextResponse.json({ ok: true });
}

// ============================================
// DELETE /api/sessions?id=CODE
// ============================================

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Missing session id' }, { status: 400 });
  }
  sessions.delete(id.toUpperCase());
  return NextResponse.json({ ok: true });
}
