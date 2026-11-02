/**
 * MessageFeedback Component
 * Thumbs up/down on an assistant answer. Clicking a thumb opens a dialog for
 * categories + comment, then sends it to the agent's :feedback endpoint with the
 * answer's request id so it shows up in the agent's monitoring.
 */

import React, { useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  alpha,
  useTheme
} from '@mui/material';
import {
  ThumbUpAltOutlined as ThumbUpOutlinedIcon,
  ThumbUpAlt as ThumbUpIcon,
  ThumbDownAltOutlined as ThumbDownOutlinedIcon,
  ThumbDownAlt as ThumbDownIcon
} from '@mui/icons-material';
import { ChatMessage as ChatMessageType } from '../../types/chat';
import { submitAgentFeedback } from '../../services/snowflakeEvalsApi';
import { EVALS_TEXT } from '../../constants/textConstants';

interface MessageFeedbackProps {
  agentName: string;
  message: ChatMessageType;
}

export const MessageFeedback: React.FC<MessageFeedbackProps> = ({ agentName, message }) => {
  const theme = useTheme();
  const [submitted, setSubmitted] = useState<boolean | null>(null);
  const [dialogPositive, setDialogPositive] = useState<boolean | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toastOpen, setToastOpen] = useState(false);

  const origRequestId = message.requestId || message.runId;

  const openDialog = (positive: boolean) => {
    setDialogPositive(positive);
    setCategories([]);
    setComment('');
    setError(null);
  };

  const closeDialog = () => {
    if (!sending) setDialogPositive(null);
  };

  const toggleCategory = (category: string) => {
    setCategories(prev => prev.includes(category) ? prev.filter(c => c !== category) : [...prev, category]);
  };

  const handleSubmit = async () => {
    if (dialogPositive === null) return;
    setSending(true);
    setError(null);
    try {
      await submitAgentFeedback(agentName, {
        positive: dialogPositive,
        categories: categories.length ? categories : undefined,
        feedback_message: comment.trim() || undefined,
        orig_request_id: origRequestId,
        thread_id: message.threadId
      });
      setSubmitted(dialogPositive);
      setDialogPositive(null);
      setToastOpen(true);
    } catch (err: any) {
      setError(err?.fullMessage || err?.message || EVALS_TEXT.SUBMIT_ERROR);
    } finally {
      setSending(false);
    }
  };

  const buttonSx = (active: boolean) => ({
    color: active ? 'primary.main' : 'text.secondary',
    padding: '4px',
    '&:hover': {
      color: 'primary.main',
      backgroundColor: alpha(theme.palette.primary.main, 0.1)
    }
  });

  const options = dialogPositive ? EVALS_TEXT.POSITIVE_CATEGORIES : EVALS_TEXT.NEGATIVE_CATEGORIES;

  return (
    <>
      <Tooltip title={EVALS_TEXT.HELPFUL_TOOLTIP} arrow>
        <span>
          <IconButton
            size="small"
            onClick={() => openDialog(true)}
            disabled={submitted !== null}
            aria-label={EVALS_TEXT.HELPFUL_TOOLTIP}
            sx={buttonSx(submitted === true)}
          >
            {submitted === true ? <ThumbUpIcon sx={{ fontSize: 18 }} /> : <ThumbUpOutlinedIcon sx={{ fontSize: 18 }} />}
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={EVALS_TEXT.NOT_HELPFUL_TOOLTIP} arrow>
        <span>
          <IconButton
            size="small"
            onClick={() => openDialog(false)}
            disabled={submitted !== null}
            aria-label={EVALS_TEXT.NOT_HELPFUL_TOOLTIP}
            sx={buttonSx(submitted === false)}
          >
            {submitted === false ? <ThumbDownIcon sx={{ fontSize: 18 }} /> : <ThumbDownOutlinedIcon sx={{ fontSize: 18 }} />}
          </IconButton>
        </span>
      </Tooltip>

      <Dialog open={dialogPositive !== null} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>
          {dialogPositive ? EVALS_TEXT.DIALOG_TITLE_POSITIVE : EVALS_TEXT.DIALOG_TITLE_NEGATIVE}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
              {options.map(category => (
                <Chip
                  key={category}
                  label={category}
                  onClick={() => toggleCategory(category)}
                  color={categories.includes(category) ? 'primary' : 'default'}
                  variant={categories.includes(category) ? 'filled' : 'outlined'}
                />
              ))}
            </Stack>
            <TextField
              label={EVALS_TEXT.COMMENT_LABEL}
              placeholder={EVALS_TEXT.COMMENT_PLACEHOLDER}
              value={comment}
              onChange={e => setComment(e.target.value)}
              multiline
              minRows={2}
              inputProps={{ maxLength: 2000 }}
              fullWidth
            />
            {!origRequestId && <Alert severity="info">{EVALS_TEXT.NO_REQUEST_ID}</Alert>}
            {error && (
              <Alert severity="error" sx={{ whiteSpace: 'pre-wrap' }}>{error}</Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog} disabled={sending} color="inherit">{EVALS_TEXT.CANCEL}</Button>
          <Button
            onClick={handleSubmit}
            disabled={sending}
            variant="contained"
            startIcon={sending ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {sending ? EVALS_TEXT.SUBMITTING : EVALS_TEXT.SUBMIT}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={toastOpen}
        autoHideDuration={3000}
        onClose={() => setToastOpen(false)}
        message={EVALS_TEXT.SUBMITTED}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </>
  );
};
