/**
 * RunAsBar
 * Pick a role (or a user who holds one) and chat with the agent as that role, so you see only
 * the answer that role would get. Also previews which of the agent's tools the role can
 * reach, which is what Snowflake keeps or drops at run time (tool_not_accessible: accept).
 *
 * Renders nothing unless the backend has RUN_AS_ROLES set.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Chip,
  CircularProgress,
  IconButton,
  ListSubheader,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import {
  CheckCircleOutline as OkIcon,
  HelpOutline as UnknownIcon,
  LockOutlined as LockIcon,
  Refresh as RefreshIcon
} from '@mui/icons-material';
import { RUN_AS_TEXT } from '../../constants/textConstants';
import {
  RunAsConfig,
  RunAsSelection,
  ToolAccess,
  fetchAgentAccess,
  fetchRunAsConfig,
  getCachedRunAsConfig
} from '../../services/runAsApi';

interface RunAsBarProps {
  selection: RunAsSelection;
  onChange: (selection: RunAsSelection) => void;
  agentName: string;
  /** Changes with the chosen database.schema, so tool access is checked again */
  scopeKey?: string;
  /** Block changes while an answer is streaming */
  disabled?: boolean;
}

// Select values: '' (default) | role:<ROLE> | user:<USER>|<ROLE>
const keyOf = (s: RunAsSelection): string => {
  if (!s.role) return '';
  return s.user ? `user:${s.user}|${s.role}` : `role:${s.role}`;
};

const parseKey = (key: string): RunAsSelection => {
  if (key.startsWith('role:')) return { role: key.slice(5) };
  if (key.startsWith('user:')) {
    const [user, role] = key.slice(5).split('|');
    return { role, user };
  }
  return { role: '' };
};

export const RunAsBar: React.FC<RunAsBarProps> = ({ selection, onChange, agentName, scopeKey, disabled }) => {
  const [cfg, setCfg] = useState<RunAsConfig | null>(getCachedRunAsConfig());
  const [checking, setChecking] = useState(false);
  const [tools, setTools] = useState<ToolAccess[] | null>(null);
  const [toolsError, setToolsError] = useState<string | null>(null);

  const load = useCallback(async (refresh: boolean) => {
    setChecking(true);
    try {
      setCfg(await fetchRunAsConfig(refresh));
    } catch {
      setCfg(null); // other screens already report a backend problem
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => { load(false); }, [load]);

  // Which tools can the selected role reach?
  useEffect(() => {
    setTools(null);
    setToolsError(null);
    if (!selection.role || !agentName) return;
    let cancelled = false;
    fetchAgentAccess(agentName, selection.role)
      .then(list => { if (!cancelled) setTools(list); })
      .catch((err: any) => { if (!cancelled) setToolsError(err?.fullMessage || err?.message || 'Request failed'); });
    return () => { cancelled = true; };
    // scopeKey is not read inside, but a new database.schema means a new agent to check
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.role, agentName, scopeKey]);

  if (!cfg || !cfg.enabled) return null;

  const selected = cfg.roles.find(r => r.role === selection.role);
  const blocked = !!selection.role && selected && !selected.usable;

  const items: React.ReactNode[] = [
    <MenuItem key="default" value="">{RUN_AS_TEXT.DEFAULT}</MenuItem>,
    <ListSubheader key="roles-h">{RUN_AS_TEXT.ROLES_GROUP}</ListSubheader>,
    ...cfg.roles.map(r => (
      <MenuItem key={`role:${r.role}`} value={`role:${r.role}`} disabled={!r.usable}>
        <Box>
          <Typography variant="body2">{r.role}</Typography>
          <Typography variant="caption" color="text.secondary">
            {r.usable ? (r.mode === 'token' ? RUN_AS_TEXT.MODE_TOKEN : RUN_AS_TEXT.MODE_HEADER) : RUN_AS_TEXT.UNAVAILABLE}
          </Typography>
        </Box>
      </MenuItem>
    ))
  ];
  const userItems = cfg.roles.flatMap(r => r.users.map(u => (
    <MenuItem key={`user:${u}|${r.role}`} value={`user:${u}|${r.role}`} disabled={!r.usable}>
      <Box>
        <Typography variant="body2">{u}</Typography>
        <Typography variant="caption" color="text.secondary">{RUN_AS_TEXT.VIA(r.role)}</Typography>
      </Box>
    </MenuItem>
  )));
  if (userItems.length > 0) {
    items.push(<ListSubheader key="users-h">{RUN_AS_TEXT.USERS_GROUP}</ListSubheader>, ...userItems);
  }

  return (
    <Paper variant="outlined" sx={{ p: 1.5, mb: 2, borderRadius: 2 }}>
      <Stack spacing={1.25}>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          <TextField
            select
            size="small"
            label={RUN_AS_TEXT.LABEL}
            value={keyOf(selection)}
            onChange={e => onChange(parseKey(String(e.target.value)))}
            disabled={disabled}
            sx={{ minWidth: 260 }}
            SelectProps={{
              renderValue: value => {
                const sel = parseKey(String(value));
                if (!sel.role) return RUN_AS_TEXT.DEFAULT;
                return sel.user ? `${sel.user} (${sel.role})` : sel.role;
              }
            }}
          >
            {items}
          </TextField>
          <Tooltip title={RUN_AS_TEXT.CHECK_AGAIN} arrow>
            <span>
              <IconButton size="small" onClick={() => load(true)} disabled={checking} aria-label={RUN_AS_TEXT.CHECK_AGAIN}>
                {checking ? <CircularProgress size={16} /> : <RefreshIcon fontSize="small" />}
              </IconButton>
            </span>
          </Tooltip>
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 220 }}>
            {RUN_AS_TEXT.CAPTION}
          </Typography>
        </Stack>

        {blocked && selected && (
          <Alert severity="warning">
            <AlertTitle>{RUN_AS_TEXT.UNAVAILABLE_ALERT_TITLE}</AlertTitle>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{selected.hint || selected.reason}</Typography>
          </Alert>
        )}

        {selection.role && !blocked && (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            <Typography variant="caption" color="text.secondary">{RUN_AS_TEXT.TOOLS_LABEL}:</Typography>
            {tools === null && !toolsError && (
              <Chip size="small" variant="outlined" label={RUN_AS_TEXT.TOOLS_LOADING} icon={<CircularProgress size={12} />} />
            )}
            {tools?.map(t => (
              <Tooltip
                key={t.tool}
                arrow
                title={
                  t.accessible === true ? RUN_AS_TEXT.TOOL_OK
                    : t.accessible === false ? `${RUN_AS_TEXT.TOOL_BLOCKED}${t.resource ? ` (${t.resource})` : ''}`
                      : (t.reason || RUN_AS_TEXT.TOOL_UNKNOWN)
                }
              >
                <Chip
                  size="small"
                  variant="outlined"
                  label={t.tool}
                  color={t.accessible === true ? 'success' : 'default'}
                  icon={t.accessible === true ? <OkIcon /> : t.accessible === false ? <LockIcon /> : <UnknownIcon />}
                  sx={t.accessible === false ? { opacity: 0.6, textDecoration: 'line-through' } : undefined}
                />
              </Tooltip>
            ))}
          </Stack>
        )}

        {toolsError && !blocked && (
          <Alert severity="info">
            <AlertTitle>{RUN_AS_TEXT.ACCESS_ERROR_TITLE}</AlertTitle>
            <Typography variant="body2" component="pre" sx={{ whiteSpace: 'pre-wrap', m: 0, fontFamily: 'inherit' }}>{toolsError}</Typography>
          </Alert>
        )}
      </Stack>
    </Paper>
  );
};
