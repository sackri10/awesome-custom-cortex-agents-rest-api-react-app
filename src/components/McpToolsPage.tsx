/**
 * McpToolsPage
 *
 * Demo UI for the Snowflake-managed MCP server: list tools from tools/list,
 * build arguments from each tool's inputSchema, and invoke tools/call.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Divider,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
  alpha,
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  PlayArrow as PlayIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { ChatHeader } from './chat/ChatHeader';
import { MCP_TOOLS_TEXT } from '../constants/textConstants';
import {
  callMcpTool,
  fetchMcpContext,
  listMcpTools,
  McpContext,
  McpJsonSchemaProperty,
  McpTool,
} from '../services/snowflakeMcpApi';

interface McpToolsPageProps {
  onBack: () => void;
}

type ArgValues = Record<string, string>;

const primaryType = (prop?: McpJsonSchemaProperty): string => {
  if (!prop?.type) return 'string';
  return Array.isArray(prop.type) ? (prop.type.find((t) => t !== 'null') || 'string') : prop.type;
};

const isComplexType = (type: string): boolean =>
  type === 'object' || type === 'array';

const defaultArgValues = (tool: McpTool | null): ArgValues => {
  const values: ArgValues = {};
  const props = tool?.inputSchema?.properties || {};
  Object.entries(props).forEach(([key, schema]) => {
    if (schema.default !== undefined) {
      values[key] =
        typeof schema.default === 'string'
          ? schema.default
          : JSON.stringify(schema.default, null, 2);
      return;
    }
    const type = primaryType(schema);
    if (type === 'boolean') values[key] = 'false';
    else if (isComplexType(type)) values[key] = type === 'array' ? '[]' : '{}';
    else values[key] = '';
  });
  return values;
};

const buildArguments = (
  tool: McpTool,
  values: ArgValues
): { args: Record<string, unknown>; error?: string } => {
  const props = tool.inputSchema?.properties || {};
  const required = new Set(tool.inputSchema?.required || []);
  const args: Record<string, unknown> = {};

  for (const [key, schema] of Object.entries(props)) {
    const raw = (values[key] ?? '').trim();
    const type = primaryType(schema);
    const isRequired = required.has(key);

    if (!raw) {
      if (isRequired) {
        return { args: {}, error: `Missing required argument: ${key}` };
      }
      continue;
    }

    try {
      if (type === 'integer' || type === 'number') {
        const n = Number(raw);
        if (Number.isNaN(n)) return { args: {}, error: `"${key}" must be a number` };
        args[key] = type === 'integer' ? Math.trunc(n) : n;
      } else if (type === 'boolean') {
        args[key] = raw === 'true' || raw === '1';
      } else if (isComplexType(type)) {
        args[key] = JSON.parse(raw);
      } else {
        args[key] = raw;
      }
    } catch {
      return { args: {}, error: `"${key}" must be valid JSON for type ${type}` };
    }
  }

  return { args };
};

const formatResult = (result: unknown): string => {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  const content = (result as { content?: Array<{ type?: string; text?: string }> }).content;
  if (Array.isArray(content) && content.length > 0) {
    const textParts = content
      .map((c) => (typeof c?.text === 'string' ? c.text : JSON.stringify(c, null, 2)))
      .filter(Boolean);
    if (textParts.length > 0) return textParts.join('\n\n');
  }
  return JSON.stringify(result, null, 2);
};

const McpToolsPage: React.FC<McpToolsPageProps> = ({ onBack }) => {
  const [context, setContext] = useState<McpContext | null>(null);
  const [tools, setTools] = useState<McpTool[]>([]);
  const [selectedName, setSelectedName] = useState('');
  const [argValues, setArgValues] = useState<ArgValues>({});
  const [loadingTools, setLoadingTools] = useState(true);
  const [calling, setCalling] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const [resultText, setResultText] = useState<string | null>(null);

  const selectedTool = useMemo(
    () => tools.find((t) => t.name === selectedName) || null,
    [tools, selectedName]
  );

  const propertyEntries = useMemo(
    () => Object.entries(selectedTool?.inputSchema?.properties || {}),
    [selectedTool]
  );

  const requiredSet = useMemo(
    () => new Set(selectedTool?.inputSchema?.required || []),
    [selectedTool]
  );

  const loadTools = useCallback(async () => {
    setLoadingTools(true);
    setLoadError(null);
    setCallError(null);
    setResultText(null);
    try {
      const ctx = await fetchMcpContext();
      setContext(ctx);
      if (!ctx.configured) {
        setTools([]);
        setSelectedName('');
        setLoadError(MCP_TOOLS_TEXT.NOT_CONFIGURED);
        return;
      }
      const listed = await listMcpTools();
      setTools(listed);
      const nextName = listed[0]?.name || '';
      setSelectedName(nextName);
      setArgValues(defaultArgValues(listed[0] || null));
      if (listed.length === 0) {
        setLoadError(MCP_TOOLS_TEXT.NO_TOOLS);
      }
    } catch (err: any) {
      setTools([]);
      setSelectedName('');
      setLoadError(err?.fullMessage || err?.message || MCP_TOOLS_TEXT.LOAD_ERROR);
    } finally {
      setLoadingTools(false);
    }
  }, []);

  useEffect(() => {
    loadTools();
  }, [loadTools]);

  useEffect(() => {
    setArgValues(defaultArgValues(selectedTool));
    setCallError(null);
    setResultText(null);
  }, [selectedTool]);

  const handleCall = async () => {
    if (!selectedTool) return;
    setCalling(true);
    setCallError(null);
    setResultText(null);
    const { args, error } = buildArguments(selectedTool, argValues);
    if (error) {
      setCallError(error);
      setCalling(false);
      return;
    }
    try {
      const result = await callMcpTool(selectedTool.name, args);
      setResultText(formatResult(result));
    } catch (err: any) {
      setCallError(err?.fullMessage || err?.message || MCP_TOOLS_TEXT.CALL_ERROR);
    } finally {
      setCalling(false);
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <ChatHeader />
      <Container maxWidth="md" sx={{ py: 3 }}>
        <Stack spacing={2.5}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
            <Button startIcon={<ArrowBackIcon />} onClick={onBack} color="inherit">
              {MCP_TOOLS_TEXT.BACK_TO_CHAT}
            </Button>
            <Button
              startIcon={loadingTools ? <CircularProgress size={16} /> : <RefreshIcon />}
              onClick={loadTools}
              disabled={loadingTools}
              variant="outlined"
              size="small"
            >
              {MCP_TOOLS_TEXT.REFRESH}
            </Button>
          </Box>

          <Box>
            <Typography variant="h4" sx={{ fontWeight: 600, mb: 0.5 }}>
              {MCP_TOOLS_TEXT.PAGE_TITLE}
            </Typography>
            <Typography variant="body1" color="text.secondary">
              {MCP_TOOLS_TEXT.PAGE_SUBTITLE}
            </Typography>
            {context?.configured && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                {context.database}.{context.schema}.{context.mcpServer}
              </Typography>
            )}
          </Box>

          {loadError && (
            <Alert severity={context && !context.configured ? 'warning' : 'error'}>
              <AlertTitle>
                {context && !context.configured
                  ? MCP_TOOLS_TEXT.NOT_CONFIGURED_TITLE
                  : MCP_TOOLS_TEXT.LOAD_ERROR_TITLE}
              </AlertTitle>
              <Typography component="pre" sx={{ whiteSpace: 'pre-wrap', m: 0, fontFamily: 'inherit' }}>
                {loadError}
              </Typography>
            </Alert>
          )}

          {loadingTools && !tools.length ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress />
            </Box>
          ) : tools.length > 0 ? (
            <Paper
              elevation={0}
              sx={{
                p: 3,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
              }}
            >
              <Stack spacing={2.5}>
                <TextField
                  select
                  fullWidth
                  label={MCP_TOOLS_TEXT.TOOL_LABEL}
                  value={selectedName}
                  onChange={(e) => setSelectedName(e.target.value)}
                >
                  {tools.map((tool) => (
                    <MenuItem key={tool.name} value={tool.name}>
                      {tool.title || tool.name}
                    </MenuItem>
                  ))}
                </TextField>

                {selectedTool && (
                  <>
                    <Box>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                        <Chip size="small" label={selectedTool.name} />
                        {selectedTool.title && selectedTool.title !== selectedTool.name && (
                          <Typography variant="body2" color="text.secondary">
                            {selectedTool.title}
                          </Typography>
                        )}
                      </Stack>
                      {selectedTool.description && (
                        <Typography variant="body2" color="text.secondary">
                          {selectedTool.description}
                        </Typography>
                      )}
                    </Box>

                    <Divider />

                    <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                      {MCP_TOOLS_TEXT.ARGS_TITLE}
                    </Typography>

                    {propertyEntries.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        {MCP_TOOLS_TEXT.NO_ARGS}
                      </Typography>
                    ) : (
                      propertyEntries.map(([key, schema]) => {
                        const type = primaryType(schema);
                        const label = `${key}${requiredSet.has(key) ? ' *' : ''}`;
                        const helper = [schema.description, `type: ${type}`]
                          .filter(Boolean)
                          .join(' · ');

                        if (type === 'boolean') {
                          return (
                            <FormControlLabel
                              key={key}
                              control={
                                <Switch
                                  checked={argValues[key] === 'true'}
                                  onChange={(e) =>
                                    setArgValues((prev) => ({
                                      ...prev,
                                      [key]: e.target.checked ? 'true' : 'false',
                                    }))
                                  }
                                />
                              }
                              label={
                                <Box>
                                  <Typography variant="body2">{label}</Typography>
                                  {helper && (
                                    <Typography variant="caption" color="text.secondary">
                                      {helper}
                                    </Typography>
                                  )}
                                </Box>
                              }
                            />
                          );
                        }

                        return (
                          <TextField
                            key={key}
                            fullWidth
                            label={label}
                            helperText={helper}
                            value={argValues[key] ?? ''}
                            onChange={(e) =>
                              setArgValues((prev) => ({ ...prev, [key]: e.target.value }))
                            }
                            multiline={isComplexType(type)}
                            minRows={isComplexType(type) ? 3 : 1}
                            placeholder={
                              isComplexType(type)
                                ? type === 'array'
                                  ? '["value"]'
                                  : '{ "key": "value" }'
                                : undefined
                            }
                          />
                        );
                      })
                    )}

                    <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <Button
                        variant="contained"
                        startIcon={calling ? <CircularProgress size={16} color="inherit" /> : <PlayIcon />}
                        onClick={handleCall}
                        disabled={calling || !selectedName}
                      >
                        {calling ? MCP_TOOLS_TEXT.CALLING : MCP_TOOLS_TEXT.CALL}
                      </Button>
                    </Box>
                  </>
                )}
              </Stack>
            </Paper>
          ) : null}

          {callError && (
            <Alert severity="error">
              <AlertTitle>{MCP_TOOLS_TEXT.CALL_ERROR_TITLE}</AlertTitle>
              <Typography component="pre" sx={{ whiteSpace: 'pre-wrap', m: 0, fontFamily: 'inherit' }}>
                {callError}
              </Typography>
            </Alert>
          )}

          {resultText !== null && (
            <Paper
              elevation={0}
              sx={{
                p: 2.5,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
                bgcolor: (theme) =>
                  theme.palette.mode === 'dark'
                    ? alpha(theme.palette.common.white, 0.03)
                    : alpha(theme.palette.grey[900], 0.02),
              }}
            >
              <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                {MCP_TOOLS_TEXT.RESULT_TITLE}
              </Typography>
              <Typography
                component="pre"
                sx={{
                  m: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  fontSize: '0.85rem',
                  maxHeight: 480,
                  overflow: 'auto',
                }}
              >
                {resultText || MCP_TOOLS_TEXT.EMPTY_RESULT}
              </Typography>
            </Paper>
          )}
        </Stack>
      </Container>
    </Box>
  );
};

export default McpToolsPage;
