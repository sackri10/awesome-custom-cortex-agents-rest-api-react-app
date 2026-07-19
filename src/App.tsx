/**
 * App Component
 *
 * Top-level view switcher. The app is small enough that a full router isn't
 * warranted, so we toggle between the chat interface and the create-agent page
 * with simple local state. Switching views unmounts the other page, which means
 * returning to chat re-fetches the agent list (so a newly created agent shows up).
 */

import React, { useState } from 'react';
import SimpleChatInterface from './components/Main';
import CreateAgentPage from './components/CreateAgentPage';

type View = 'chat' | 'create' | 'edit';

const App: React.FC = () => {
  const [view, setView] = useState<View>('chat');
  const [editAgentName, setEditAgentName] = useState<string | undefined>(undefined);

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
    />
  );
};

export default App;
