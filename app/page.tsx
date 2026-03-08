"use client";

import { useState } from 'react';
import { Session } from '@/lib/types';
import SessionLobby from '@/app/components/SessionLobby';
import ChatSession from '@/app/components/ChatSession';

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  if (!session || !currentUserId) {
    return (
      <SessionLobby
        onSessionReady={(s, uid) => {
          setSession(s);
          setCurrentUserId(uid);
        }}
      />
    );
  }

  return (
    <ChatSession
      session={session}
      currentUserId={currentUserId}
      onLeaveSession={() => {
        setSession(null);
        setCurrentUserId(null);
      }}
    />
  );
}
