/**
 * App Component
 *
 * Top-level view switcher. The app is small enough that a full router isn't
 * warranted, so we toggle between chat, create/edit agent, MCP tools, and evals/feedback
 * with simple local state. Switching views unmounts the other page, which means
 * returning to chat re-fetches the agent list (so a newly created agent shows up).
 */

import React, { useState } from 'react';
import SimpleChatInterface from './components/Main';
import CreateAgentPage from './components/CreateAgentPage';
import McpToolsPage from './components/McpToolsPage';
import EvalsPage from './components/EvalsPage';

type View = 'chat' | 'create' | 'edit' | 'mcp' | 'evals';

const App: React.FC = () => {
  const [view, setView] = useState<View>('chat');
  const [editAgentName, setEditAgentName] = useState<string | undefined>(undefined);

  if (view === 'mcp') {
    return <McpToolsPage onBack={() => setView('chat')} />;
  }

  if (view === 'evals') {
    return <EvalsPage onBack={() => setView('chat')} />;
  }

  if (view === 'create' || view === 'edit') {
    return (
      <CreateAgentPage
        editAgentName={view === 'edit' ? editAgentName : undefined}
        onBack={() => setView('chat')}
        onCreated={() => setView('chat')}
      />
    );
  }

  return (
    <SimpleChatInterface
      onNavigateToCreate={() => { setEditAgentName(undefined); setView('create'); }}
      onEditAgent={(agentName) => { setEditAgentName(agentName); setView('edit'); }}
      onNavigateToMcp={() => setView('mcp')}
      onNavigateToEvals={() => setView('evals')}
    />
  );
};

export default App;
