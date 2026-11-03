/**
 * EvalsPage
 *
 * Evaluations & feedback:
 *  - User feedback (per agent): CORTEX_AGENT_FEEDBACK events sent from the chat thumbs.
 *  - Evaluation runs (per agent): start/track EXECUTE_AI_EVALUATION runs and read their scores.
 *  - Analyst (per semantic view): evaluate Cortex Analyst against the view's verified queries.
 *
 * See cortex_agent_evals_and_feedback.md for the Snowflake setup (dataset, config
 * YAML on a stage, privileges).
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Container,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography
} from '@mui/material';
import { ArrowBack as ArrowBackIcon } from '@mui/icons-material';
import { ChatHeader } from './chat/ChatHeader';
import { EVALS_TEXT } from '../constants/textConstants';
import { useAgentConfig } from '../hooks/useAgentConfig';
import { FeedbackPanel } from './evals/FeedbackPanel';
import { EvalRunsPanel } from './evals/EvalRunsPanel';
import { AnalystEvalsPanel } from './evals/AnalystEvalsPanel';
import { ErrorAlert } from './evals/shared';
import { getScope } from '../services/requestScope';
import { SCOPE_TEXT } from '../constants/textConstants';

interface EvalsPageProps {
  onBack: () => void;
}

type EvalsTab = 'feedback' | 'evals' | 'analyst';

const EvalsPage: React.FC<EvalsPageProps> = ({ onBack }) => {
  const { loading, error, getVisibleAgents } = useAgentConfig();
  const [agentName, setAgentName] = useState('');
  const [tab, setTab] = useState<EvalsTab>('feedback');

  const agents = useMemo(
    () => Object.entries(getVisibleAgents())
      .sort(([, a], [, b]) => a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase())),
    [getVisibleAgents]
  );

  useEffect(() => {
    if (!agentName && agents.length > 0) setAgentName(agents[0][0]);
  }, [agents, agentName]);

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <ChatHeader />
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Stack spacing={2.5}>
          <Box>
            <Button startIcon={<ArrowBackIcon />} onClick={onBack} color="inherit">
              {EVALS_TEXT.BACK_TO_CHAT}
            </Button>
          </Box>

          <Box sx={{ display: 'flex', alignItems: { md: 'flex-end' }, justifyContent: 'space-between', gap: 2, flexDirection: { xs: 'column', md: 'row' } }}>
            <Box>
              <Typography variant="h4" sx={{ fontWeight: 600, mb: 0.5 }}>
                {EVALS_TEXT.PAGE_TITLE}
              </Typography>
              <Typography variant="body1" color="text.secondary">
                {EVALS_TEXT.PAGE_SUBTITLE}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                {getScope()
                  ? `${SCOPE_TEXT.DATABASE} / ${SCOPE_TEXT.SCHEMA}: ${SCOPE_TEXT.CURRENT(getScope()!.database, getScope()!.schema)} (change it on the chat screen)`
                  : `${SCOPE_TEXT.DATABASE} / ${SCOPE_TEXT.SCHEMA}: ${SCOPE_TEXT.DEFAULT_NOTE.toLowerCase()} (choose one on the chat screen)`}
              </Typography>
            </Box>
            {/* Analyst evals target a semantic view and have their own picker */}
            {tab !== 'analyst' && (
              <TextField
                select
                size="small"
                label={EVALS_TEXT.AGENT_LABEL}
                value={agentName}
                onChange={e => setAgentName(e.target.value)}
                disabled={loading || agents.length === 0}
                sx={{ minWidth: 240 }}
              >
                {agents.map(([key, agent]) => (
                  <MenuItem key={key} value={key}>{agent.displayName}</MenuItem>
                ))}
              </TextField>
            )}
          </Box>

          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <Tab value="feedback" label={EVALS_TEXT.TAB_FEEDBACK} />
            <Tab value="evals" label={EVALS_TEXT.TAB_EVALS} />
            <Tab value="analyst" label={EVALS_TEXT.TAB_ANALYST} />
          </Tabs>

          {tab !== 'analyst' && loading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
          )}
          {tab !== 'analyst' && <ErrorAlert message={error} />}

          {tab === 'analyst' && <AnalystEvalsPanel />}
          {tab === 'feedback' && agentName && <FeedbackPanel agentName={agentName} />}
          {tab === 'evals' && agentName && <EvalRunsPanel kind="agent" target={agentName} />}
        </Stack>
      </Container>
    </Box>
  );
};

export default EvalsPage;
