'use client';

import { useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Sidebar from '../../../components/Sidebar';
import Inspector, { type ToolLogEntry } from '../../../components/Inspector';
import ChatPanel from '../../../components/ChatPanel';

export default function ConversationPage() {
  const params = useParams<{ conversationId: string }>();
  const search = useSearchParams();
  const conversationId = params.conversationId;
  const seed = search.get('seed') ?? undefined;
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [toolLog, setToolLog] = useState<ToolLogEntry[]>([]);

  return (
    <>
      <Sidebar activeConversationId={conversationId} onActiveProjectChange={setActiveProjectId} />
      <ChatPanel
        conversationId={conversationId}
        seedPrompt={seed}
        onConversationRenamed={() => setRefreshTick((t) => t + 1)}
        onToolLog={setToolLog}
        onActivity={() => setRefreshTick((t) => t + 1)}
      />
      <Inspector
        conversationId={conversationId}
        projectId={activeProjectId}
        refreshSignal={refreshTick}
        toolLog={toolLog}
      />
    </>
  );
}
