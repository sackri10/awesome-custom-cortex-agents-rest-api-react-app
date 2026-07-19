/**
 * CreateAgentPage Component
 *
 * A guided form for creating a new Snowflake Cortex Agent from the UI.
 * Only the agent name is required. Tools are attached by selecting existing
 * semantic views (Cortex Analyst) and Cortex Search services — or by creating
 * new ones inline via the builder dialogs. An advanced section still allows raw
 * tools / tool_resources JSON overrides.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Container,
  Stack,
  Paper,
  Typography,
  TextField,
  Button,
  IconButton,
  MenuItem,
  Autocomplete,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  FormControlLabel,
  Checkbox,
  Alert,
  AlertTitle,
  Divider,
  CircularProgress,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  Snackbar,
  alpha,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  Add as AddIcon,
  DeleteOutline as DeleteIcon,
  ArrowBack as ArrowBackIcon,
  Refresh as RefreshIcon,
  Close as CloseIcon,
  Download as DownloadIcon,
  ContentCopy as ContentCopyIcon,
} from '@mui/icons-material';
import yaml from 'js-yaml';
import { ChatHeader } from './chat/ChatHeader';
import { CREATE_AGENT_TEXT } from '../constants/textConstants';
import {
  createCortexAgent,
  updateCortexAgent,
  describeCortexAgent,
  parseAgentSpec,
  CreateAgentRequest,
} from '../services/snowflakeAgentsApi';
import {
  fetchSnowflakeContext,
  listSemanticViews,
  listCortexSearchServices,
  listDatabases,
  listSchemas,
  SnowflakeContext,
  SchemaObject,
} from '../services/snowflakeObjectsApi';
import CreateSearchServiceForm from './objects/CreateSearchServiceForm';
import CreateSemanticViewForm from './objects/CreateSemanticViewForm';

interface CreateAgentPageProps {
  onBack: () => void;
  onCreated: () => void;
  /** When set, the page edits this existing agent instead of creating a new one. */
  editAgentName?: string;
}

// Common Cortex orchestration models. Availability varies by region/account,
// so this is a convenience list rather than an exhaustive one.
const ORCHESTRATION_MODELS = [
  'auto',
  'claude-4-sonnet',
  'claude-3-7-sonnet',
  'claude-3-5-sonnet',
  'llama3.3-70b',
  'llama3.1-70b',
  'mistral-large2',
  'openai-gpt-4.1',
];

// Snowflake unquoted identifier: starts with a letter/underscore, then letters/digits/underscores.
const AGENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Build a unique, valid (1–64 char) tool name from a base object name.
const buildToolName = (base: string, used: Set<string>): string => {
  const cleaned = base.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 64) || 'tool';
  let candidate = cleaned;
  let i = 2;
  while (used.has(candidate)) {
    candidate = `${cleaned.slice(0, 60)}_${i}`;
    i++;
  }
  used.add(candidate);
  return candidate;
};

const CreateAgentPage: React.FC<CreateAgentPageProps> = ({ onBack, onCreated, editAgentName }) => {
  const isEdit = !!editAgentName;

  // Basics
  const [name, setName] = useState(editAgentName || '');
  const [displayName, setDisplayName] = useState('');
  const [comment, setComment] = useState('');
  const [model, setModel] = useState('auto');

  // Instructions
  const [responseInstruction, setResponseInstruction] = useState('');
  const [orchestrationInstruction, setOrchestrationInstruction] = useState('');
  const [systemInstruction, setSystemInstruction] = useState('');

  // Sample questions
  const [sampleQuestions, setSampleQuestions] = useState<string[]>(['']);

  // Tools — existing objects
  const [context, setContext] = useState<SnowflakeContext | null>(null);
  const [semanticViews, setSemanticViews] = useState<SchemaObject[]>([]);
  const [searchServices, setSearchServices] = useState<SchemaObject[]>([]);
  const [selectedSemanticFqns, setSelectedSemanticFqns] = useState<string[]>([]);
  const [selectedSearchFqns, setSelectedSearchFqns] = useState<string[]>([]);
  // Original tool_spec + resource for pre-existing tools (keyed by their selected
  // value), so edits preserve fields we don't model (execution_environment,
  // max_results, semantic_model_file, id/title columns, etc.).
  const [semanticMeta, setSemanticMeta] = useState<Record<string, { toolSpec: any; resource: any }>>({});
  const [searchMeta, setSearchMeta] = useState<Record<string, { toolSpec: any; resource: any }>>({});
  const [loadingTools, setLoadingTools] = useState(false);
  const [toolsLoadError, setToolsLoadError] = useState<string | null>(null);

  // Object-browsing scope (drives which semantic views / search services are listed)
  const [toolDatabase, setToolDatabase] = useState('');
  const [toolSchema, setToolSchema] = useState('');
  const [databases, setDatabases] = useState<string[]>([]);
  const [schemas, setSchemas] = useState<string[]>([]);

  // Builder dialogs
  const [semanticDialogOpen, setSemanticDialogOpen] = useState(false);
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);

  // Advanced JSON overrides
  const [toolsJson, setToolsJson] = useState('');
  const [toolResourcesJson, setToolResourcesJson] = useState('');
  const [overwrite, setOverwrite] = useState(false);

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [touchedName, setTouchedName] = useState(false);
  const [loadingAgent, setLoadingAgent] = useState(isEdit);
  const [notice, setNotice] = useState<string | null>(null);

  // Edit mode: load the existing agent's spec and pre-fill the form.
  useEffect(() => {
    if (!editAgentName) return;
    let cancelled = false;
    setLoadingAgent(true);
    describeCortexAgent(editAgentName)
      .then((details) => {
        if (cancelled) return;
        const spec = parseAgentSpec(details.agent_spec || '{}');
        setDisplayName(spec.profile?.display_name || '');
        setComment((details as any).comment || (spec as any).comment || '');
        setModel(spec.models?.orchestration || 'auto');
        setResponseInstruction(spec.instructions?.response || '');
        setOrchestrationInstruction(spec.instructions?.orchestration || '');
        setSystemInstruction((spec.instructions as any)?.system || '');

        const sq = spec.instructions?.sample_questions;
        if (Array.isArray(sq) && sq.length > 0) {
          setSampleQuestions(sq.map((q: any) => (typeof q === 'object' ? q.question : q)).filter(Boolean));
        }

        // Split tools into Cortex Analyst / Cortex Search selections, keeping each
        // tool's original spec + resource so unmodeled fields survive a save.
        // Any other tool types are preserved verbatim via the Advanced JSON.
        const semantic: string[] = [];
        const search: string[] = [];
        const semMeta: Record<string, { toolSpec: any; resource: any }> = {};
        const srchMeta: Record<string, { toolSpec: any; resource: any }> = {};
        const leftoverTools: any[] = [];
        const leftoverResources: Record<string, any> = {};
        const specTools = Array.isArray(spec.tools) ? spec.tools : [];
        const resources: Record<string, any> = (spec as any).tool_resources || {};
        specTools.forEach((tool: any) => {
          const tspec = tool?.tool_spec || {};
          const resource = (tspec.name && resources[tspec.name]) || {};
          // Cortex Analyst: semantic view OR semantic model file (stage YAML)
          if (tspec.type === 'cortex_analyst_text_to_sql') {
            const val = resource.semantic_view || resource.semantic_model_file;
            if (val) { semantic.push(val); semMeta[val] = { toolSpec: tspec, resource }; return; }
          }
          // Cortex Search: `name` (stored form) or `search_service` (docs form)
          if (tspec.type === 'cortex_search') {
            const val = resource.name || resource.search_service;
            if (val) { search.push(val); srchMeta[val] = { toolSpec: tspec, resource }; return; }
          }
          leftoverTools.push(tool);
          if (tspec.name && resources[tspec.name]) leftoverResources[tspec.name] = resources[tspec.name];
        });
        setSelectedSemanticFqns(semantic);
        setSelectedSearchFqns(search);
        setSemanticMeta(semMeta);
        setSearchMeta(srchMeta);
        if (leftoverTools.length > 0) setToolsJson(JSON.stringify(leftoverTools, null, 2));
        if (Object.keys(leftoverResources).length > 0) setToolResourcesJson(JSON.stringify(leftoverResources, null, 2));
      })
      .catch((err) => {
        if (!cancelled) setError((err as any).fullMessage || (err instanceof Error ? err.message : 'Failed to load agent'));
      })
      .finally(() => { if (!cancelled) setLoadingAgent(false); });
    return () => { cancelled = true; };
  }, [editAgentName]);

  // Load semantic views + search services for a given database/schema.
  const loadTools = useCallback(async (database: string, schema: string) => {
    if (!database || !schema) return;
    setLoadingTools(true);
    setToolsLoadError(null);
    try {
      const [views, services] = await Promise.all([
        listSemanticViews(database, schema),
        listCortexSearchServices(database, schema),
      ]);
      setSemanticViews(views);
      setSearchServices(services);
    } catch (err) {
      setToolsLoadError((err as any).fullMessage || (err instanceof Error ? err.message : 'Failed to load tools'));
    } finally {
      setLoadingTools(false);
    }
  }, []);

  // On mount: read context (defaults) and load the database list.
  useEffect(() => {
    fetchSnowflakeContext()
      .then((ctx) => {
        setContext(ctx);
        setToolDatabase((ctx.database || '').toUpperCase());
        setToolSchema((ctx.schema || '').toUpperCase());
      })
      .catch(() => setContext(null));
    listDatabases().then(setDatabases).catch(() => setDatabases([]));
  }, []);

  // When the selected database changes, load its schemas (keeping the current
  // schema if still valid, otherwise defaulting to the first available).
  useEffect(() => {
    if (!toolDatabase) return;
    let cancelled = false;
    listSchemas(toolDatabase)
      .then((s) => {
        if (cancelled) return;
        setSchemas(s);
        setToolSchema((cur) => (cur && s.includes(cur) ? cur : (s[0] || '')));
      })
      .catch(() => { if (!cancelled) setSchemas([]); });
    return () => { cancelled = true; };
  }, [toolDatabase]);

  // Reload the object lists whenever the database/schema scope changes.
  useEffect(() => {
    if (toolDatabase && toolSchema) loadTools(toolDatabase, toolSchema);
  }, [toolDatabase, toolSchema, loadTools]);

  const nameError = useMemo(() => {
    if (!touchedName) return '';
    if (!name.trim()) return CREATE_AGENT_TEXT.INVALID_NAME;
    if (!AGENT_NAME_PATTERN.test(name.trim())) return CREATE_AGENT_TEXT.INVALID_NAME;
    return '';
  }, [name, touchedName]);

  const handleQuestionChange = useCallback((index: number, value: string) => {
    setSampleQuestions(prev => prev.map((q, i) => (i === index ? value : q)));
  }, []);
  const handleAddQuestion = useCallback(() => setSampleQuestions(prev => [...prev, '']), []);
  const handleRemoveQuestion = useCallback((index: number) => {
    setSampleQuestions(prev => prev.filter((_, i) => i !== index));
  }, []);

  // After creating a new object inline, switch scope to where it was created,
  // refresh the lists, and auto-select it.
  const handleSemanticCreated = useCallback(async (fqn: string) => {
    setSemanticDialogOpen(false);
    const parts = fqn.split('.');
    const db = parts.length === 3 ? parts[0] : toolDatabase;
    const sc = parts.length === 3 ? parts[1] : toolSchema;
    setToolDatabase(db);
    setToolSchema(sc);
    await loadTools(db, sc);
    setSelectedSemanticFqns(prev => Array.from(new Set([...prev, fqn])));
  }, [loadTools, toolDatabase, toolSchema]);

  const handleSearchCreated = useCallback(async (fqn: string) => {
    setSearchDialogOpen(false);
    const parts = fqn.split('.');
    const db = parts.length === 3 ? parts[0] : toolDatabase;
    const sc = parts.length === 3 ? parts[1] : toolSchema;
    setToolDatabase(db);
    setToolSchema(sc);
    await loadTools(db, sc);
    setSelectedSearchFqns(prev => Array.from(new Set([...prev, fqn])));
  }, [loadTools, toolDatabase, toolSchema]);

  const buildPayload = useCallback((): CreateAgentRequest | null => {
    const trimmedName = name.trim();

    // Instructions object (only include non-empty fields)
    const instructions: NonNullable<CreateAgentRequest['instructions']> = {};
    if (responseInstruction.trim()) instructions.response = responseInstruction.trim();
    if (orchestrationInstruction.trim()) instructions.orchestration = orchestrationInstruction.trim();
    if (systemInstruction.trim()) instructions.system = systemInstruction.trim();

    const cleanedQuestions = sampleQuestions.map(q => q.trim()).filter(Boolean);
    if (cleanedQuestions.length > 0) {
      instructions.sample_questions = cleanedQuestions.map(question => ({ question }));
    }

    // Generate tools + tool_resources from selected objects
    const tools: any[] = [];
    const toolResources: Record<string, any> = {};
    const used = new Set<string>();

    selectedSemanticFqns.forEach((val) => {
      const meta = semanticMeta[val];
      const base = (val.split('/').pop() || val.split('.').pop() || val).replace(/\.yaml$/i, '');
      const toolName = buildToolName(meta?.toolSpec?.name || base, used);
      tools.push({
        tool_spec: meta?.toolSpec
          ? { ...meta.toolSpec, name: toolName }
          : {
              type: 'cortex_analyst_text_to_sql',
              name: toolName,
              description: `Answers questions about structured data using the ${base} semantic view.`,
            },
      });
      // Preserve the original resource (semantic_model_file, execution_environment, …)
      // for existing tools; generate a minimal one for newly-added semantic views.
      toolResources[toolName] = meta?.resource ?? { semantic_view: val };
    });

    selectedSearchFqns.forEach((val) => {
      const meta = searchMeta[val];
      const base = val.split('.').pop() || val;
      const toolName = buildToolName(meta?.toolSpec?.name || base, used);
      tools.push({
        tool_spec: meta?.toolSpec
          ? { ...meta.toolSpec, name: toolName }
          : {
              type: 'cortex_search',
              name: toolName,
              description: `Searches documents and unstructured data using the ${base} Cortex Search service.`,
            },
      });
      // Preserve original resource (name, max_results, id/title columns) for existing
      // tools; generate a minimal one for newly-added search services.
      toolResources[toolName] = meta?.resource ?? { search_service: val };
    });

    // Advanced overrides: concat extra tools, merge extra tool_resources
    if (toolsJson.trim()) {
      try {
        const parsed = JSON.parse(toolsJson);
        if (!Array.isArray(parsed)) throw new Error('not an array');
        tools.push(...parsed);
      } catch {
        setError(CREATE_AGENT_TEXT.INVALID_TOOLS_JSON);
        return null;
      }
    }
    if (toolResourcesJson.trim()) {
      try {
        const parsed = JSON.parse(toolResourcesJson);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
        Object.assign(toolResources, parsed);
      } catch {
        setError(CREATE_AGENT_TEXT.INVALID_TOOL_RESOURCES_JSON);
        return null;
      }
    }

    const payload: CreateAgentRequest = { name: trimmedName };
    if (comment.trim()) payload.comment = comment.trim();
    if (displayName.trim()) payload.profile = { display_name: displayName.trim() };
    if (model && model !== 'auto') payload.models = { orchestration: model };
    if (Object.keys(instructions).length > 0) payload.instructions = instructions;
    if (tools.length > 0) payload.tools = tools;
    if (Object.keys(toolResources).length > 0) payload.tool_resources = toolResources;
    payload._createMode = overwrite ? 'orReplace' : 'errorIfExists';

    return payload;
  }, [
    name, displayName, comment, model, responseInstruction, orchestrationInstruction,
    systemInstruction, sampleQuestions, selectedSemanticFqns, selectedSearchFqns,
    semanticMeta, searchMeta, toolsJson, toolResourcesJson, overwrite,
  ]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setTouchedName(true);

    const trimmedName = name.trim();
    if (!trimmedName || !AGENT_NAME_PATTERN.test(trimmedName)) {
      setError(CREATE_AGENT_TEXT.INVALID_NAME);
      return;
    }

    const payload = buildPayload();
    if (!payload) return;

    setSubmitting(true);
    try {
      if (isEdit) {
        await updateCortexAgent(editAgentName!, payload);
      } else {
        await createCortexAgent(payload);
      }
      setSuccess(true);
      setTimeout(() => onCreated(), 1500);
    } catch (err) {
      setError((err as any).fullMessage || (err instanceof Error ? err.message : `Failed to ${isEdit ? 'update' : 'create'} agent`));
    } finally {
      setSubmitting(false);
    }
  }, [name, buildPayload, onCreated, isEdit, editAgentName]);

  // Serialize the current form config to YAML (the spec Snowflake stores as JSON;
  // YAML is a portable, source-controllable equivalent for CI / multi-env deploys).
  const buildYaml = useCallback((): string | null => {
    const payload = buildPayload();
    if (!payload) return null;
    const { _createMode, ...config } = payload;
    return yaml.dump(config, { lineWidth: 120, noRefs: true, quotingType: '"', forceQuotes: false });
  }, [buildPayload]);

  const handleDownloadYaml = useCallback(() => {
    const y = buildYaml();
    if (y == null) return;
    const fileName = `${(name.trim() || 'agent').toLowerCase()}.yaml`;
    const blob = new Blob([y], { type: 'application/x-yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [buildYaml, name]);

  const handleCopyYaml = useCallback(async () => {
    const y = buildYaml();
    if (y == null) return;
    try {
      await navigator.clipboard.writeText(y);
      setNotice(CREATE_AGENT_TEXT.YAML_COPIED);
    } catch {
      setNotice(CREATE_AGENT_TEXT.YAML_COPY_FAILED);
    }
  }, [buildYaml]);

  const sectionPaperSx = {
    p: { xs: 2, sm: 3 },
    borderRadius: 2,
    border: '1px solid',
    borderColor: 'divider',
    bgcolor: 'background.paper',
  } as const;

  // Ensure the current selection is always present as an option (case/scope defaults
  // may not yet be in the fetched lists; a loaded agent may use an unlisted model).
  const dbOptions = Array.from(new Set([toolDatabase, ...databases].filter(Boolean)));
  const schemaOptions = Array.from(new Set([toolSchema, ...schemas].filter(Boolean)));
  const modelOptions = Array.from(new Set([model, ...ORCHESTRATION_MODELS].filter(Boolean)));

  // Analyst tools backed by a semantic model file (stage YAML) rather than a native
  // semantic view — these can be rebound to a view but not edited in-app.
  const modelFileEntries = selectedSemanticFqns.filter(
    (v) => !!semanticMeta[v]?.resource?.semantic_model_file || v.trim().startsWith('@')
  );

  // Rebind a model-file-backed Analyst tool to a native semantic view, preserving
  // the original tool name/description and execution_environment (warehouse/timeout).
  const rebindSemanticToView = (oldValue: string, newFqn: string) => {
    if (!newFqn || newFqn === oldValue) return;
    setSelectedSemanticFqns((prev) => Array.from(new Set(prev.map((x) => (x === oldValue ? newFqn : x)))));
    setSemanticMeta((prev) => {
      const next = { ...prev };
      const old = next[oldValue];
      delete next[oldValue];
      const resource = { ...(old?.resource || {}) };
      delete resource.semantic_model_file;
      resource.semantic_view = newFqn;
      next[newFqn] = { toolSpec: old?.toolSpec || { type: 'cortex_analyst_text_to_sql' }, resource };
      return next;
    });
  };

  const renderObjectOption = (props: React.HTMLAttributes<HTMLLIElement>, fqn: string, list: SchemaObject[]) => {
    const obj = list.find((o) => o.fqn === fqn);
    return (
      <li {...props} key={fqn}>
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>{fqn}</Typography>
          {obj?.comment && (
            <Typography variant="caption" color="text.secondary">{obj.comment}</Typography>
          )}
        </Box>
      </li>
    );
  };

  // Edit mode: show a loading state while the agent's config is fetched.
  if (isEdit && loadingAgent) {
    return (
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', color: 'text.primary' }}>
        <ChatHeader />
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 160px)', gap: 2 }}>
          <CircularProgress />
          <Typography color="text.secondary">{CREATE_AGENT_TEXT.LOADING_AGENT}</Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', color: 'text.primary' }}>
      <ChatHeader />

      <Container maxWidth="md" sx={{ py: 4 }}>
        <Button
          onClick={onBack}
          startIcon={<ArrowBackIcon />}
          disabled={submitting}
          sx={{ mb: 2, color: 'text.secondary', textTransform: 'none' }}
        >
          {CREATE_AGENT_TEXT.BACK_TO_CHAT}
        </Button>

        <Stack spacing={1} sx={{ mb: 3 }}>
          <Typography variant="h4" component="h1" fontWeight={700}>
            {isEdit ? CREATE_AGENT_TEXT.PAGE_TITLE_EDIT : CREATE_AGENT_TEXT.PAGE_TITLE}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            {isEdit ? CREATE_AGENT_TEXT.PAGE_SUBTITLE_EDIT : CREATE_AGENT_TEXT.PAGE_SUBTITLE}
          </Typography>
        </Stack>

        {success && (
          <Alert severity="success" sx={{ mb: 3 }}>
            <AlertTitle>{isEdit ? CREATE_AGENT_TEXT.SUCCESS_TITLE_EDIT : CREATE_AGENT_TEXT.SUCCESS_TITLE}</AlertTitle>
            {isEdit ? CREATE_AGENT_TEXT.SUCCESS_MESSAGE_EDIT : CREATE_AGENT_TEXT.SUCCESS_MESSAGE}
          </Alert>
        )}
        {error && (
          <Alert severity="error" sx={{ mb: 3, whiteSpace: 'pre-wrap' }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <Box component="form" onSubmit={handleSubmit}>
          <Stack spacing={3}>
            {/* Basics */}
            <Paper elevation={0} sx={sectionPaperSx}>
              <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
                {CREATE_AGENT_TEXT.SECTION_BASICS}
              </Typography>
              <Stack spacing={2.5}>
                <TextField
                  label={CREATE_AGENT_TEXT.NAME_LABEL}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => setTouchedName(true)}
                  required
                  fullWidth
                  disabled={submitting || isEdit}
                  error={!!nameError}
                  helperText={isEdit ? CREATE_AGENT_TEXT.NAME_LOCKED_HELP : (nameError || CREATE_AGENT_TEXT.NAME_HELP)}
                  placeholder="my_sales_agent"
                />
                <TextField
                  label={CREATE_AGENT_TEXT.DISPLAY_NAME_LABEL}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  fullWidth
                  disabled={submitting}
                  helperText={CREATE_AGENT_TEXT.DISPLAY_NAME_HELP}
                  placeholder="Sales Agent"
                />
                <TextField
                  label={CREATE_AGENT_TEXT.COMMENT_LABEL}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  fullWidth
                  multiline
                  minRows={2}
                  disabled={submitting}
                />
                <TextField
                  select
                  label={CREATE_AGENT_TEXT.MODEL_LABEL}
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  fullWidth
                  disabled={submitting}
                  helperText={CREATE_AGENT_TEXT.MODEL_HELP}
                >
                  {modelOptions.map((m) => (
                    <MenuItem key={m} value={m}>{m}</MenuItem>
                  ))}
                </TextField>
              </Stack>
            </Paper>

            {/* Tools */}
            <Paper elevation={0} sx={sectionPaperSx}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
                <Typography variant="h6" fontWeight={600}>{CREATE_AGENT_TEXT.SECTION_TOOLS}</Typography>
                <Tooltip title="Refresh lists" arrow>
                  <span>
                    <IconButton onClick={() => loadTools(toolDatabase, toolSchema)} disabled={loadingTools || submitting} size="small">
                      {loadingTools ? <CircularProgress size={18} /> : <RefreshIcon />}
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>

              {/* Database / schema scope for browsing objects */}
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 1.5 }}>
                <TextField
                  select
                  size="small"
                  label={CREATE_AGENT_TEXT.TOOLS_DATABASE_LABEL}
                  value={toolDatabase}
                  onChange={(e) => setToolDatabase(e.target.value)}
                  disabled={submitting}
                  sx={{ minWidth: { xs: '100%', sm: 240 } }}
                >
                  {dbOptions.map((d) => <MenuItem key={d} value={d}>{d}</MenuItem>)}
                </TextField>
                <TextField
                  select
                  size="small"
                  label={CREATE_AGENT_TEXT.TOOLS_SCHEMA_LABEL}
                  value={toolSchema}
                  onChange={(e) => setToolSchema(e.target.value)}
                  disabled={submitting || !toolDatabase}
                  sx={{ minWidth: { xs: '100%', sm: 240 } }}
                >
                  {schemaOptions.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                </TextField>
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                {CREATE_AGENT_TEXT.TOOLS_SCOPE_HELP}
              </Typography>

              {toolsLoadError && (
                <Alert severity="warning" sx={{ mb: 2, whiteSpace: 'pre-wrap' }}>
                  {CREATE_AGENT_TEXT.TOOLS_LOAD_ERROR}
                  {'\n\n'}{toolsLoadError}
                </Alert>
              )}

              <Stack spacing={3}>
                {/* Semantic views */}
                <Box>
                  <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                    {CREATE_AGENT_TEXT.TOOLS_SEMANTIC_LABEL}
                  </Typography>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'flex-start' }}>
                    <Autocomplete
                      multiple
                      sx={{ flex: 1, width: '100%' }}
                      options={Array.from(new Set([...semanticViews.map((v) => v.fqn), ...selectedSemanticFqns]))}
                      value={selectedSemanticFqns}
                      onChange={(_, v) => setSelectedSemanticFqns(v)}
                      disabled={submitting}
                      renderOption={(props, option) => renderObjectOption(props, option, semanticViews)}
                      renderInput={(params) => (
                        <TextField {...params} label={CREATE_AGENT_TEXT.TOOLS_SEMANTIC_PLACEHOLDER} helperText={CREATE_AGENT_TEXT.TOOLS_SEMANTIC_HELP} />
                      )}
                    />
                    <Button
                      onClick={() => setSemanticDialogOpen(true)}
                      startIcon={<AddIcon />}
                      variant="outlined"
                      disabled={submitting}
                      sx={{ textTransform: 'none', whiteSpace: 'nowrap', mt: { xs: 0, sm: 0.5 } }}
                    >
                      {CREATE_AGENT_TEXT.TOOLS_CREATE_SEMANTIC}
                    </Button>
                  </Stack>

                  {/* Rebind semantic-model-file (YAML) tools to native semantic views */}
                  {modelFileEntries.length > 0 && (
                    <Box
                      sx={{
                        mt: 1.5,
                        p: 1.5,
                        borderRadius: 1.5,
                        border: '1px dashed',
                        borderColor: 'warning.main',
                        bgcolor: (t) => alpha(t.palette.warning.main, 0.06),
                      }}
                    >
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                        {CREATE_AGENT_TEXT.TOOLS_MODELFILE_HELP}
                      </Typography>
                      <Stack spacing={1.5}>
                        {modelFileEntries.map((v) => (
                          <Stack key={v} direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
                            <Typography
                              variant="body2"
                              sx={{ flex: 1, wordBreak: 'break-all', fontFamily: 'monospace', fontSize: '0.8rem' }}
                            >
                              {semanticMeta[v]?.toolSpec?.name ? `${semanticMeta[v].toolSpec.name}: ` : ''}{v}
                            </Typography>
                            <Autocomplete
                              size="small"
                              sx={{ minWidth: { xs: '100%', sm: 300 } }}
                              options={semanticViews.map((o) => o.fqn)}
                              value={null}
                              blurOnSelect
                              onChange={(_, f) => f && rebindSemanticToView(v, f)}
                              disabled={submitting}
                              renderOption={(props, option) => renderObjectOption(props, option, semanticViews)}
                              renderInput={(params) => <TextField {...params} label={CREATE_AGENT_TEXT.TOOLS_REBIND_LABEL} />}
                            />
                          </Stack>
                        ))}
                      </Stack>
                    </Box>
                  )}
                </Box>

                {/* Search services */}
                <Box>
                  <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                    {CREATE_AGENT_TEXT.TOOLS_SEARCH_LABEL}
                  </Typography>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'flex-start' }}>
                    <Autocomplete
                      multiple
                      sx={{ flex: 1, width: '100%' }}
                      options={Array.from(new Set([...searchServices.map((s) => s.fqn), ...selectedSearchFqns]))}
                      value={selectedSearchFqns}
                      onChange={(_, v) => setSelectedSearchFqns(v)}
                      disabled={submitting}
                      renderOption={(props, option) => renderObjectOption(props, option, searchServices)}
                      renderInput={(params) => (
                        <TextField {...params} label={CREATE_AGENT_TEXT.TOOLS_SEARCH_PLACEHOLDER} helperText={CREATE_AGENT_TEXT.TOOLS_SEARCH_HELP} />
                      )}
                    />
                    <Button
                      onClick={() => setSearchDialogOpen(true)}
                      startIcon={<AddIcon />}
                      variant="outlined"
                      disabled={submitting}
                      sx={{ textTransform: 'none', whiteSpace: 'nowrap', mt: { xs: 0, sm: 0.5 } }}
                    >
                      {CREATE_AGENT_TEXT.TOOLS_CREATE_SEARCH}
                    </Button>
                  </Stack>
                </Box>
              </Stack>
            </Paper>

            {/* Instructions */}
            <Paper elevation={0} sx={sectionPaperSx}>
              <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
                {CREATE_AGENT_TEXT.SECTION_INSTRUCTIONS}
              </Typography>
              <Stack spacing={2.5}>
                <TextField
                  label={CREATE_AGENT_TEXT.RESPONSE_INSTRUCTION_LABEL}
                  value={responseInstruction}
                  onChange={(e) => setResponseInstruction(e.target.value)}
                  fullWidth multiline minRows={2} disabled={submitting}
                  helperText={CREATE_AGENT_TEXT.RESPONSE_INSTRUCTION_HELP}
                />
                <TextField
                  label={CREATE_AGENT_TEXT.ORCHESTRATION_INSTRUCTION_LABEL}
                  value={orchestrationInstruction}
                  onChange={(e) => setOrchestrationInstruction(e.target.value)}
                  fullWidth multiline minRows={2} disabled={submitting}
                  helperText={CREATE_AGENT_TEXT.ORCHESTRATION_INSTRUCTION_HELP}
                />
                <TextField
                  label={CREATE_AGENT_TEXT.SYSTEM_INSTRUCTION_LABEL}
                  value={systemInstruction}
                  onChange={(e) => setSystemInstruction(e.target.value)}
                  fullWidth multiline minRows={2} disabled={submitting}
                  helperText={CREATE_AGENT_TEXT.SYSTEM_INSTRUCTION_HELP}
                />
              </Stack>
            </Paper>

            {/* Sample questions */}
            <Paper elevation={0} sx={sectionPaperSx}>
              <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
                {CREATE_AGENT_TEXT.SECTION_QUESTIONS}
              </Typography>
              <Stack spacing={1.5}>
                {sampleQuestions.map((question, index) => (
                  <Stack key={index} direction="row" spacing={1} alignItems="center">
                    <TextField
                      label={`${CREATE_AGENT_TEXT.QUESTION_LABEL} ${index + 1}`}
                      value={question}
                      onChange={(e) => handleQuestionChange(index, e.target.value)}
                      fullWidth
                      disabled={submitting}
                    />
                    <Tooltip title="Remove question" arrow>
                      <span>
                        <IconButton
                          onClick={() => handleRemoveQuestion(index)}
                          disabled={submitting || sampleQuestions.length === 1}
                          aria-label="remove question"
                        >
                          <DeleteIcon />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>
                ))}
                <Box>
                  <Button onClick={handleAddQuestion} startIcon={<AddIcon />} disabled={submitting} sx={{ textTransform: 'none' }}>
                    {CREATE_AGENT_TEXT.ADD_QUESTION}
                  </Button>
                </Box>
              </Stack>
            </Paper>

            {/* Advanced */}
            <Accordion
              elevation={0}
              sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, '&:before': { display: 'none' }, bgcolor: 'background.paper' }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="h6" fontWeight={600}>{CREATE_AGENT_TEXT.SECTION_ADVANCED}</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={2.5}>
                  <Typography variant="body2" color="text.secondary">
                    {CREATE_AGENT_TEXT.ADVANCED_HELP}
                  </Typography>
                  <TextField
                    label={CREATE_AGENT_TEXT.TOOLS_LABEL}
                    value={toolsJson}
                    onChange={(e) => setToolsJson(e.target.value)}
                    fullWidth multiline minRows={4} disabled={submitting}
                    helperText={CREATE_AGENT_TEXT.TOOLS_HELP}
                    placeholder='[{ "tool_spec": { "type": "cortex_analyst_text_to_sql", "name": "analyst1" } }]'
                    InputProps={{ sx: { fontFamily: 'monospace', fontSize: '0.85rem' } }}
                  />
                  <TextField
                    label={CREATE_AGENT_TEXT.TOOL_RESOURCES_LABEL}
                    value={toolResourcesJson}
                    onChange={(e) => setToolResourcesJson(e.target.value)}
                    fullWidth multiline minRows={4} disabled={submitting}
                    helperText={CREATE_AGENT_TEXT.TOOL_RESOURCES_HELP}
                    placeholder='{ "analyst1": { "semantic_view": "MY_DB.MY_SCHEMA.MY_VIEW" } }'
                    InputProps={{ sx: { fontFamily: 'monospace', fontSize: '0.85rem' } }}
                  />
                </Stack>
              </AccordionDetails>
            </Accordion>

            <Divider />

            {/* Options + submit */}
            <Stack spacing={2}>
              {!isEdit && (
                <FormControlLabel
                  control={<Checkbox checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} disabled={submitting} />}
                  label={CREATE_AGENT_TEXT.OVERWRITE_LABEL}
                />
              )}
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={2}
                justifyContent="space-between"
                alignItems={{ xs: 'stretch', sm: 'center' }}
              >
                {/* Export config as YAML (for source control / multi-env deploys) */}
                <Stack direction="row" spacing={1}>
                  <Button
                    onClick={handleDownloadYaml}
                    startIcon={<DownloadIcon />}
                    variant="outlined"
                    disabled={submitting}
                    sx={{ textTransform: 'none' }}
                  >
                    {CREATE_AGENT_TEXT.EXPORT_YAML}
                  </Button>
                  <Tooltip title={CREATE_AGENT_TEXT.COPY_YAML} arrow>
                    <span>
                      <IconButton onClick={handleCopyYaml} disabled={submitting} size="small">
                        <ContentCopyIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Stack>

                <Stack direction="row" spacing={2} justifyContent="flex-end">
                <Button onClick={onBack} disabled={submitting} sx={{ textTransform: 'none' }}>Cancel</Button>
                <Button
                  type="submit"
                  variant="contained"
                  size="large"
                  disabled={submitting || success}
                  startIcon={submitting ? <CircularProgress size={18} color="inherit" /> : undefined}
                  sx={{
                    textTransform: 'none',
                    px: 4,
                    background: (theme) => `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.primary.dark})`,
                    boxShadow: (theme) => `0 4px 16px ${alpha(theme.palette.primary.main, 0.4)}`,
                  }}
                >
                  {submitting
                    ? (isEdit ? CREATE_AGENT_TEXT.SUBMITTING_EDIT : CREATE_AGENT_TEXT.SUBMITTING)
                    : (isEdit ? CREATE_AGENT_TEXT.SUBMIT_EDIT : CREATE_AGENT_TEXT.SUBMIT)}
                </Button>
                </Stack>
              </Stack>
            </Stack>
          </Stack>
        </Box>
      </Container>

      {/* Semantic view builder dialog */}
      <Dialog open={semanticDialogOpen} onClose={() => setSemanticDialogOpen(false)} maxWidth="md" fullWidth scroll="paper">
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {CREATE_AGENT_TEXT.TOOLS_CREATE_SEMANTIC}
          <IconButton onClick={() => setSemanticDialogOpen(false)} size="small"><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <CreateSemanticViewForm
            context={context}
            onCreated={handleSemanticCreated}
            onCancel={() => setSemanticDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Search service builder dialog */}
      <Dialog open={searchDialogOpen} onClose={() => setSearchDialogOpen(false)} maxWidth="md" fullWidth scroll="paper">
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {CREATE_AGENT_TEXT.TOOLS_CREATE_SEARCH}
          <IconButton onClick={() => setSearchDialogOpen(false)} size="small"><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <CreateSearchServiceForm
            context={context}
            onCreated={handleSearchCreated}
            onCancel={() => setSearchDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <Snackbar
        open={!!notice}
        autoHideDuration={2500}
        onClose={() => setNotice(null)}
        message={notice}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Box>
  );
};

export default CreateAgentPage;
