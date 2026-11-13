import { lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import './voice-workspace.css';
import { readModelCatalog } from '../lib/api';
import { ModelReadStatus } from './ModelReadStatus';
import { t, formatNumber, useLocale, type MessageParams } from '../i18n';
import { MotionDetails } from '../motion/Presence';
import { useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  Microphone,
  PhoneDisconnect,
  ClosedCaptioning,
  DotsThree,
  Keyboard,
  ChatText,
  Eye,
  MagnifyingGlass,
  Sparkle,
  Pause,
  Plus,
  GearSix,
  CaretDown,
  ClockCounterClockwise,
  Paperclip,
  ImageSquare,
  WarningCircle,
  ArrowsOut,
  ArrowsIn,
  ArrowLeft,
  X,
} from '@phosphor-icons/react';
import type {
  AssistantCandidate,
  AssistantContext,
  AssistantCitation,
  AssistantCloudResource,
  AssistantSearchEvidence,
  VoiceServerEvent,
  AssistantGrant,
  AssistantWorkspace,
  MemorySuggestion,
  AssistantBranchEvent,
  AssistantResearchBranch,
  AssistantVisualAttachment,
  AssistantResponseTuning,
  LiveDelegationOptions,
  LiveTranslationOptions,
} from '@ai-xiutu/contracts';
import { assistantSearchEvidenceSchema, defaultLiveDecisionQuestions,
  OPENAI_DECISIONS_MODEL, OPENAI_TRANSLATION_MODEL, liveDelegationSchema } from '@ai-xiutu/contracts';
import { parseEditorRecipe, type EditorRecipe } from '@ai-xiutu/editor';
import { api, ApiError, errorMessage, jsonRequest } from '../lib/api';
import { secureUuid } from '../lib/uuid';
import type { Artwork, Project, Session, Space } from '../lib/types';
import { EditorVoiceClient } from './voiceClient';
import { LiveModeSettings } from './LiveModeSettings';
import { appendCaption, type CaptionState, VoiceCaptions } from './VoiceCaptions';
import {
  acknowledgeEditCandidate,
  assistantEditorKey,
  assistantScopeKey,
  AssistantOperationGate,
  type AssistantEditorState,
  type AssistantOperationToken,
} from './assistantGuards';
import './live-assistant.css';
import { IconButton, Modal } from '../components/Ui';
import { StudioGlyph } from '../components/StudioGlyph';
import { ThemeContext } from '../components/ThemeSwitch';
import { ChoiceSelect } from '../components/ChoiceSelect';
import PromptBar from '../components/react-bits/PromptBar';
import { DraftAttachmentCard, visualAttachmentLabel } from './DraftAttachmentCard';
import { AssistantActivity, ExecutionStatus } from './ExecutionStatus';
import VoicePill from '../components/react-bits/VoicePill';
import {
  appendPublicExecutionEvent,
  type PublicExecutionEvent,
} from './execution-events';
import { RubberSegment } from '../components/control-motion';
import { ComposerVisual } from './ComposerVisual';
import { IDLE_AI_ACTIVITY, type AIActivity } from './AIVisibility';
import { PanelSettings } from './PanelSettings';
import { PanelSettingsPage } from './PanelSettingsPage';
import { ModelChoice } from './ModelChoice';
import { modelCopy } from './model-copy';
import { CreativeControls, initialCreativeSettings } from './CreativeControls';
import { observeAssistantTurn, type RunEvent } from './turnStream';
import { ContextEvidence } from './ContextEvidence';
import { ResearchGraph } from './ResearchGraph';
import { AssistantText, CopyMessage } from './AssistantText';
import { MemoryControls } from './MemoryControls';
import { WorkspaceCards } from './WorkspaceCards';
import { CandidateActions } from './CandidateActions';
import { voiceErrorMessage } from './voice-error';
import { CloudImageResults, SearchEvidence } from './SearchEvidence';
import {
  acceptAssistantSubmission,
  assistantSubmissionRequest,
  assistantSubmissionResolved,
  clearAssistantSubmission,
  freezeAssistantSubmission,
  isAssistantAdmissionRejected,
  readAssistantSubmission,
  saveAssistantSubmission,
  type AssistantSubmission,
} from './assistantSubmission';
import {
  acceptVoiceSubmission,
  clearVoiceSubmission,
  freezeVoiceSubmission,
  isVoiceAdmissionRejected,
  readVoiceSubmission,
  saveVoiceSubmission,
  voiceSubmissionEvent,
  voiceSubmissionRequest,
  type VoiceSubmission,
} from './voiceSubmission';
import { readTeamVoiceSubmission, type TeamVoiceSubmission } from './teamVoiceSubmission';
import { VOICE_SUBMISSION_CHANGED } from './voiceSubmissionStorage';

export type CaptureCurrentImage = () => Promise<AssistantContext & { imageDataUrl: string }>;
interface Model {
  id: string;
  label: string;
  operations: string[];
  unitCost: number;
  maxSeconds: number;
  maxDelegations: number;
  maxOutputTokens?: number;
  imageInput: boolean;
  webSearch: boolean;
  webImageSearch?: boolean;
  voice?: { voices: string[] } | null;
  responses?: { reasoning: readonly string[]; defaultEffort?: string; verbosity?: boolean;
    deprecated?: boolean; streaming?: boolean; tiers?: readonly string[] } | null;
  responseDefaults?: AssistantResponseTuning & { effortFixedForSampling?: boolean };
}
interface Catalog {
  ready: boolean;
  voiceReady: boolean;
  reason: string | null;
  models: Model[];
}
interface Turn {
  id: string;
  modelId?: string;
  conversationId?: string;
  state: string;
  stopRequested?: boolean;
  prompt?: string;
  output?: {
    text: string;
    reasoningSummary?: string;
    citations: AssistantCitation[];
    search?: AssistantSearchEvidence[];
    candidates: AssistantCandidate[];
    workspace?: AssistantWorkspace;
    memorySuggestions?: MemorySuggestion[];
    execution?: {
      state: 'applied' | 'blocked' | 'review_required';
      code?: string;
      artworkId?: string;
      revisionId?: string;
    };
  };
  errorCode?: string;
}

type StatusMessage =
  | string
  | {
      message: string;
      params: MessageParams;
      labels?: string[];
    };
/** Keep app messages as source text while a request is in flight. A language
 * change must never rewrite user prompts or model-generated conversation text. */
function renderStatus(status: StatusMessage): string {
  if (typeof status === 'string') return t(status);
  const params = { ...status.params };
  for (const key of status.labels ?? []) params[key] = t(String(params[key] ?? ''));
  return t(status.message, params);
}
function turnStatus(turn: Turn): StatusMessage {
  if (turn.state === 'unknown') return '本轮结果待核验，可以在用量记录中查看。';
  if (turn.state === 'stopped') return '本轮已停止。已完成的供应商调用可在用量记录中查看。';
  if (turn.state === 'unavailable') return '本轮引用的素材权限已变化。';
  return { message: '本轮未完成（{code}）', params: { code: turn.errorCode ?? turn.state } };
}
interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  reasoningSummary?: string;
  appStatus?: StatusMessage;
  citations?: AssistantCitation[];
  search?: AssistantSearchEvidence[];
  attachmentKind?: AssistantVisualAttachment['kind'];
  voiceSession?: number;
  candidateIds?: string[];
}
const assistantDrafts = new Map<
  string,
  {
    prompt: string;
    mode: 'text' | 'voice';
    conversationId: string | undefined;
  }
>();
export interface LiveAssistantProps {
  navigation?: ReactNode;
  visible?: boolean;
  hidden?: boolean;
  onActivityChange?: (activity: AIActivity) => void;
  onClose?: () => void;
  project: Project | null;
  artwork: Artwork | null;
  recipe: EditorRecipe;
  isLoggedIn: boolean;
  onAuth: () => void;
  onSave: () => void;
  onExport?: () => void;
  onTopUp?: () => void;
  voiceEntry?: number;
  onPreview: (recipe: EditorRecipe) => void;
  previewActive?: boolean;
  onConfirmPreview?: () => void;
  onCancelPreview?: () => void;
  imageModelIds: string[];
  onBeforeArtworkWrite?: () => void | Promise<void>;
  onAfterArtworkWrite?: () => void | Promise<void>;
  onApplied: (artworkId: string) => void | Promise<void>;
  onPrepareGenerationDraft: (draft: {
    executionGrantId?: string;
    candidateId: string;
    prompt: string;
    referenceAssetIds: string[];
  }) => Promise<(() => void) | null>;
  captureCurrentImage?: CaptureCurrentImage;
  visualAttachment?: AssistantVisualAttachment | null;
  onClearVisualAttachment?: (attachment: AssistantVisualAttachment) => void;
  onUseCanvasSource?: (item: AssistantCloudResource) => void;
}
function editorState(value: LiveAssistantProps): AssistantEditorState {
  return {
    loggedIn: value.isLoggedIn,
    projectId: value.project?.id ?? null,
    spaceId: value.project?.spaceId ?? null,
    artworkId: value.artwork?.id ?? null,
    assetId: value.artwork?.assetId ?? null,
    version: value.artwork?.headVersion ?? null,
    recipe: value.recipe,
  };
}
const Strands = lazy(() => import('../components/react-bits/Strands'));
const VOICE_STRANDS_LIGHT = ['#d28438', '#bd8b39', '#d6a94d', '#fff5d8', '#4c917f', '#77ae9f', '#3d7569'];
const VOICE_STRANDS_DARK = ['#b7f3d8', '#8ce2c2', '#a8ebd7', '#f1fff0', '#84ebdf', '#51c9bb', '#3ea999'];

export function LiveAssistant(props: LiveAssistantProps) {
  const compactCopy = modelCopy(useLocale());
  const [composerExpanded, setComposerExpanded] = useState(false);
  const {
    project,
    artwork,
    recipe,
    isLoggedIn,
    onAuth,
    onSave,
    onPrepareGenerationDraft,
    captureCurrentImage,
  } = props;
  const [catalogError, setCatalogError] = useState('');
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [spaces, setSpaces] = useState<Space[]>([]);
  const [creative, setCreative] = useState(initialCreativeSettings);
  const [grant, setGrant] = useState<AssistantGrant | null>(null);
  const [contextManifest, setContextManifest] = useState<Record<string, any> | null>(null);
  const [workspace, setWorkspace] = useState<{
    spec: AssistantWorkspace;
    candidateIds: string[];
  } | null>(null);
  const freshConversation = useRef(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [conversations, setConversations] = useState<
    { id: string; title: string; turnCount: number }[]
  >([]);
  const [memorySuggestions, setMemorySuggestions] = useState<{
    items: MemorySuggestion[];
    sourceTurnId?: string;
  }>({ items: [] });
  const streamText = useRef(new Map<string, string>());
  const activeGrant = useRef<AssistantGrant | null>(null);
  activeGrant.current = grant;
  const [modelId, setModelId] = useState(''),
    [voiceId, setVoiceId] = useState(''),
    [voice, setVoice] = useState('marin');
  const [liveDelegation, setLiveDelegation] = useState<LiveDelegationOptions>({ type: 'client' });
  const [liveTranslation, setLiveTranslation] = useState<LiveTranslationOptions>({ language: 'en' });
  const [delegatedResult, setDelegatedResult] = useState<{ kind: 'responses' | 'decisions'; text: string } | null>(null);
  const [mode, setMode] = useState<'text' | 'voice'>('text'),
    [callState, setCallState] = useState<'idle' | 'connecting' | 'active' | 'closing'>('idle');
  const [voiceExpanded, setVoiceExpanded] = useState(false);
  const voiceStartButton = useRef<HTMLButtonElement>(null);
  const voiceDark = useContext(ThemeContext)?.theme === 'dark';
  const [voiceToolsOpen, setVoiceToolsOpen] = useState(false);
  const [voiceExtra, setVoiceExtra] = useState<'text' | 'details' | null>(null);
  const [voiceCaptionsVisible, setVoiceCaptionsVisible] = useState(true);
  const voiceLevel = useRef(0);
  const readVoiceLevel = useCallback(() => voiceLevel.current, []);
  const setVoiceLevel = useCallback((level: number) => { voiceLevel.current = level; }, []);
  const voiceToolsId = useId();
  const voiceTextId = useId();
  const voiceDetailsId = useId();
  const voiceContextId = useId();
  const voiceToolsTrigger = useRef<HTMLButtonElement>(null);
  const voiceTextInput = useRef<HTMLTextAreaElement>(null);
  const voiceTextTrigger = useRef<HTMLButtonElement>(null);
  const voiceDetailsTrigger = useRef<HTMLButtonElement>(null);
  function closeVoiceExtra() {
    const trigger = voiceExtra === 'text' ? voiceTextTrigger : voiceDetailsTrigger;
    setVoiceExtra(null);
    trigger.current?.focus({ preventScroll: true });
  }
  const voiceWorkspace = useRef<HTMLElement>(null);
  const voiceEntry = useRef<HTMLElement | null>(null);
  const dismissVoice = () => {
    setVoiceExpanded(false);
    if (callState === 'idle') setMode('text');
    const trigger = voiceEntry.current;
    requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      else composerInput.current?.focus({ preventScroll: true });
    });
  };
  const showVoice = useCallback((trigger?: HTMLElement) => {
    voiceEntry.current = trigger ?? null;
    setMode('voice');
    setVoiceExpanded(true);
  }, []);
  const lastVoiceEntry = useRef(0);
  useEffect(() => {
    if (props.visible && (props.voiceEntry ?? 0) > lastVoiceEntry.current) {
      lastVoiceEntry.current = props.voiceEntry!;
      showVoice();
    }
  }, [props.visible, props.voiceEntry, showVoice]);
  const composerInput = useRef<HTMLTextAreaElement>(null);
  const conversationBody = useRef<HTMLDivElement>(null);
  const followingConversation = useRef(true);
  const [overlay, setOverlay] = useState<'settings' | 'history' | 'recovery' | null>(null);
  const [prompt, setPrompt] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<StatusMessage>('');
  const [actorId, setActorId] = useState<string | null>(null),
    [submissionReady, setSubmissionReady] = useState(false),
    [pendingSubmission, setPendingSubmission] = useState<AssistantSubmission | null>(null);
  const actor = useRef(actorId),
    submission = useRef<AssistantSubmission | null>(null);
  const [voiceSubmissionReady, setVoiceSubmissionReady] = useState(false),
    [pendingVoiceSubmission, setPendingVoiceSubmission] = useState<VoiceSubmission | null>(null),
    [pendingTeamVoiceSubmission, setPendingTeamVoiceSubmission] =
      useState<TeamVoiceSubmission | null>(null),
    [voiceRecoveryError, setVoiceRecoveryError] = useState('');
  const voiceSubmission = useRef<VoiceSubmission | null>(null);
  actor.current = actorId;
  const textDraft = useRef({ prompt, mode, conversationId });
  const submittedVisual = useRef<{ key: string; attachment: AssistantVisualAttachment } | null>(
    null,
  );
  textDraft.current = { prompt, mode, conversationId };
  const [shareImage, setShareImage] = useState(false),
    [allowWebSearch, setAllowWebSearch] = useState(false),
    [memory, setMemory] = useState(false);
  const [publicQuery, setPublicQuery] = useState('');
  const [secondPublicQuery, setSecondPublicQuery] = useState('');
  const [researchLibrary, setResearchLibrary] = useState('');
  const [researchCanvas, setResearchCanvas] = useState(false);
  const [researchGraph, setResearchGraph] = useState<{
    turnId: string;
    nodes: AssistantBranchEvent[];
  } | null>(null);
  const [publicImages, setPublicImages] = useState(false);
  const [voiceCaptions, setVoiceCaptions] = useState<CaptionState>({});
  const [voiceSearchRemaining, setVoiceSearchRemaining] = useState(0);
  const [activeTurn, setActiveTurn] = useState<{ id: string; stopping: boolean } | null>(null);
  const [executionEvents, setExecutionEvents] = useState<readonly PublicExecutionEvent[]>([]);
  const [submittingTurn, setSubmittingTurn] = useState(false);
  const [settledTurn, setSettledTurn] = useState<Pick<Turn, 'id' | 'state'> | null>(null);
  const [sharedRangeOpen, setSharedRangeOpen] = useState(false);
  const [spaceIds, setSpaceIds] = useState<string[]>(project ? [project.spaceId] : []),
    [referenceIds, setReferenceIds] = useState<string[]>([]);
  const [resourceQuery, setResourceQuery] = useState(''),
    [resources, setResources] = useState<AssistantCloudResource[]>([]);
  const [searchStatus, setSearchStatus] = useState<StatusMessage>('');
  const [messages, setMessages] = useState<Message[]>([]),
    [candidates, setCandidates] = useState<AssistantCandidate[]>([]);
  const [previewCandidateId, setPreviewCandidateId] = useState<string | null>(null);
  const [confirmedCandidateIds, setConfirmedCandidateIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  useEffect(() => {
    if (props.previewActive === false) setPreviewCandidateId(null);
  }, [props.previewActive]);
  useEffect(() => {
    setPreviewCandidateId(null);
    setConfirmedCandidateIds(new Set());
  }, [project?.id, artwork?.id]);
  function cancelCandidatePreview() {
    props.onCancelPreview?.();
    setPreviewCandidateId(null);
  }
  function confirmCandidatePreview() {
    if (!previewCandidateId || !props.onConfirmPreview) return;
    props.onConfirmPreview();
    setConfirmedCandidateIds((old) => new Set([...old, previewCandidateId]));
    setPreviewCandidateId(null);
  }
  const [historyEpoch, setHistoryEpoch] = useState(0);
  const [candidateHistoryStatus, setCandidateHistoryStatus] = useState<StatusMessage>('');
  const [parentTurnId, setParentTurnId] = useState<string | undefined>(),
    [muted, setMuted] = useState(false),
    [elapsed, setElapsed] = useState(0);
  const [toolStatus, setToolStatus] = useState<StatusMessage>(''),
    [contextStatus, setContextStatus] = useState('未共享画面');
  const voiceEpoch = useRef(0),
    voiceEnding = useRef(false),
    voiceCanvas = useRef<{
      accepted: string;
      shared?: boolean;
      pending?: { key: string; tag: string; shared: boolean };
    }>({
      accepted: '',
    }),
    turnAbort = useRef<AbortController | null>(null);
  const lastVoiceContextSend = useRef(-Infinity);
  const turnObservation = useRef<{
    id: string;
    token: AssistantOperationToken;
    controller: AbortController;
  } | null>(null);
  const client = useRef<EditorVoiceClient | null>(null),
    current = useRef(props),
    alive = useRef(true);
  const requests = useRef(new AssistantOperationGate()),
    searches = useRef(new AssistantOperationGate());
  const searchAbort = useRef<{
    token: AssistantOperationToken;
    controller: AbortController;
  } | null>(null);
  current.current = props;
  const requestScope = assistantScopeKey(editorState(props));
  requests.current.setScope(requestScope);
  const voiceScope = useRef(requestScope);
  if (voiceScope.current !== requestScope) {
    voiceScope.current = requestScope;
    voiceEpoch.current++;
  }
  const searchScope = JSON.stringify([requestScope, [...spaceIds].sort(), resourceQuery]);
  searches.current.setScope(searchScope);
  function requestIsActive(token: AssistantOperationToken) {
    return (
      alive.current &&
      requests.current.owns(token) &&
      assistantScopeKey(editorState(current.current)) === token.scope
    );
  }
  function rememberSubmission(value: AssistantSubmission) {
    saveAssistantSubmission(sessionStorage, value);
    if (alive.current && actor.current === value.actorId) {
      submission.current = value;
      setPendingSubmission(value);
    }
  }
  function resolveSubmission(value: AssistantSubmission) {
    clearAssistantSubmission(sessionStorage, value);
    if (submittedVisual.current?.key === value.idempotencyKey) submittedVisual.current = null;
    if (alive.current && submission.current?.idempotencyKey === value.idempotencyKey) {
      submission.current = null;
      setPendingSubmission(null);
    }
  }
  function acknowledgeKnownTurn(turn: Turn) {
    const saved = submission.current;
    if (!saved || saved.actorId !== actor.current || saved.turnId !== turn.id) return;
    if (assistantSubmissionResolved(turn.state)) resolveSubmission(saved);
    else if (turn.state === 'unknown' && saved.state !== 'unknown')
      rememberSubmission(acceptAssistantSubmission(saved, turn));
    setPrompt((old) => (old.trim() === saved.prompt ? '' : old));
  }
  function restoreSubmission() {
    setSubmissionReady(false);
    if (!isLoggedIn || !actorId) return;
    try {
      const saved = readAssistantSubmission(sessionStorage, actorId);
      submission.current = saved;
      setPendingSubmission(saved);
      setSubmissionReady(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  function rememberVoiceSubmission(value: VoiceSubmission) {
    saveVoiceSubmission(localStorage, value);
    if (alive.current && actor.current === value.actorId) {
      voiceSubmission.current = value;
      setPendingVoiceSubmission(value);
    }
  }
  function resolveVoiceSubmission(value: VoiceSubmission) {
    clearVoiceSubmission(localStorage, value);
    if (alive.current && voiceSubmission.current?.idempotencyKey === value.idempotencyKey) {
      voiceSubmission.current = null;
      setPendingVoiceSubmission(null);
    }
  }
  function restoreVoiceSubmission() {
    setVoiceSubmissionReady(false);
    if (!isLoggedIn || !actorId) return;
    try {
      const saved = readVoiceSubmission(localStorage, actorId);
      const team = readTeamVoiceSubmission(localStorage, actorId);
      voiceSubmission.current = saved;
      setPendingVoiceSubmission(saved);
      setPendingTeamVoiceSubmission(team);
      setVoiceRecoveryError('');
      setVoiceSubmissionReady(true);
    } catch (err) {
      setVoiceRecoveryError(errorMessage(err));
    }
  }
  function searchIsActive(token: AssistantOperationToken) {
    return (
      alive.current &&
      searches.current.owns(token) &&
      assistantScopeKey(editorState(current.current)) === requestScope
    );
  }
  const models = catalog?.models.filter((item) => item.operations.includes('assistant-turn')) ?? [];
  const voices = catalog?.models.filter((item) => item.operations.includes('realtime-voice')) ?? [];
  const selected = models.find((item) => item.id === modelId),
    selectedVoice = voices.find((item) => item.id === voiceId);
  const [tuningByModel, setTuningByModel] = useState<Record<string, AssistantResponseTuning>>({});
  const tuning = tuningByModel[modelId];
  const activeTuning: AssistantResponseTuning = {
    ...(tuning?.effort && !selected?.responseDefaults?.effortFixedForSampling && selected?.responses?.reasoning.includes(tuning.effort) ? { effort: tuning.effort } : {}),
    ...(tuning?.verbosity && selected?.responses?.verbosity ? { verbosity: tuning.verbosity } : {}),
  };
  const submissionBlocked = !submissionReady || !!pendingSubmission;
  const voiceOptions = selectedVoice?.voice?.voices ?? [];
  const translating = voiceId === OPENAI_TRANSLATION_MODEL;
  const actualDelegation = voiceId === 'gpt-live-1' ? liveDelegation : undefined;
  const nativeMode = actualDelegation?.type === 'responses' || actualDelegation?.type === 'decisions';
  const voiceBackendOk = translating || actualDelegation?.type === 'decisions' ||
    (!!selected && (actualDelegation?.type !== 'responses' || (
      !!selected.responses?.streaming && !selected.responseDefaults?.effortFixedForSampling &&
      liveDelegationSchema.safeParse(actualDelegation).success &&
      (actualDelegation.maxOutputTokens ?? 16) <= (selected.maxOutputTokens ?? 2048) &&
      (!actualDelegation.serviceTier || ['auto','default'].includes(actualDelegation.serviceTier) ||
        selected.responses.tiers?.includes(actualDelegation.serviceTier))
    )));
  useEffect(() => {
    if (voiceOptions.length && !voiceOptions.includes(voice)) setVoice(voiceOptions[0]!);
  }, [voiceId, voiceOptions.join(','), voice]);
  const inCall = callState !== 'idle';
  const voiceVisible = voiceExpanded && mode === 'voice' && isLoggedIn && props.visible !== false && !overlay;
  useLayoutEffect(() => {
    if (!voiceVisible || !voiceWorkspace.current) return;
    const element = voiceWorkspace.current;
    const viewport = window.visualViewport;
    const position = () => {
      const top = viewport?.offsetTop ?? 0;
      const bottom = viewport ? Math.max(0, window.innerHeight - viewport.height - top) : 0;
      element.style.setProperty('--voice-viewport-top', top + 'px');
      element.style.setProperty('--voice-viewport-bottom', bottom + 'px');
    };
    position();
    viewport?.addEventListener('resize', position);
    viewport?.addEventListener('scroll', position);
    return () => {
      viewport?.removeEventListener('resize', position);
      viewport?.removeEventListener('scroll', position);
    };
  }, [voiceVisible]);
  useEffect(() => {
    if (!voiceVisible) return;
    const firstControl = voiceStartButton.current ?? voiceWorkspace.current?.querySelector<HTMLButtonElement>('button');
    firstControl?.focus({ preventScroll: true });
  }, [voiceVisible]);
  useEffect(() => {
    if (voiceVisible && voiceExtra === 'text') voiceTextInput.current?.focus({ preventScroll: true });
  }, [voiceVisible, voiceExtra]);
  useEffect(() => {
    if (callState === 'connecting') {
      setVoiceToolsOpen(false);
      setVoiceExtra(null);
    } else if (callState !== 'active') setVoiceExtra((open) => open === 'text' ? null : open);
  }, [callState]);
  useEffect(() => {
    if (props.visualAttachment && callState === 'idle' && !voiceExpanded) setMode('text');
  }, [props.visualAttachment, callState, voiceExpanded]);
  const catalogSelectionLocked =
    busy || inCall || !!pendingSubmission || !!pendingVoiceSubmission || !!activeTurn;
  useEffect(() => {
    if (!catalog || catalogSelectionLocked) return;
    // Admission readiness depends on the actor loaded with the catalog. It must
    // never lock the initial default selection while that first read is pending.
    setModelId((old) =>
      catalog.models.some((item) => item.id === old && item.operations.includes('assistant-turn'))
        ? old
        : (catalog.models.find((item) => item.operations.includes('assistant-turn'))?.id ?? ''),
    );
    setVoiceId((old) =>
      catalog.models.some((item) => item.id === old && item.operations.includes('realtime-voice'))
        ? old
        : (catalog.models.find((item) => item.operations.includes('realtime-voice'))?.id ?? ''),
    );
  }, [catalog, catalogSelectionLocked]);
  const currentVoiceControls = useRef({ callState, muted, end: endVoice });
  currentVoiceControls.current = { callState, muted, end: endVoice };
  const toggleVoiceMute = useCallback(() => {
    const state = currentVoiceControls.current;
    if (!alive.current || voiceEnding.current || state.callState !== 'active' || !client.current)
      return;
    const next = !state.muted;
    // Keep two rapid clicks coherent before React commits the next render.
    state.muted = next;
    client.current.mute(next);
    setMuted(next);
  }, []);
  const endCurrentVoice = useCallback(() => {
    const state = currentVoiceControls.current;
    if (
      !alive.current ||
      voiceEnding.current ||
      (state.callState !== 'connecting' && state.callState !== 'active')
    )
      return;
    state.end();
  }, []);
  const activityReporter = useRef(props.onActivityChange);
  activityReporter.current = props.onActivityChange;
  useEffect(() => {
    props.onActivityChange?.({
      callActive: inCall,
      requestActive: busy,
      callState,
      muted: inCall && muted,
      callVisible: voiceVisible,
      onMute: toggleVoiceMute,
      onEnd: endCurrentVoice,
      onResume: showVoice,
    });
  }, [inCall, callState, muted, voiceVisible, busy, toggleVoiceMute, endCurrentVoice, showVoice, props.onActivityChange]);
  useEffect(() => () => activityReporter.current?.(IDLE_AI_ACTIVITY), []);
  useEffect(() => {
    if (props.visible === false) setOverlay(null);
  }, [props.visible]);
  useLayoutEffect(() => {
    const element = conversationBody.current;
    if (!element || props.visible === false || !element.clientHeight) return;
    if (!messages.length && !candidates.length && !workspace) {
      element.scrollTop = 0;
    } else if (followingConversation.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [messages, candidates, workspace, executionEvents, props.visible]);
  useEffect(() => {
    alive.current = true;
    if (!isLoggedIn || props.visible === false) return;
    const controller = new AbortController();
    let refreshing = false;
    let lastRead = -Infinity;
    async function refreshCatalog() {
      if (refreshing || controller.signal.aborted || document.visibilityState === 'hidden') return;
      if (Date.now() - lastRead < 15_000) return;
      refreshing = true;
      setCatalogError('');
      lastRead = Date.now();
      try {
        const [value, session] = await Promise.all([
          readModelCatalog<Catalog>('/assistant/models', controller.signal),
          readModelCatalog<Session>('/session', controller.signal),
        ]);
        if (controller.signal.aborted) return;
        setCatalog(value);
        setSpaces(session.spaces);
        setActorId(session.user?.id ?? null);
      } catch (err) {
        if (!controller.signal.aborted) setCatalogError(errorMessage(err));
      } finally {
        refreshing = false;
      }
    }
    void refreshCatalog();
    const refresh = () => void refreshCatalog();
    const interval = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [isLoggedIn, props.visible, catalogAttempt]);
  useEffect(() => {
    restoreSubmission();
  }, [actorId, isLoggedIn]);
  useEffect(() => {
    restoreVoiceSubmission();
    // Other tabs can update this browser's checkpoint. This is a local safety
    // barrier, not an atomic account-wide admission or billing authority.
    const changed = (event: StorageEvent) => {
      if (event.storageArea === localStorage) restoreVoiceSubmission();
    };
    window.addEventListener('storage', changed);
    window.addEventListener(VOICE_SUBMISSION_CHANGED, restoreVoiceSubmission);
    return () => {
      window.removeEventListener('storage', changed);
      window.removeEventListener(VOICE_SUBMISSION_CHANGED, restoreVoiceSubmission);
    };
  }, [actorId, isLoggedIn]);
  useEffect(() => {
    voiceEpoch.current++;
    voiceEnding.current = true;
    client.current?.end();
    client.current = null;
    turnAbort.current?.abort();
    turnAbort.current = null;
    requests.current.invalidate();
    searches.current.invalidate();
    searchAbort.current?.controller.abort();
    searchAbort.current = null;
    setBusy(false);
    setError('');
    setCallState('idle');
    setMuted(false);
    setShareImage(false);
    setAllowWebSearch(false);
    setPublicQuery('');
    setSecondPublicQuery('');
    setResearchLibrary('');
    setResearchCanvas(false);
    setResearchGraph(null);
    setExecutionEvents([]);
    setSettledTurn(null);
    setSubmittingTurn(false);
    setToolStatus('');
    setSharedRangeOpen(false);
    setPublicImages(false);
    setActiveTurn(null);
    setContextStatus('未共享画面');
    setSpaceIds(project ? [project.spaceId] : []);
    setReferenceIds([]);
    setResources([]);
    setParentTurnId(undefined);
    setConversationId(undefined);
    setConversations([]);
    setGrant(null);
    setContextManifest(null);
    setWorkspace(null);
    setMemorySuggestions({ items: [] });
    setCandidateHistoryStatus('');
    streamText.current.clear();
    freshConversation.current = false;
    setCreative(initialCreativeSettings());
    setMessages([]);
    setVoiceCaptions({});
    setCandidates([]);
    if (!isLoggedIn) {
      setCatalog(null);
      setSpaces([]);
      setActorId(null);
      submission.current = null;
      setPendingSubmission(null);
      voiceSubmission.current = null;
      setPendingVoiceSubmission(null);
      setPendingTeamVoiceSubmission(null);
      setVoiceSubmissionReady(false);
      setVoiceRecoveryError('');
    }
  }, [project?.id, project?.spaceId, isLoggedIn]);
  useEffect(() => {
    if (!isLoggedIn || !actorId || !project) return;
    const key = `${actorId}:${project.id}`;
    const cached = assistantDrafts.get(key);
    const saved = submission.current;
    setPrompt(
      saved?.projectId === project.id ? (saved.turnId ? '' : saved.prompt) : (cached?.prompt ?? ''),
    );
    if (cached) {
      setMode(props.visualAttachment ? 'text' : cached.mode);
      setConversationId(cached.conversationId);
      freshConversation.current = cached.conversationId === '';
    }
    return () => {
      assistantDrafts.set(key, textDraft.current);
      if (assistantDrafts.size > 20) assistantDrafts.delete(assistantDrafts.keys().next().value!);
    };
  }, [actorId, project?.id, isLoggedIn]);
  useEffect(() => {
    if (!pendingSubmission || pendingSubmission.projectId !== project?.id) return;
    if (!pendingSubmission.turnId) setPrompt((old) => old || pendingSubmission.prompt);
    const id = pendingSubmission.turnId
      ? `${pendingSubmission.turnId}-u`
      : `pending-${pendingSubmission.idempotencyKey}`;
    setMessages((old) =>
      old.some((message) => message.id === id)
        ? old
        : [...old, { id, role: 'user' as const, text: pendingSubmission.prompt }].slice(-60),
    );
  }, [pendingSubmission?.idempotencyKey, project?.id, requestScope]);
  useEffect(() => {
    const pending = searchAbort.current;
    if (pending && !searches.current.owns(pending.token)) {
      pending.controller.abort();
      searchAbort.current = null;
    }
    if (!resourceQuery.trim() || !project || !isLoggedIn || inCall || !spaceIds.length) return;
    const timer = setTimeout(() => void search(), 280);
    return () => clearTimeout(timer);
  }, [searchScope, inCall]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      if (!isLoggedIn || !project) return;
      try {
        const catalog = await api<{ conversations: typeof conversations }>(
          `/projects/${project.id}/assistant-conversations`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setConversations(catalog.conversations);
        if (conversationId === undefined) {
          setConversationId(catalog.conversations[0]?.id ?? '');
          return;
        }
        if (!conversationId) return;
        const [{ turns }, savedCandidates] = await Promise.all([
          api<{ turns: Turn[] }>(
            `/projects/${project.id}/assistant-turns?conversationId=${conversationId}`,
            {
              signal: controller.signal,
            },
          ),
          api<{ candidates: AssistantCandidate[] }>(
            `/projects/${project.id}/assistant-candidates?conversationId=${conversationId}`,
            { signal: controller.signal },
          ),
        ]);
        if (
          controller.signal.aborted ||
          !alive.current ||
          assistantScopeKey(editorState(current.current)) !== requestScope
        )
          return;
        for (const turn of turns) acknowledgeKnownTurn(turn);
        const complete = turns.filter((turn) => turn.state === 'completed');
        if (complete[0])
          setMemorySuggestions({
            items: complete[0].output?.memorySuggestions ?? [],
            sourceTurnId: complete[0].id,
          });
        if (complete[0]?.output?.workspace)
          setWorkspace({
            spec: complete[0].output.workspace,
            candidateIds: complete[0].output.candidates.map((item) => item.id),
          });
        if (!freshConversation.current) setParentTurnId((current) => current ?? complete[0]?.id);
        setMessages((old) => {
          const merged = new Map<string, Message>();
          for (const turn of [...turns].reverse()) {
            merged.set(`${turn.id}-u`, {
              id: `${turn.id}-u`,
              role: 'user',
              text: turn.prompt ?? '',
            });
            if (turn.state === 'running') continue;
            merged.set(turn.id, {
              id: turn.id,
              role: 'assistant',
              text: turn.state === 'completed' ? (turn.output?.text ?? '') : '',
              reasoningSummary: turn.output?.reasoningSummary,
              appStatus: turn.state === 'completed' ? undefined : turnStatus(turn),
              citations: turn.output?.citations,
              search: turn.output?.search,
            });
          }
          for (const message of old) if (!merged.has(message.id)) merged.set(message.id, message);
          return [...merged.values()].slice(-60);
        });
        setCandidates((old) => {
          const merged = new Map(old.map((item) => [item.id, item]));
          for (const candidate of savedCandidates.candidates) merged.set(candidate.id, candidate);
          return [...merged.values()].slice(0, 50);
        });
        const running = turns.find((turn) => turn.state === 'running');
        if (running && !requests.current.busy) {
          if (running.modelId) setModelId(running.modelId);
          const token = requests.current.begin();
          if (token) {
            setSettledTurn(null);
            streamText.current.delete(running.id);
            setActiveTurn({ id: running.id, stopping: running.stopRequested === true });
            setBusy(true);
            void observeRunningTurn(running.id, token, controller)
              .then((result) => {
                if (requestIsActive(token)) {
                  acknowledgeKnownTurn(result);
                  setSettledTurn({ id: result.id, state: result.state });
                  if (result.state === 'completed') setParentTurnId(result.id);
                  setHistoryEpoch((old) => old + 1);
                }
              })
              .catch((error) => {
                if (!controller.signal.aborted && requestIsActive(token))
                  setError(errorMessage(error));
              })
              .finally(() => {
                if (requests.current.finish(token) && alive.current) {
                  setBusy(false);
                  setActiveTurn(null);
                }
              });
          }
        }
        if (running) timer = setTimeout(() => void load(), 1500);
      } catch (err) {
        if (
          !controller.signal.aborted &&
          alive.current &&
          assistantScopeKey(editorState(current.current)) === requestScope
        )
          setError(errorMessage(err));
      }
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [project?.id, isLoggedIn, historyEpoch, conversationId]);
  useEffect(
    () => () => {
      alive.current = false;
      voiceEpoch.current++;
      voiceEnding.current = true;
      requests.current.invalidate();
      searches.current.invalidate();
      searchAbort.current?.controller.abort();
      turnAbort.current?.abort();
      client.current?.end();
    },
    [],
  );
  useEffect(() => {
    if (callState !== 'active') return;
    const interval = setInterval(() => setElapsed((old) => old + 1), 1000);
    return () => clearInterval(interval);
  }, [callState]);
  const getContext = async (): Promise<AssistantContext | undefined> => {
    const value = current.current;
    if (!value.artwork || !value.project) return undefined;
    if (shareImage) {
      if (!value.captureCurrentImage) throw new Error('当前画面尚未渲染完成，请稍后再共享。');
      return value.captureCurrentImage();
    }
    return {
      artworkId: value.artwork.id,
      assetId: value.artwork.assetId,
      expectedVersion: value.artwork.headVersion,
      recipe: parseEditorRecipe(value.recipe),
    };
  };
  const recipeSnapshot = JSON.stringify(recipe);
  const [contextRetry, setContextRetry] = useState(0);
  const lastContextRetryKey = useRef('');
  useEffect(() => {
    if (callState !== 'active') return;
    const epoch = voiceEpoch.current,
      voiceClient = client.current,
      baseline = assistantEditorKey(editorState(current.current));
    if (
      artwork &&
      voiceCanvas.current.accepted === baseline &&
      voiceCanvas.current.shared === shareImage &&
      !voiceCanvas.current.pending
    )
      return;
    if (voiceCanvas.current.accepted || voiceCanvas.current.pending) {
      voiceCanvas.current = { accepted: '' };
      voiceClient?.send({ type: 'context.invalidate' });
    }
    setContextStatus(artwork ? '画布已变化，等待同步' : '没有共享中的作品');
    if (!artwork) return;
    let cancelled = false;
    const active = () =>
      !cancelled &&
      alive.current &&
      !voiceEnding.current &&
      epoch === voiceEpoch.current &&
      voiceClient === client.current &&
      assistantEditorKey(editorState(current.current)) === baseline;
    let timer: ReturnType<typeof setTimeout>;
    function updateCanvas(attempt = 0) {
      if (!active()) return;
      void getContext()
        .then((context) => {
          if (context && active()) {
            const tag = secureUuid();
            voiceCanvas.current.pending = { key: baseline, tag, shared: shareImage };
            lastVoiceContextSend.current = performance.now();
            voiceClient?.updateContext(context, tag);
            setContextStatus(shareImage ? '正在更新画面…' : '正在更新参数…');
          }
        })
        .catch((err) => {
          if (!active()) return;
          if (attempt < 12) timer = setTimeout(() => updateCanvas(attempt + 1), 250);
          else setContextStatus(errorMessage(err));
        });
    }
    timer = setTimeout(
      updateCanvas,
      Math.max(420, 2650 - (performance.now() - lastVoiceContextSend.current)),
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    recipeSnapshot,
    callState,
    shareImage,
    artwork?.id,
    artwork?.assetId,
    artwork?.headVersion,
    requestScope,
    contextRetry,
  ]);
  const scope = {
    spaceIds,
    referenceAssetIds: referenceIds,
    allowWebSearch: allowWebSearch && Boolean(selected?.webSearch),
    ...(allowWebSearch && selected?.webSearch && publicQuery.trim()
      ? {
          publicSearch: {
            query: publicQuery.trim(),
            kind: publicImages && selected.webImageSearch ? 'images' : 'text',
          },
        }
      : {}),
    usePersonalMemory: memory,
    creativeBrief: creative.brief,
    ...(grant ? { executionGrantId: grant.id } : {}),
  };
  async function authorize() {
    if (!project || !modelId) throw new Error('请先选择项目和思考模型');
    const scopeKey = requestScope;
    const result = await api<{ grant: AssistantGrant }>(
      `/projects/${project.id}/assistant-grants`,
      jsonRequest('POST', {
        mode: creative.mode,
        unitLimit: creative.unitLimit,
        stepLimit: creative.stepLimit,
        minutes: 30,
        allowedActions:
          creative.mode === 'suggest'
            ? ['assistant-turn', 'realtime-voice']
            : ['assistant-turn', 'realtime-voice', 'edit', 'generate-image'],
        modelIds: [...new Set([modelId, voiceId, ...props.imageModelIds].filter(Boolean))],
      }),
    );
    if (!alive.current || assistantScopeKey(editorState(current.current)) !== scopeKey) return null;
    activeGrant.current = result.grant;
    setGrant(result.grant);
    return result.grant;
  }
  async function requestScopeWithGrant() {
    let currentGrant = activeGrant.current;
    if (
      !currentGrant ||
      currentGrant.revokedAt ||
      new Date(currentGrant.expiresAt).getTime() <= Date.now()
    ) {
      if (creative.mode === 'auto') throw new Error('请先明确授权自动执行的范围与预算');
      currentGrant = await authorize();
    }
    if (!currentGrant) throw new Error('项目已切换，请重新发送');
    return { ...scope, executionGrantId: currentGrant.id };
  }
  async function refreshGrant() {
    const id = activeGrant.current?.id;
    if (!id) return;
    try {
      const result = await api<{ grant: AssistantGrant }>(`/assistant-grants/${id}`);
      if (alive.current && activeGrant.current?.id === id) setGrant(result.grant);
    } catch {
      /* Task results remain visible if a usage refresh is temporarily unavailable. */
    }
  }
  async function revokeGrant() {
    const id = activeGrant.current?.id;
    if (!id) return;
    if (inCall) endVoice();
    try {
      await api(`/assistant-grants/${id}`, jsonRequest('DELETE', {}));
      if (activeGrant.current?.id === id) {
        activeGrant.current = null;
        setGrant(null);
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  async function explicitAuthorize() {
    const token = requests.current.begin();
    if (!token) return;
    setBusy(true);
    try {
      await authorize();
    } catch (err) {
      if (requestIsActive(token)) setError(errorMessage(err));
    } finally {
      if (requests.current.finish(token) && alive.current) setBusy(false);
    }
  }
  function receive(event: VoiceServerEvent) {
    if (!alive.current) return;
    if (voiceEnding.current && event.type !== 'closed' && event.type !== 'error') return;
    if (event.type === 'ready') {
      setCallState('active');
      setElapsed(0);
      setVoiceSearchRemaining(event.maxPublicSearches ?? 1);
      setContextStatus(translating ? '正在同传' : nativeMode ? '使用本轮语音与文字' :
        shareImage ? '当前画面已共享，调整后会更新' : '仅共享参数，未发送画面');
    }
    if (event.type === 'closed') {
      setCallState('idle');
      setMuted(false);
      setToolStatus('');
      if (event.state === 'unknown')
        setError('通话已停止，供应商最终状态待核验；系统不会自动重拨或重复扣额。');
    }
    if (event.type === 'error') setError(event.message);
    if (event.type === 'delegated-result') setDelegatedResult({ kind: event.kind, text: event.text });
    if (event.type === 'search-started') setVoiceSearchRemaining((count) => Math.max(0, count - 1));
    if (event.type === 'context') {
      const pending = voiceCanvas.current.pending;
      if (
        pending &&
        pending.tag === event.contextTag &&
        pending.key === assistantEditorKey(editorState(current.current))
      ) {
        if (event.accepted) {
          voiceCanvas.current = { accepted: pending.key, shared: pending.shared };
          lastContextRetryKey.current = '';
          setContextStatus(event.imageShared ? '画面已更新' : '参数已更新');
        } else {
          voiceCanvas.current = { accepted: '' };
          if (event.reason === 'busy' && lastContextRetryKey.current !== pending.key) {
            lastContextRetryKey.current = pending.key;
            setContextRetry((attempt) => attempt + 1);
          }
          setContextStatus(event.reason === 'version'
            ? '作品版本已变化，正在等待同步'
            : '共享更新未确认，可重新选择当前预览');
        }
      }
    }
    if (event.type === 'tool')
      setToolStatus(
        event.state === 'running'
          ? {
              message: '正在协作：{tool}',
              params: {
                tool:
                  (
                    {
                      search_resources: '查找素材',
                      describe_editor: '读取编辑参数',
                      propose_edit: '准备参数候选',
                      propose_curve: '准备曲线',
                      draft_generation: '整理生图草案',
                      consult_editor: '分析当前需求',
                    } as Record<string, string>
                  )[event.name] ?? event.name,
              },
              labels: ['tool'],
            }
          : '',
      );
    if (event.type === 'transcript') setVoiceCaptions((old) => appendCaption(old, event));
    if (event.type === 'assistant-result') {
      const currentCanvas = current.current.artwork;
      if (
        event.canvas &&
        (!currentCanvas ||
          event.canvas.artworkId !== currentCanvas.id ||
          event.canvas.assetId !== currentCanvas.assetId ||
          event.canvas.expectedVersion !== currentCanvas.headVersion)
      )
        return;
      if (
        currentCanvas &&
        voiceCanvas.current.accepted !== assistantEditorKey(editorState(current.current))
      )
        return;
      setMemorySuggestions({ items: event.memorySuggestions ?? [] });
      setWorkspace(
        event.workspace
          ? { spec: event.workspace, candidateIds: event.candidates.map((item) => item.id) }
          : null,
      );
      const voiceSession = voiceEpoch.current;
      setMessages((old) =>
        [
          ...old,
          {
            id: secureUuid(),
            role: 'assistant' as const,
            text: event.text,
            citations: event.citations,
            search: event.search,
            voiceSession,
            candidateIds: event.candidates.map(({ id }) => id),
          },
        ].slice(-40),
      );
      setCandidates((old) => [...event.candidates, ...old].slice(0, 30));
      if (event.execution?.state === 'applied') {
        void Promise.resolve(current.current.onApplied(event.execution.artworkId)).catch(
          (failure) => setError(errorMessage(failure)),
        );
      }
    }
  }
  async function startVoice(recovery?: VoiceSubmission) {
    if (
      !isLoggedIn ||
      !actorId ||
      !project ||
      (!recovery && (!voiceId || !voiceBackendOk)) ||
      callState !== 'idle' ||
      !submissionReady ||
      !voiceSubmissionReady ||
      submission.current
    )
      return;
    try {
      // Re-read before starting: the panel may have been closed, or another tab
      // may have retained a request since this component last rendered.
      const saved = readVoiceSubmission(localStorage, actorId);
      const team = readTeamVoiceSubmission(localStorage, actorId);
      setPendingTeamVoiceSubmission(team);
      if (team) throw new Error('原团队 AI 邀请仍待确认，核验前不能创建新的个人 AI 通话。');
      voiceSubmission.current = saved;
      setPendingVoiceSubmission(saved);
      if (recovery) {
        if (
          saved?.idempotencyKey !== recovery.idempotencyKey ||
          saved.projectId !== project.id ||
          saved.actorId !== actorId
        )
          throw new Error('语音恢复记录已变化，请重新读取本机记录。');
        voiceSubmissionRequest(saved);
        recovery = saved;
      } else if (saved) {
        setError('上次通话的最终状态尚未确认，请先核对原通话。');
        return;
      }
    } catch (err) {
      setError(errorMessage(err));
      return;
    }
    const token = requests.current.begin();
    if (!token) return;
    const epoch = ++voiceEpoch.current;
    let prepared: VoiceSubmission | null = recovery ?? null;
    let dispatched = false;
    let settled = false;
    voiceEnding.current = false;
    setError('');
    // Recovery is also visible from text mode; the live controls must remain
    // reachable as soon as a preserved voice request starts connecting.
    setMode('voice');
    setVoiceCaptions({});
    setDelegatedResult(null);
    setExecutionEvents([]);
    setSettledTurn(null);
    setVoiceSearchRemaining(0);
    lastVoiceContextSend.current = -Infinity;
    lastContextRetryKey.current = '';
    setMuted(false);
    setCallState('connecting');
    const voiceIsActive = () =>
      alive.current &&
      epoch === voiceEpoch.current &&
      assistantScopeKey(editorState(current.current)) === token.scope;
    const checkpointFailure = (error: unknown) => {
      if (alive.current && actor.current === actorId) {
        setVoiceRecoveryError(errorMessage(error));
        setVoiceSubmissionReady(false);
      }
    };
    const voiceClient = new EditorVoiceClient(
      (event) => {
        // Settlement still belongs to this exact request after closing the panel
        // or switching projects. Do not lose an authoritative late close event.
        if (prepared && !settled && (event.type === 'ready' || event.type === 'closed')) {
          const next = voiceSubmissionEvent(prepared, event);
          if (next) {
            prepared = next;
            rememberVoiceSubmission(next);
          } else {
            resolveVoiceSubmission(prepared);
            settled = true;
          }
        }
        if (voiceIsActive()) receive(event);
      },
      (message) => {
        if (prepared && !settled) {
          prepared = Object.freeze({ ...prepared, state: 'unknown' });
          try {
            rememberVoiceSubmission(prepared);
          } catch (error) {
            checkpointFailure(error);
          }
        }
        if (voiceIsActive()) {
          voiceEnding.current = true;
          setError({
            message: '{reason} 原通话标识已保留，核验完成前不能创建新通话。',
            params: { reason: message },
            labels: ['reason'],
          });
          setCallState('idle');
        }
        voiceClient.end();
      },
      translating,
    );
    client.current = voiceClient;
    const baseline = assistantEditorKey(editorState(current.current));
    try {
      await voiceClient.prepareMicrophone();
      if (!requestIsActive(token) || epoch !== voiceEpoch.current) {
        voiceClient.dispose();
        return;
      }
      if (!prepared) {
        const context = translating || nativeMode ? undefined : await getContext();
        if (!requestIsActive(token) || epoch !== voiceEpoch.current) {
          voiceClient.dispose();
          return;
        }
        const authorizedScope = translating || nativeMode
          ? { spaceIds: [], referenceAssetIds: [], usePersonalMemory: false,
              allowWebSearch: actualDelegation?.type === 'responses' && allowWebSearch && Boolean(selected?.webSearch) }
          : await requestScopeWithGrant();
        if (!requestIsActive(token) || epoch !== voiceEpoch.current) {
          voiceClient.dispose();
          return;
        }
        if (assistantEditorKey(editorState(current.current)) !== baseline)
          throw new Error('准备期间画布已变化，请确认当前画面后重新通话。');
        prepared = freezeVoiceSubmission({
          actorId,
          projectId: project.id,
          projectTitle: project.title,
          editorKey: baseline,
          body: {
            idempotencyKey: secureUuid(),
            modelId: voiceId,
            ...(translating ? { translation: liveTranslation } : {
              backendModelId: actualDelegation?.type === 'decisions' ? OPENAI_DECISIONS_MODEL : modelId,
              ...(actualDelegation ? { delegation: actualDelegation } : {}),
            }),
            voice,
            context,
            scope: authorizedScope,
          },
        });
      }
      // Both first admission and explicit recovery use this exact frozen body.
      rememberVoiceSubmission(prepared);
      const request = voiceSubmissionRequest(prepared);
      dispatched = true;
      const session = await api<{ id: string; ticket: string; websocketPath: string }>(
        request.path,
        request.init,
      );
      // Retain admission even if the user left while the response was in flight.
      prepared = acceptVoiceSubmission(prepared, session);
      rememberVoiceSubmission(prepared);
      if (!requestIsActive(token) || epoch !== voiceEpoch.current) {
        voiceClient.dispose();
        return;
      }
      const admitted = JSON.parse(
        typeof request.init.body === 'string' ? request.init.body : '{}',
      ) as { context?: AssistantContext };
      voiceCanvas.current = {
        accepted: prepared.editorKey,
        shared: !!admitted.context?.imageDataUrl,
      };
      voiceClient.connect(session.websocketPath, session.ticket);
    } catch (err) {
      voiceClient.dispose();
      if (prepared && dispatched) {
        try {
          if (!recovery && isVoiceAdmissionRejected(err, false)) {
            resolveVoiceSubmission(prepared);
            settled = true;
          } else {
            prepared = Object.freeze({
              ...prepared,
              state:
                err instanceof ApiError && err.code === 'VOICE_ALREADY_PREPARED'
                  ? 'already-prepared'
                  : 'unknown',
            });
            rememberVoiceSubmission(prepared);
          }
        } catch (error) {
          checkpointFailure(error);
        }
      }
      if (requestIsActive(token) && epoch === voiceEpoch.current) {
        setCallState('idle');
        setError(voiceErrorMessage(err));
      }
    } finally {
      requests.current.finish(token);
    }
  }
  function endVoice() {
    voiceEnding.current = true;
    requests.current.invalidate();
    turnAbort.current?.abort();
    turnAbort.current = null;
    setBusy(false);
    setSubmittingTurn(false);
    if (callState === 'connecting') voiceEpoch.current++;
    setMuted(true);
    setCallState(callState === 'connecting' ? 'idle' : 'closing');
    client.current?.end();
  }
  function searchDuringCall() {
    const query = publicQuery.trim();
    if (
      callState !== 'active' ||
      !selected?.webSearch ||
      !allowWebSearch ||
      !query ||
      voiceSearchRemaining <= 0
    )
      return;
    setError('');
    client.current?.send({
      type: 'search',
      search: { query, kind: publicImages && selected.webImageSearch ? 'images' : 'text' },
    });
  }
  function ownsTurnObservation(owner: NonNullable<typeof turnObservation.current>) {
    return (
      turnObservation.current === owner &&
      turnAbort.current === owner.controller &&
      !owner.controller.signal.aborted &&
      requestIsActive(owner.token)
    );
  }
  async function observeRunningTurn(
    id: string,
    token: AssistantOperationToken,
    controller: AbortController,
  ) {
    // The observer owns both live submissions and running turns restored from history.
    // A run.stopping UI update never replaces this operation's identity.
    const owner = { id, token, controller };
    turnObservation.current = owner;
    turnAbort.current = controller;
    try {
      return await observeAssistantTurn<Turn>(id, controller.signal, (event) => {
        if (ownsTurnObservation(owner)) showRunEvent(event);
      });
    } finally {
      if (turnObservation.current === owner) {
        turnObservation.current = null;
        if (turnAbort.current === controller) turnAbort.current = null;
      }
    }
  }
  function showRunEvent(event: RunEvent) {
    setExecutionEvents((previous) => appendPublicExecutionEvent(previous, event));
    if (event.type === 'text.delta' && typeof event.payload.delta === 'string') {
      const text = (streamText.current.get(event.runId) ?? '') + event.payload.delta;
      streamText.current.set(event.runId, text);
      setMessages((old) =>
        [
          ...old.filter((item) => item.id !== event.runId),
          {
            ...old.find((item) => item.id === event.runId),
            id: event.runId,
            role: 'assistant' as const,
            text,
          },
        ].slice(-60),
      );
    } else if (event.type === 'search.results') {
      const parsed = assistantSearchEvidenceSchema.safeParse(event.payload);
      if (!parsed.success) return;
      const evidence = parsed.data;
      setMessages((old) => {
        const message = old.find((item) => item.id === event.runId);
        return [
          ...old.filter((item) => item.id !== event.runId),
          {
            id: event.runId,
            role: 'assistant' as const,
            text: message?.text ?? '',
            search: [...(message?.search ?? []), evidence].slice(-16),
          },
        ].slice(-60);
      });
    } else if (event.type === 'branch.changed') {
      const node = event.payload as AssistantBranchEvent;
      if (typeof node.id !== 'string' || !Array.isArray(node.dependsOn)) return;
      setResearchGraph((previous) => {
        const nodes = previous?.turnId === event.runId ? previous.nodes : [];
        const existing = nodes.findIndex((item) => item.id === node.id);
        return {
          turnId: event.runId,
          nodes:
            existing < 0
              ? [...nodes, node]
              : nodes.map((item, index) => (index === existing ? node : item)),
        };
      });
    } else if (event.type === 'run.stopping') {
      setActiveTurn({ id: event.runId, stopping: true });
    } else if (event.type === 'context.prepared') setContextManifest(event.payload);
  }
  async function submit() {
    // Sending returns the same draft to its conversation before local validation
    // or an asynchronous receipt can place feedback in the reading area.
    setComposerExpanded(false);
    if (
      requests.current.busy ||
      submission.current ||
      !submissionReady ||
      !actorId ||
      !isLoggedIn ||
      !project ||
      !prompt.trim() ||
      !modelId
    )
      return;
    const attachment = mode === 'text' ? props.visualAttachment : null;
    if (attachment && !selected?.imageInput) {
      setError(t('请选择支持图片的模型，或移除附件。'));
      return;
    }
    if (
      mode === 'text' &&
      allowWebSearch &&
      selected?.webSearch &&
      !publicQuery.trim() &&
      !inCall
    ) {
      setError('请填写可发送给公开搜索的查询词，或取消公开检索。');
      return;
    }
    const text = prompt.trim();
    setError('');
    setToolStatus('');
    setExecutionEvents([]);
    setSettledTurn(null);
    followingConversation.current = true;
    if (callState === 'active') {
      client.current?.send({ type: 'text', text });
      setPrompt('');
      const voiceSession = voiceEpoch.current;
      setMessages((old) =>
        [...old, { id: secureUuid(), role: 'user' as const, text, voiceSession }].slice(-40),
      );
      return;
    }
    const token = requests.current.begin();
    if (!token) return;
    setBusy(true);
    setSubmittingTurn(true);
    const controller = new AbortController();
    turnAbort.current = controller;
    const baseline = assistantEditorKey(editorState(current.current));
    let writePrepared = false;
    try {
      const context = await getContext();
      const research: AssistantResearchBranch[] = [];
      if (allowWebSearch && selected?.webSearch && secondPublicQuery.trim()) {
        if (secondPublicQuery.trim() === publicQuery.trim())
          throw new Error('第二项公开查询需要不同的内容。');
        research.push({
          kind: 'web',
          query: secondPublicQuery.trim(),
          resultKind: publicImages && selected.webImageSearch ? 'images' : 'text',
        });
      }
      if (researchLibrary.trim() && spaceIds.length)
        research.push({ kind: 'cloud', query: researchLibrary.trim(), limit: 8 });
      if (researchCanvas && shareImage && selected?.imageInput) {
        if (!context?.imageDataUrl) throw new Error('请准备好当前图片后再检查画面。');
        research.push({ kind: 'canvas' });
      }
      if (!requestIsActive(token) || controller.signal.aborted) return;
      const authorizedScope = await requestScopeWithGrant();
      if (!requestIsActive(token) || controller.signal.aborted) return;
      if (creative.mode === 'auto') {
        await props.onBeforeArtworkWrite?.();
        writePrepared = true;
      }
      if (!requestIsActive(token) || controller.signal.aborted) return;
      if (assistantEditorKey(editorState(current.current)) !== baseline)
        throw new Error('准备期间画布已变化，请确认当前画面后重新发送。');
      const frozen = freezeAssistantSubmission({
        actorId,
        projectId: project.id,
        projectTitle: project.title,
        editorKey: baseline,
        automatic: creative.mode === 'auto',
        body: {
          idempotencyKey: secureUuid(),
          modelId,
          prompt: text,
          context,
          ...(attachment ? { visualAttachment: attachment } : {}),
          scope: authorizedScope,
          parentTurnId,
          ...(research.length ? { research } : {}),
          ...(Object.keys(activeTuning).length ? { responseTuning: activeTuning } : {}),
        },
      });
      // A storage failure stops before dispatch, so closing/reopening this panel cannot
      // discard an uncertain paid request and accidentally create a different key.
      rememberSubmission(frozen);
      if (attachment) submittedVisual.current = { key: frozen.idempotencyKey, attachment };
      setMessages((old) => [...old, {
        id: `pending-${frozen.idempotencyKey}`,
        role: 'user' as const,
        text,
        attachmentKind: attachment?.kind,
      }].slice(-60));
      await runSubmission(frozen, token, controller, true);
    } catch (err) {
      if (!controller.signal.aborted && requestIsActive(token)) setError(errorMessage(err));
    } finally {
      await finishSubmission(token, controller, writePrepared);
    }
  }
  async function recoverSubmission() {
    let saved: AssistantSubmission | null;
    try {
      saved = actorId ? readAssistantSubmission(sessionStorage, actorId) : null;
    } catch (err) {
      setError(errorMessage(err));
      return;
    }
    if (
      !saved ||
      !submissionReady ||
      saved.actorId !== actorId ||
      saved.projectId !== project?.id ||
      !isLoggedIn ||
      inCall
    )
      return;
    const token = requests.current.begin();
    if (!token) return;
    const controller = new AbortController();
    turnAbort.current = controller;
    setBusy(true);
    setSubmittingTurn(true);
    setSettledTurn(null);
    setExecutionEvents([]);
    followingConversation.current = true;
    setError('');
    let writePrepared = false;
    try {
      if (saved.automatic && !saved.turnId) {
        await props.onBeforeArtworkWrite?.();
        writePrepared = true;
      }
      if (!requestIsActive(token) || controller.signal.aborted) return;
      // This explicit user action reuses the entire frozen body. Once an id is known,
      // runSubmission uses GET/SSE only, including after an unknown provider result.
      await runSubmission(saved, token, controller);
    } catch (err) {
      if (!controller.signal.aborted && requestIsActive(token)) setError(errorMessage(err));
    } finally {
      await finishSubmission(token, controller, writePrepared);
    }
  }
  async function runSubmission(
    saved: AssistantSubmission,
    token: AssistantOperationToken,
    controller: AbortController,
    firstAttempt = false,
  ) {
    let result: Turn;
    try {
      const request = assistantSubmissionRequest(saved);
      result = await api<Turn>(request.path, { ...request.init, signal: controller.signal });
    } catch (err) {
      if (!saved.turnId && isAssistantAdmissionRejected(err, !firstAttempt)) {
        resolveSubmission(saved);
        if (requestIsActive(token))
          setMessages((old) =>
            old.filter((message) => message.id !== `pending-${saved.idempotencyKey}`),
          );
      }
      throw err;
    }
    let accepted = acceptAssistantSubmission(saved, result);
    rememberSubmission(accepted);
    const attachment = submittedVisual.current?.key === saved.idempotencyKey
      ? submittedVisual.current.attachment
      : undefined;
    if (attachment) {
      submittedVisual.current = null;
      current.current.onClearVisualAttachment?.(attachment);
    }
    const draftKey = `${saved.actorId}:${saved.projectId}`;
    const cached = assistantDrafts.get(draftKey);
    if (cached?.prompt.trim() === saved.prompt)
      assistantDrafts.set(draftKey, { ...cached, prompt: '' });
    if (textDraft.current.prompt.trim() === saved.prompt)
      textDraft.current = { ...textDraft.current, prompt: '' };
    if (!requestIsActive(token) || controller.signal.aborted) return;
    setPrompt((old) => (old.trim() === saved.prompt ? '' : old));
    setMessages((old) => {
      const id = `${result.id}-u`;
      const remaining = old.filter(
        (message) => message.id !== `pending-${saved.idempotencyKey}` && message.id !== id,
      );
      return [
        ...remaining,
        { id, role: 'user' as const, text: saved.prompt, attachmentKind: attachment?.kind },
      ].slice(-60);
    });
    if (result.state === 'running') {
      setActiveTurn({ id: result.id, stopping: result.stopRequested === true });
      result = await observeRunningTurn(result.id, token, controller);
    }
    accepted = acceptAssistantSubmission(accepted, result);
    rememberSubmission(accepted);
    if (assistantSubmissionResolved(result.state)) resolveSubmission(accepted);
    if (controller.signal.aborted || !requestIsActive(token)) return;
    setActiveTurn(null);
    setSettledTurn({ id: result.id, state: result.state });
    if (result.state === 'completed' && result.output) {
      setMemorySuggestions({
        items: result.output.memorySuggestions ?? [],
        sourceTurnId: result.id,
      });
      setWorkspace(
        result.output.workspace
          ? {
              spec: result.output.workspace,
              candidateIds: result.output.candidates.map((item) => item.id),
            }
          : null,
      );
      streamText.current.delete(result.id);
      freshConversation.current = false;
      setParentTurnId(result.id);
      setConversationId(result.conversationId);
      setMessages((old) =>
        [
          ...old.filter((message) => message.id !== result.id),
          {
            id: result.id,
            role: 'assistant' as const,
            text: result.output!.text,
            reasoningSummary: result.output!.reasoningSummary,
            citations: result.output!.citations,
            search: result.output!.search,
          },
        ].slice(-40),
      );
      setCandidates((old) => [...result.output!.candidates, ...old].slice(0, 30));
      if (result.output.execution?.state === 'applied') {
        if (
          result.output.execution.artworkId &&
          result.output.execution.artworkId === current.current.artwork?.id
        )
          await props.onApplied(result.output.execution.artworkId);
        setToolStatus('已自动保存新版本，可在历史中对比和恢复');
      } else if (result.output.execution) {
        const code = result.output.execution.code;
        setError(
          code === 'ALTERNATIVE_CANDIDATES'
            ? '本轮提出了多个备选方案，请选择预览后继续。'
            : code === 'CANDIDATE_REVIEW_REQUIRED'
              ? '本轮尚未完成对候选画面的检查，已保留方案，请预览确认。'
              : code === 'NATIVE_PIXEL_CHECK_REQUIRED'
                ? '局部方案尚未通过原尺寸检查，已保留候选。可共享画面后重新检查，或先在画布预览。'
                : code === 'MODEL_TURN_INCOMPLETE'
                  ? '模型未完成本轮核对，候选保留供查看。'
                  : code === 'AUTOMATIC_UNSAVED_BASE'
                    ? '本轮基于未保存参数，已保留候选，请先预览确认。'
                    : {
                        message: '自动修改已停止，候选已保留，请检查版本、占用或授权后继续。{code}',
                        params: { code: code ?? '' },
                      },
        );
      }
    } else {
      streamText.current.delete(result.id);
      setMessages((old) => old.filter((item) => item.id !== result.id));
      setConversationId(result.conversationId);
      setHistoryEpoch((old) => old + 1);
      setError(turnStatus(result));
    }
  }
  async function finishSubmission(
    token: AssistantOperationToken,
    controller: AbortController,
    writePrepared: boolean,
  ) {
    if (writePrepared) {
      try {
        await props.onAfterArtworkWrite?.();
      } catch (err) {
        if (alive.current && requestIsActive(token)) setError(errorMessage(err));
      }
    }
    if (requests.current.finish(token) && alive.current) {
      setBusy(false);
      setSubmittingTurn(false);
      setActiveTurn(null);
    }
    if (turnAbort.current === controller) turnAbort.current = null;
    void refreshGrant();
  }
  function refreshHistory() {
    if (pendingSubmission && !pendingSubmission.turnId) {
      freshConversation.current = false;
      setConversationId(undefined);
    }
    setHistoryEpoch((old) => old + 1);
  }
  async function loadProjectCandidates() {
    if (!project || !isLoggedIn || inCall) return;
    const token = requests.current.begin();
    if (!token) return;
    setBusy(true);
    setCandidateHistoryStatus('正在读取项目候选…');
    try {
      const result = await api<{ candidates: AssistantCandidate[] }>(
        `/projects/${project.id}/assistant-candidates`,
      );
      if (!requestIsActive(token)) return;
      setCandidates((old) => {
        const merged = new Map(old.map((item) => [item.id, item]));
        for (const candidate of result.candidates) merged.set(candidate.id, candidate);
        return [...merged.values()].slice(-50);
      });
      const actionable = result.candidates.filter(
        (item) =>
          item.decision === 'pending' || (item.decision === 'previewed' && !item.appliedRevisionId),
      ).length;
      setCandidateHistoryStatus(
        actionable
          ? {
              message: '已读取 {count} 个可继续处理的候选，包含项目内的文字与语音协作。',
              params: { count: actionable },
            }
          : '项目最近的有效候选中，暂无需要处理的方案。',
      );
    } catch (err) {
      if (requestIsActive(token)) setCandidateHistoryStatus(errorMessage(err));
    } finally {
      if (requests.current.finish(token) && alive.current) setBusy(false);
    }
  }
  async function decide(
    candidate: AssistantCandidate,
    decision: 'previewed' | 'rejected',
    automatic = false,
  ) {
    if (!isLoggedIn || !project || submission.current) return;
    const token = requests.current.begin();
    if (!token) return;
    setError('');
    setBusy(true);
    let appliedRevisionId: string | undefined;
    try {
      if (decision === 'previewed' && candidate.kind === 'edit') {
        if (automatic) await props.onBeforeArtworkWrite?.();
        let savedId: string | undefined;
        const applied = await acknowledgeEditCandidate(candidate, {
          readCurrent: () => editorState(current.current),
          isActive: () => requestIsActive(token),
          acknowledge: async (body) => {
            if (!automatic)
              return api(
                `/assistant-candidates/${candidate.id}/decision`,
                jsonRequest('POST', body),
              );
            const result = await api<{ artworkId: string; revisionId: string }>(
              `/assistant-candidates/${candidate.id}/apply`,
              jsonRequest('POST', { recipe: body.recipe, expectedVersion: body.expectedVersion }),
            );
            savedId = result.artworkId;
            appliedRevisionId = result.revisionId;
            return result;
          },
          apply: (next) => {
            if (!automatic) {
              if (voiceVisible) dismissVoice();
              current.current.onPreview(next);
              setPreviewCandidateId(candidate.id);
            }
          },
        });
        if (!applied) return;
        if (typeof applied === 'object') {
          savedId = applied.artworkId;
          appliedRevisionId = applied.revisionId;
        }
        if (savedId) {
          await current.current.onApplied(savedId);
          if (!requestIsActive(token)) return;
          setToolStatus(
            automatic
              ? '已自动保存新版本，可在历史中对比和恢复'
              : '这份候选已在云端保存，未再次预览；本地未保存的草稿继续保留，可从版本历史核对。',
          );
        }
      } else {
        let commit: (() => void) | null = null;
        if (decision === 'previewed') {
          commit = await onPrepareGenerationDraft({
            executionGrantId: candidate.executionGrantId,
            candidateId: candidate.id,
            prompt: candidate.prompt ?? '',
            referenceAssetIds: candidate.referenceAssetIds ?? [],
          });
          if (!commit || !requestIsActive(token)) return;
        }
        await api(
          `/assistant-candidates/${candidate.id}/decision`,
          jsonRequest('POST', { decision }),
        );
        if (!requestIsActive(token)) return;
        commit?.();
      }
      if (!requestIsActive(token)) return;
      setCandidates((old) =>
        old.map((item) =>
          item.id === candidate.id
            ? { ...item, decision, ...(appliedRevisionId ? { appliedRevisionId } : {}) }
            : item,
        ),
      );
    } catch (err) {
      if (requestIsActive(token)) setError(errorMessage(err));
    } finally {
      requests.current.finish(token);
      try {
        if (automatic) await props.onAfterArtworkWrite?.();
      } catch (err) {
        if (alive.current) setError(errorMessage(err));
      }
      if (alive.current) setBusy(false);
      void refreshGrant();
    }
  }
  const autoAttempted = useRef(new Set<string>());
  const workspaceReady =
    workspace && workspace.candidateIds.every((id) => candidates.some((item) => item.id === id));
  const workspaceCandidateIds = new Set(
    workspaceReady
      ? workspace.spec.sections.flatMap((section) =>
          section.type === 'candidates'
            ? section.candidateIndices.map((index) => workspace.candidateIds[index])
            : [],
        )
      : [],
  );
  const remainingCandidates = candidates.filter(
    (item) =>
      !workspaceCandidateIds.has(item.id) &&
      !confirmedCandidateIds.has(item.id) &&
      (item.decision === 'pending' || (item.decision === 'previewed' && !item.appliedRevisionId)),
  );
  useEffect(() => {
    if (
      creative.mode !== 'auto' ||
      !grant ||
      grant.revokedAt ||
      busy ||
      pendingSubmission ||
      requests.current.busy
    )
      return;
    const candidate = candidates.find(
      (item) =>
        item.kind === 'edit' &&
        item.autoEligible !== false &&
        item.executionManagedBy !== 'server' &&
        item.executionGrantId === grant.id &&
        item.decision === 'pending' &&
        !autoAttempted.current.has(item.id),
    );
    if (!candidate) return;
    autoAttempted.current.add(candidate.id);
    void decide(candidate, 'previewed', true);
  }, [candidates, creative.mode, grant, busy, pendingSubmission]);
  function cancelSearch() {
    searches.current.invalidate();
    searchAbort.current?.controller.abort();
    searchAbort.current = null;
    setResources([]);
    setSearchStatus('');
  }
  function toggleReference(id: string) {
    setReferenceIds((old) =>
      old.includes(id) ? old.filter((value) => value !== id) : old.length < 8 ? [...old, id] : old,
    );
  }
  async function stopActiveTurn() {
    const observer = turnObservation.current;
    if (
      !activeTurn ||
      activeTurn.stopping ||
      !observer ||
      observer.id !== activeTurn.id ||
      !ownsTurnObservation(observer)
    )
      return;
    const id = activeTurn.id;
    const scope = requestScope;
    setActiveTurn({ id, stopping: true });
    try {
      const result = await api<{ state: string; stopRequested: boolean }>(
        `/assistant-turns/${id}/stop`,
        jsonRequest('POST', {}),
      );
      if (
        alive.current &&
        assistantScopeKey(editorState(current.current)) === scope &&
        ownsTurnObservation(observer) &&
        !result.stopRequested
      )
        setActiveTurn((value) => (value?.id === id ? { id, stopping: false } : value));
    } catch (error) {
      if (
        alive.current &&
        assistantScopeKey(editorState(current.current)) === scope &&
        ownsTurnObservation(observer)
      ) {
        setError(errorMessage(error));
        setActiveTurn((value) => (value?.id === id ? { id, stopping: false } : value));
      }
    }
  }
  async function search() {
    if (!isLoggedIn || !project || inCall || !spaceIds.length) return;
    searchAbort.current?.controller.abort();
    const token = searches.current.beginLatest(),
      controller = new AbortController();
    searchAbort.current = { token, controller };
    setSearchStatus('正在检索授权空间…');
    try {
      const result = await api<{ resources: AssistantCloudResource[] }>(
        `/projects/${project.id}/assistant-resources/search`,
        {
          ...jsonRequest('POST', { spaceIds, query: resourceQuery.trim(), limit: 20 }),
          signal: controller.signal,
        },
      );
      if (!searchIsActive(token) || controller.signal.aborted) return;
      setResources(result.resources);
      setSearchStatus(
        result.resources.length
          ? { message: '显示 {count} 张图片', params: { count: result.resources.length } }
          : '当前范围内没有匹配图片',
      );
    } catch (err) {
      if (searchIsActive(token) && !controller.signal.aborted) setSearchStatus(errorMessage(err));
    } finally {
      searches.current.finish(token);
      if (searchAbort.current?.controller === controller) searchAbort.current = null;
    }
  }
  function newConversation() {
    freshConversation.current = true;
    setConversationId('');
    setParentTurnId(undefined);
    setMessages([]);
    setCandidates([]);
    setContextManifest(null);
    setResearchGraph(null);
    setExecutionEvents([]);
    setSettledTurn(null);
    setToolStatus('');
    setWorkspace(null);
    setMemorySuggestions({ items: [] });
    followingConversation.current = true;
    setOverlay(null);
  }
  const canSend =
    !busy &&
    !submissionBlocked &&
    !!prompt.trim() &&
    !!project &&
    !!catalog?.ready &&
    !!selected &&
    (mode !== 'text' || !props.visualAttachment || selected.imageInput) &&
    (!inCall || callState === 'active');
  const hasVoiceRecovery =
    !inCall && (!!pendingVoiceSubmission || !!pendingTeamVoiceSubmission || !!voiceRecoveryError);
  // The matching live observer already exposes progress and stop. Its checkpoint
  // still blocks new submissions; uncertain or unobserved requests keep recovery visible.
  const observingCurrentSubmission =
    busy &&
    activeTurn !== null &&
    pendingSubmission?.state === 'running' &&
    pendingSubmission.actorId === actorId &&
    pendingSubmission.projectId === project?.id &&
    activeTurn.id === pendingSubmission.turnId;
  const recoveryLabel =
    pendingSubmission && !observingCurrentSubmission &&
      !(submittingTurn && pendingSubmission.state === 'unconfirmed' && pendingSubmission.projectId === project?.id)
      ? pendingSubmission.state === 'unknown'
        ? '本轮结果待核验，发送已暂停'
        : busy
          ? '正在处理本轮请求'
          : '本轮请求已保留，请先核对结果'
      : hasVoiceRecovery
        ? '语音结果待确认，暂停发起新通话'
        : '';
  const composerExpansionBlocked =
    busy || !!activeTurn || inCall || submissionBlocked || !!recoveryLabel;
  useLayoutEffect(() => {
    // New results and errors must never arrive inside a hidden conversation.
    // Ordinary, unsent drafting can still be expanded again once it is safe.
    if (composerExpansionBlocked || error) setComposerExpanded(false);
  }, [composerExpansionBlocked, activeTurn?.id, error, recoveryLabel]);
  useLayoutEffect(() => {
    if (composerExpanded || props.visible === false || (!error && !recoveryLabel)) return;
    const body = conversationBody.current;
    const notice = body?.querySelector(
      error ? ':scope > .assistant-error' : ':scope > .ai-pending-strip',
    );
    if (!body?.clientHeight || !notice) return;
    // Reveal feedback by scrolling only its own conversation, never the panel
    // or the image workspace behind it.
    body.scrollTop += notice.getBoundingClientRect().top - body.getBoundingClientRect().top;
  }, [error, recoveryLabel, composerExpanded, props.visible]);
  const executionLabel = { suggest: '只建议', confirm: '预览确认', auto: '预算内自动执行' }[
    creative.mode
  ];
  const researchTurnId = activeTurn?.id ?? researchGraph?.turnId ?? parentTurnId;
  const canStartVoice = !inCall && !busy && !submissionBlocked && voiceSubmissionReady &&
    !pendingVoiceSubmission && !pendingTeamVoiceSubmission && catalog?.voiceReady &&
    !!project && voiceBackendOk && !!selectedVoice && (!grant || (!nativeMode && !translating));
  const voiceMessages = messages.filter((message) => message.voiceSession === voiceEpoch.current);
  const voiceCandidateIds = new Set(voiceMessages.flatMap((message) => message.candidateIds ?? []));
  const hasVoiceResults = voiceMessages.length > 0 || !!delegatedResult;
  const voiceAction = t(muted ? '开启麦克风' : '静音麦克风');
  const voiceHeading = callState === 'active'
    ? t(muted ? '已静音' : '通话中')
    : t(callState === 'connecting' ? '连接中' : callState === 'closing' ? '正在结束'
      : '实时语音');
  const voiceTime = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
  const hasVoiceCaptions = !!(voiceCaptions.user?.text || voiceCaptions.assistant?.text);
  const voiceSearchAvailable = callState === 'active' && !translating && !nativeMode &&
    allowWebSearch && selected?.webSearch;
  const voiceTools = (
    <IconButton ref={voiceToolsTrigger} className="voice-more" label={t('通话工具')}
      aria-expanded={voiceToolsOpen} aria-controls={voiceToolsOpen ? voiceToolsId : undefined}
      data-has-results={hasVoiceResults && !voiceToolsOpen ? '' : undefined}
      onClick={() => {
        if (voiceToolsOpen) setVoiceExtra(null);
        setVoiceToolsOpen(!voiceToolsOpen);
      }}>
      <DotsThree size={19} weight="bold" />
    </IconButton>
  );
  const voicePanel = (
    <div className={`assistant-call ${callState}`} data-motion="ai-status">
      <div className="voice-workspace-orb" data-muted={muted}>
        <Suspense fallback={null}>
          <Strands
            className="voice-strands-orb"
            colors={voiceDark ? VOICE_STRANDS_DARK : VOICE_STRANDS_LIGHT}
            glassTint={voiceDark ? '#387f75' : '#ebd4a9'}
            lightMode={!voiceDark}
            speed={muted ? 0.16 : callState === 'active' ? 0.7 : 0.38}
            level={readVoiceLevel}
            energy={muted ? 0.40 : 0.64}
            refraction={0.72}
            dispersion={0.25}
            glassSize={1.13}
            glow={0.68}
            intro={false}
            clickPulse={false}
            maxDevicePixelRatio={1.5}
            pluck
          />
        </Suspense>
        {callState === 'connecting' && <span className="voice-orb-connecting" aria-hidden />}
      </div>
      <div className="voice-workspace-actions" role="group" aria-label={t('通话控制')}>
        <IconButton label={t('收起语音通话')} onClick={dismissVoice}><ArrowLeft size={17} /></IconButton>
        <div className="assistant-call-status">
          <span role="status">{voiceHeading}</span>
          {callState === 'active' && <time aria-label={t('通话时长')}>{voiceTime}</time>}
          {!inCall && catalog && (
            <small>{!project ? t('选择项目后开始对话') : !catalog.voiceReady ? t('语音服务暂不可用')
              : selectedVoice ? t('{v0} 服务点 · 最长 {v1} 秒', {
                v0: selectedVoice.unitCost, v1: selectedVoice.maxSeconds,
              }) : t('暂无语音模型')}</small>
          )}
        </div>
        {!inCall ? (
          <>
            {voiceTools}
            <button ref={voiceStartButton} type="button" className="voice-start-button"
              aria-label={t('开始实时通话')} aria-disabled={!canStartVoice}
              onClick={() => { if (canStartVoice) void startVoice(); }}>
              <Microphone size={17} /><span>{t('开始实时通话')}</span>
            </button>
          </>
        ) : (
          <div className="assistant-call-actions">
            {callState === 'active' && (
              <>
                <VoicePill className="voice-live-pill" size={34} reach={2} showTime={false} reactive="external"
                  background="var(--voice-control)" accentColor="var(--voice-accent)" iconColor="var(--voice-ink)"
                  externalDisplay externalActive={!muted} externalStream={client.current?.microphoneStream}
                  ariaLabel={voiceAction} ariaPressed={muted} slideToCancel={false}
                  onLevel={setVoiceLevel} onAction={toggleVoiceMute} />
                <IconButton label={t('打断播报')} onClick={() => client.current?.interrupt()}><Pause size={16} /></IconButton>
              </>
            )}
            {callState === 'active' && voiceTools}
            <IconButton className="end-call" label={t('结束实时通话')}
              disabled={callState === 'closing'} onClick={endCurrentVoice}><PhoneDisconnect size={17} /></IconButton>
          </div>
        )}
      </div>
    </div>
  );
  const voiceContextToggle = (
    <IconButton label={t('当前预览')}
      title={t(shareImage ? '移除当前预览' : '共享当前预览')}
      aria-pressed={shareImage} aria-describedby={inCall ? voiceContextId : undefined}
      disabled={translating || nativeMode || !artwork || !selected?.imageInput || busy || submissionBlocked ||
        callState === 'connecting' || callState === 'closing'}
      onClick={() => setShareImage((enabled) => !enabled)}>
      <ImageSquare size={17} />
    </IconButton>
  );
  const voiceSupplement = voiceSearchAvailable && (
    <MotionDetails className="assistant-voice-search">
      <summary>{t('通话中公开搜索')}</summary>
      <form
        className="assistant-public-query"
        onSubmit={(event) => {
          event.preventDefault();
          searchDuringCall();
        }}
      >
        <label>
          {t('可公开的查询词')}
          <input
            aria-label={t('通话公开检索查询词')}
            value={publicQuery}
            maxLength={240}
            onChange={(event) => setPublicQuery(event.target.value)}
            placeholder={t('例如：静物柔光参考')}
          />
        </label>
        {selected.webImageSearch && (
          <label>
            <input
              type="checkbox"
              checked={publicImages}
              onChange={(event) => setPublicImages(event.target.checked)}
            />
            {t('查找公开图片')}
          </label>
        )}
        <small>{t('也可说「公开搜索：关键词」。本通话最多一次公开搜索，只发送查询词。')}</small>
        <button
          type="submit"
          className="button button-secondary"
          disabled={!publicQuery.trim() || !!toolStatus || voiceSearchRemaining <= 0}
        >
          {voiceSearchRemaining ? t('搜索') : t('检索次数已用完')}
        </button>
      </form>
    </MotionDetails>
  );
  const showConversationEmpty =
    !messages.length && !remainingCandidates.length && mode === 'text' && !busy;
  const availabilityMessage = !project
    ? t('选择项目后开始对话')
    : !catalog?.ready
      ? t(catalog || catalogError ? '助手暂不可用' : '正在读取可用模型…')
      : null;
  const availabilityDetails =
    project && catalog && !catalog.ready && catalog.reason ? (
      <MotionDetails className="ai-availability-details">
        <summary>{t('查看原因')}</summary>
        <p>{t(catalog.reason)}</p>
      </MotionDetails>
    ) : null;
  const turnId = activeTurn?.id ?? settledTurn?.id;
  const turnEvents = executionEvents.filter((event) => event.runId === turnId);
  const latestToolEvent = [...turnEvents].reverse().find((event) => event.label !== '本轮执行');
  const streaming = Boolean(activeTurn && messages.some((message) => message.id === activeTurn.id && message.text));
  const waitingForReply = Boolean(activeTurn && !activeTurn.stopping && !streaming && !turnEvents.length);
  const sending = submittingTurn && !activeTurn && !settledTurn;
  const activeMessageId = turnId
    ? `${turnId}-u`
    : pendingSubmission?.projectId === project?.id && pendingSubmission
      ? `pending-${pendingSubmission.idempotencyKey}`
      : null;
  const terminalState = settledTurn?.state;
  const executionState = activeTurn
    ? activeTurn.stopping ? 'pending' : 'running'
    : terminalState === 'completed' ? 'done'
      : terminalState === 'stopped' ? 'cancelled'
        : terminalState === 'unknown' ? 'unknown' : 'failed';
  const doneLabel = executionState === 'done' ? t('本轮执行已完成')
    : executionState === 'cancelled' ? t('已停止')
      : executionState === 'unknown' ? t('结果待核验') : t('本轮执行未完成');
  const progressLabel = activeTurn?.stopping ? t('已收到停止请求，正在核对已发送的请求')
    : latestToolEvent?.state === 'running' ? t(latestToolEvent.label)
      : streaming ? t('正在输出回复') : t('正在处理本轮请求');
  const turnProgress = sending || waitingForReply ? (
    <AssistantActivity label={t(waitingForReply ? '等待助手回复' : pendingSubmission ? '正在发送' : '正在准备本轮请求')} />
  ) : turnId ? (
    <ExecutionStatus label={progressLabel} doneLabel={doneLabel} state={executionState} events={turnEvents} />
  ) : busy && !inCall ? <AssistantActivity label={t('正在处理…')} /> : null;

  function renderMessages(entries: Message[], showTurnProgress = false) {
    const anchor = showTurnProgress ? entries.find((message) => message.id === activeMessageId) : null;
    return (
      <div className="assistant-messages" aria-label={t('协作对话')} data-motion="ai-answer">
        {entries.flatMap((message) => {
          const isStreaming = message.id === activeTurn?.id && !!message.text;
          const article = (
            <article key={message.id} className={`assistant-message ${message.role}`}
            data-streaming={isStreaming || undefined} aria-busy={isStreaming || undefined}>
            <small>{message.role === 'user' ? t('你') : t('创作助手')}</small>
            {message.attachmentKind && (
              <span className="ai-sent-attachment">
                <Paperclip size={13} /> {visualAttachmentLabel(message.attachmentKind)}
              </span>
            )}
            {message.text &&
              (message.role === 'assistant' ? (
                <AssistantText text={message.text} />
              ) : (
                <p>{message.text}</p>
              ))}
            {message.appStatus && <p>{renderStatus(message.appStatus)}</p>}
            {message.reasoningSummary && (
              <details>
                <summary>{t('模型推理摘要')}</summary>
                <AssistantText text={message.reasoningSummary} />
              </details>
            )}
            {!!message.search?.length && (
              <SearchEvidence
                evidence={message.search}
                selected={referenceIds}
                disabled={inCall || busy}
                onSelect={toggleReference}
                useSource={props.onUseCanvasSource}
                sourceProjectId={artwork?.projectId}
                currentAssetId={artwork?.assetId}
              />
            )}
            {!message.search?.some((item) => item.kind === 'web') &&
              !!message.citations?.length && (
                <div className="assistant-citations">
                  {message.citations.map((citation) => (
                    <a
                      key={citation.url}
                      href={/^https?:\/\//.test(citation.url) ? citation.url : undefined}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {citation.title}
                    </a>
                  ))}
                </div>
              )}
            {message.role === 'assistant' && message.text && !isStreaming && <CopyMessage text={message.text} />}
            </article>
          );
          return message === anchor && turnProgress ? [article, <div className="ai-turn-activity" key="turn-progress">{turnProgress}</div>] : [article];
        })}
        {showTurnProgress && !anchor && turnProgress && <div className="ai-turn-activity">{turnProgress}</div>}
      </div>
    );
  }
  function renderWorkspace() {
    if (!workspace || !workspaceReady) return null;
    return (
      <WorkspaceCards
        spec={workspace.spec}
        candidates={workspace.candidateIds.map((id) =>
          candidates.find((item) => item.id === id)!,
        )}
        grant={grant}
        disabled={busy || submissionBlocked}
        canExecute={creative.mode !== 'suggest'}
        previewCandidateId={previewCandidateId}
        confirmedCandidateIds={confirmedCandidateIds}
        onConfirmPreview={props.onConfirmPreview ? confirmCandidatePreview : undefined}
        onCancelPreview={props.onCancelPreview ? cancelCandidatePreview : undefined}
        onDecision={(candidate, decision) => {
          void decide(candidate, decision);
        }}
        onPrompt={(text) => {
          setPrompt(text);
          composerInput.current?.focus({ preventScroll: true });
        }}
      />
    );
  }
  function renderCandidates(entries: AssistantCandidate[]) {
    if (!entries.length) return null;
    return (
      <div className="assistant-candidates" data-motion="ai-answer">
        {entries.map((candidate) => (
          <article key={candidate.id} className="assistant-candidate">
            <h4>
              <Sparkle size={15} />
              {candidate.kind === 'edit' ? t('待确认的编辑') : t('生图草案')}
            </h4>
            <p>{candidate.summary}</p>
            {!!candidate.changes?.length && (
              <MotionDetails>
                <summary>
                  {t('查看')}
                  {candidate.changes.length} {t('项参数变化')}
                </summary>
                <table>
                  <thead>
                    <tr>
                      <th>{t('参数')}</th>
                      <th>{t('原值')}</th>
                      <th>{t('建议')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidate.changes.map((change) => (
                      <tr key={change.path}>
                        <td>{change.label}</td>
                        <td>{change.before}</td>
                        <td>{change.after}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </MotionDetails>
            )}
            <CandidateActions
              candidate={candidate}
              disabled={busy || submissionBlocked}
              canExecute={creative.mode !== 'suggest'}
              previewing={previewCandidateId === candidate.id}
              confirmed={confirmedCandidateIds.has(candidate.id)}
              onDecision={(item, decision) => void decide(item, decision)}
              onConfirm={props.onConfirmPreview ? confirmCandidatePreview : undefined}
              onCancel={props.onCancelPreview ? cancelCandidatePreview : undefined}
            />
          </article>
        ))}
      </div>
    );
  }
  const showVoiceTranscript = voiceCaptionsVisible && hasVoiceCaptions && voiceExtra === null;
  const voicePortal = voiceVisible && createPortal(
    <section
      ref={voiceWorkspace}
      className="voice-call-workspace"
      data-call-state={callState}
      aria-label={t('实时语音')}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        if (voiceExtra) closeVoiceExtra();
        else if (voiceToolsOpen) {
          setVoiceToolsOpen(false);
          voiceToolsTrigger.current?.focus({ preventScroll: true });
        } else dismissVoice();
      }}
    >
      <div className="voice-workspace-center">{voicePanel}</div>
      <div className="voice-workspace-footer">
        {(!catalog || showVoiceTranscript || toolStatus || voiceExtra === 'details' ||
          error || recoveryLabel) && (
          <div className="voice-workspace-details">
            {!catalog && (
              <ModelReadStatus label={t(catalogError ? '模型列表加载失败' : '正在读取模型')}
                error={catalogError} retry={() => setCatalogAttempt((n) => n + 1)} />
            )}
            {showVoiceTranscript && <VoiceCaptions captions={voiceCaptions} compact />}
            {toolStatus && <div className="voice-tool-status"><AssistantActivity label={renderStatus(toolStatus)} color="var(--voice-muted)" /></div>}
            {voiceExtra === 'details' && (
              <div id={voiceDetailsId} className="voice-results">
                <p className="voice-context-status" id={voiceContextId}>{t(contextStatus)}</p>
                {voiceCaptionsVisible && hasVoiceCaptions && <VoiceCaptions captions={voiceCaptions} compact />}
                {voiceSupplement}
                {delegatedResult && (
                  <section className="assistant-voice-search" aria-label={t('委派结果')}>
                    <strong>{delegatedResult.kind === 'responses' ? 'Responses' : 'Decisions'}</strong>
                    <p style={{ whiteSpace: 'pre-wrap' }}>{delegatedResult.text}</p>
                  </section>
                )}
                {hasVoiceResults && renderMessages(voiceMessages)}
                {workspace?.candidateIds.some((id) => voiceCandidateIds.has(id)) && renderWorkspace()}
                {renderCandidates(remainingCandidates.filter(({ id }) => voiceCandidateIds.has(id)))}
              </div>
            )}
            {error && <p className="assistant-error" role="alert">{renderStatus(error)}</p>}
            {recoveryLabel && <button type="button" className="text-button" onClick={() => {
              setOverlay('recovery');
            }}>{t(recoveryLabel)} · {t('核对请求')}</button>}
          </div>
        )}
        {voiceExtra !== 'details' && <span className="voice-sr-only" id={voiceContextId}>{t(contextStatus)}</span>}
        {callState === 'active' && !translating && voiceExtra === 'text' && (
          <form id={voiceTextId} className="voice-composer" data-ai-voice-composer onSubmit={(event) => {
            event.preventDefault();
            if (canSend) void submit();
          }}>
            <PromptBar className="assistant-reference-prompt" width={1200} maxRows={2}
              value={prompt} onValueChange={setPrompt} maxLength={4000} inputRef={voiceTextInput}
              placeholder={t('补充通话要求…')}
              sources={[]} commands={[]} models={[]} efforts={[]}
              disabled={!!pendingSubmission || !submissionReady} sendDisabled={!canSend}
              onSend={() => void submit()}
              labels={{ input: t('向智能体描述修改需求'), send: t('发送协作请求') }} />
          </form>
        )}
        {voiceToolsOpen && (callState === 'idle' || callState === 'active') && (
          <div id={voiceToolsId} className="voice-workspace-utilities" role="group" aria-label={t('通话工具')}>
            {callState === 'active' && !translating && (
              <IconButton ref={voiceTextTrigger} label={t('补充文字')} aria-expanded={voiceExtra === 'text'}
                aria-controls={voiceExtra === 'text' ? voiceTextId : undefined}
                onClick={() => setVoiceExtra((open) => open === 'text' ? null : 'text')}>
                <Keyboard size={17} />
              </IconButton>
            )}
            {(inCall || hasVoiceCaptions) && (
              <IconButton label={t(voiceCaptionsVisible ? '隐藏字幕' : '显示字幕')}
                aria-pressed={voiceCaptionsVisible}
                onClick={() => setVoiceCaptionsVisible((visible) => !visible)}>
                <ClosedCaptioning size={17} />
              </IconButton>
            )}
            {voiceContextToggle}
            {(inCall || hasVoiceResults) && (
              <IconButton ref={voiceDetailsTrigger} label={t('通话详情')}
                aria-expanded={voiceExtra === 'details'}
                aria-controls={voiceExtra === 'details' ? voiceDetailsId : undefined}
                data-has-results={hasVoiceResults && voiceExtra !== 'details' ? '' : undefined}
                onClick={() => setVoiceExtra((open) => open === 'details' ? null : 'details')}>
                <ChatText size={17} />
              </IconButton>
            )}
            <IconButton label={t('助手设置')} onClick={() => setOverlay('settings')}><GearSix size={17} /></IconButton>
          </div>
        )}
      </div>
    </section>, document.body,
  );
  return (
    <>
    {voicePortal}
    <section
      className="live-assistant live-assistant-v2"
      data-availability={
        !isLoggedIn
          ? 'login'
          : !project
            ? 'project'
            : !catalog
              ? 'loading'
              : catalog.ready
                ? 'ready'
                : 'unavailable'
      }
      hidden={props.hidden}
      inert={props.hidden}
      data-in-call={inCall || undefined}
      data-compose-expanded={composerExpanded || undefined}
      data-turn-active={!!activeTurn || undefined}
      data-settings-open={overlay === 'settings' || undefined}
      aria-label={t('实时语音与智能体协作')}
    >
      <header className="ai-workbench-header" inert={voiceVisible}>
        {props.navigation ?? (
          <strong className="ai-task-title">
            <Sparkle size={18} />
            {t('对话')}
          </strong>
        )}
        <div className="ai-header-actions">
          {props.onExport && <IconButton label={t('导出当前照片')} onClick={props.onExport}>
            <StudioGlyph name="export" size={18} />
          </IconButton>}
          <IconButton
            label={t('新会话')}
            className="ai-new-conversation"
            disabled={busy || inCall || submissionBlocked}
            onClick={newConversation}
          >
            <Plus size={18} />
          </IconButton>
          <IconButton
            label={t('会话记录')}
            disabled={busy || inCall}
            onClick={() => setOverlay('history')}
          >
            <ClockCounterClockwise size={18} />
          </IconButton>
          <IconButton label={t('助手设置')} onClick={() => setOverlay('settings')}>
            <GearSix size={18} />
          </IconButton>
          <IconButton
            className="ai-compact-action ai-compact-voice"
            label={t('打开实时语音')}
            disabled={!isLoggedIn || busy}
            onClick={(event) => showVoice(event.currentTarget)}
          >
            <Microphone size={18} />
          </IconButton>
          <IconButton
            className="ai-compact-action ai-compose-expand"
            label={composerExpanded ? compactCopy.collapseComposer : compactCopy.expandComposer}
            aria-expanded={composerExpanded}
            disabled={composerExpansionBlocked}
            onClick={() => {
              if (composerExpansionBlocked) return;
              setComposerExpanded((value) => !value);
              if (!composerExpanded)
                requestAnimationFrame(() => composerInput.current?.focus({ preventScroll: true }));
            }}
          >
            {composerExpanded ? <ArrowsIn size={18} /> : <ArrowsOut size={18} />}
          </IconButton>
          {props.onClose && (
            <IconButton
              className="ai-panel-close"
              label={t('收起 AI 面板')}
              onClick={props.onClose}
            >
              <X size={18} />
            </IconButton>
          )}
        </div>
      </header>
      <div
        ref={conversationBody}
        className="ai-conversation-body"
        inert={voiceVisible}
        aria-label={t('助手对话内容')}
        onScroll={(event) =>
 {
          const node = event.currentTarget;
          if (props.visible === false || !node.clientHeight) return;
          followingConversation.current =
            node.scrollHeight - node.clientHeight - node.scrollTop < 64;
        }}
      >
          {isLoggedIn && !catalog && (
            <ModelReadStatus
              label={t(catalogError ? '模型列表加载失败' : '正在读取模型')}
              error={catalogError}
              retry={() => setCatalogAttempt((n) => n + 1)}
            />
          )}
        {!isLoggedIn ? (
          <div className="ai-conversation-empty ai-login-empty">
            <ComposerVisual kind="assistant" />
            <div>
              <h3>{t('登录后使用 AI 助手')}</h3>
            </div>
            <button className="button button-primary" onClick={onAuth}>
              {t('登录')}
            </button>
          </div>
        ) : (
          <>
            {availabilityMessage && !showConversationEmpty && (
              <div className="ai-availability" role="status" data-assistant-availability>
                <span>{availabilityMessage}</span>
                {availabilityDetails}
                {!project && (
                  <button type="button" onClick={onSave}>
                    {t('选择项目')}
                  </button>
                )}
              </div>
            )}
            <ResearchGraph
              turnId={researchTurnId}
              live={
                researchGraph && researchGraph.turnId === researchTurnId ? researchGraph.nodes : []
              }
              running={Boolean(activeTurn && activeTurn.id === researchTurnId)}
            />
            {showConversationEmpty && (
              <div className="ai-conversation-empty">
                <ComposerVisual kind="assistant" />
                {availabilityMessage ? (
                  <div className="ai-empty-availability" role="status" data-assistant-availability>
                    <p>{availabilityMessage}</p>
                    {availabilityDetails}
                    {!project && (
                      <button className="button button-secondary" type="button" onClick={onSave}>
                        {t('选择项目')}
                      </button>
                    )}
                  </div>
                ) : (
                  <h3>{t('描述需要修改的地方')}</h3>
                )}
              </div>
            )}
            {renderMessages(messages, true)}
            {toolStatus && !activeTurn && !inCall && (
              <p className="ai-turn-note" role="status">{renderStatus(toolStatus)}</p>
            )}
            {renderWorkspace()}
            {renderCandidates(remainingCandidates)}
            {candidateHistoryStatus && (
              <p className="ai-secondary-copy" role="status">
                {renderStatus(candidateHistoryStatus)}
              </p>
            )}
          </>
        )}
        {recoveryLabel && (
          <div className="ai-pending-strip" role="status">
            <WarningCircle size={16} />
            <span>{t(recoveryLabel)}</span>
            <button type="button" onClick={() => setOverlay('recovery')}>
              {t('核对请求')}
            </button>
          </div>
        )}
        {error && (
          <p className="assistant-error" role="alert">
            {renderStatus(error)}
            {props.onTopUp && /额度|服务点|credit|quota/i.test(String(renderStatus(error))) && (
              <button className="text-button" type="button" onClick={props.onTopUp}>{t('充值与订阅')}</button>
            )}
            <button className="text-button" onClick={refreshHistory}>
              {t('刷新会话记录')}
            </button>
            {actorId && !submissionReady && (
              <button className="text-button" onClick={restoreSubmission}>
                {t('重新读取恢复记录')}
              </button>
            )}
          </p>
        )}
      </div>
      <footer className="ai-composer-region" hidden={voiceVisible} inert={voiceVisible}>
        <form
          className="assistant-composer assistant-reference-composer"
          data-ai-composer
          onKeyDown={(event) => {
            if (event.key === 'Escape' && composerExpanded && !event.nativeEvent.isComposing) {
              event.preventDefault();
              setComposerExpanded(false);
              event.currentTarget
                .closest('.live-assistant')
                ?.querySelector<HTMLButtonElement>('.ai-compose-expand')
                ?.focus({ preventScroll: true });
            }
          }}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {mode === 'text' && props.visualAttachment && (
            <DraftAttachmentCard
              source={props.visualAttachment.imageDataUrl}
              label={visualAttachmentLabel(props.visualAttachment.kind)}
              disabled={busy || !!pendingSubmission}
              onRemove={() => {
                if (props.visualAttachment)
                  props.onClearVisualAttachment?.(props.visualAttachment);
              }}
            />
          )}
          {(shareImage ||
            referenceIds.length > 0 ||
            memory ||
            allowWebSearch ||
            (mode === 'text' && researchLibrary.trim() && spaceIds.length > 0)) && (
            <button
              className="ai-selected-context"
              type="button"
              onClick={() => {
                setSharedRangeOpen(true);
                setOverlay('settings');
              }}
            >
              <Eye size={14} />
              <span>
                {[
                  shareImage ? t('当前预览') : '',
                  referenceIds.length ? t('{v0} 张参考', { v0: referenceIds.length }) : '',
                  memory ? t('已确认偏好') : '',
                  allowWebSearch
                    ? mode === 'text' && secondPublicQuery.trim()
                      ? t('2 项公开检索')
                      : t('公开检索')
                    : '',
                  mode === 'text' && researchLibrary.trim() && spaceIds.length > 0
                    ? t('素材检索')
                    : '',
                  mode === 'text' && researchCanvas && shareImage ? t('画面检查') : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </button>
          )}
          {mode === 'text' && props.visualAttachment && selected && !selected.imageInput && (
            <small className="ai-attachment-status" role="status">
              {t('请选择支持图片的模型，或移除附件。')}
            </small>
          )}
          <PromptBar className="assistant-reference-prompt" width={1200} inputRef={composerInput}
            placeholder={inCall ? t('补充通话要求…') : t('输入调整要求…')}
            value={prompt} onValueChange={setPrompt} maxLength={4000}
            modelKey={modelId} onModelChange={setModelId}
            models={models.map((model) => ({ key: model.id, name: model.label }))}
            efforts={[]}
            commands={[
              { key: 'settings', name: '/' + t('助手设置'), action: () => setOverlay('settings') },
              { key: 'history', name: '/' + t('会话记录'), action: () => setOverlay('history') },
            ]}
            disabled={!isLoggedIn || !!pendingSubmission || !submissionReady}
            modelDisabled={busy || inCall || !!grant} sendDisabled={!canSend}
            busy={!!activeTurn} stopDisabled={!!activeTurn?.stopping}
            onSend={() => void submit()} onStop={() => void stopActiveTurn()}
            labels={{ input: t('向智能体描述修改需求'), attach: t('共享画面与参考素材'),
              chooseModel: t('选择助手模型与执行方式'), models: t('选择模型'),
              sources: t('共享画面与参考素材'), commands: t('助手操作'), empty: t('没有匹配的选项'),
              send: t('发送协作请求'), stop: t('停止本轮执行') }}
            sources={[
                {
                  key: 'reference', name: t('参考图'),
                  icon: <Paperclip size={17} />,
                  description: t('共享画面与参考素材'),
                  action: () => {
                    setSharedRangeOpen(true);
                    setOverlay('settings');
                  },
                },
                ...(!busy && !submissionBlocked && artwork && selected?.imageInput &&
                  callState !== 'connecting' && callState !== 'closing' ? [{
                  key: 'canvas', name: t('当前预览'),
                  icon: <ImageSquare size={17} />,
                  description: t(shareImage ? '移除当前预览' : '共享当前预览'),
                  action: () => setShareImage((enabled) => !enabled),
                }] : []),
              ]}
            tools={<VoicePill className="assistant-voice-pill" size={34} reactive="external"
              background={inCall ? 'var(--accent-soft)' : 'transparent'} accentColor="var(--accent-ink)" iconColor="var(--muted)"
              externalDisplay={inCall} externalActive={callState === 'active' && !muted}
              externalStream={client.current?.microphoneStream} elapsed={elapsed}
              slideToCancel={false} disabled={!isLoggedIn || busy} ariaLabel={t(inCall ? '返回实时通话' : '打开实时语音')}
              onAction={(trigger) => showVoice(trigger)} />} />
        </form>
        {selected && (
          <div className="ai-composer-meta">
            <span className="ai-execution-summary">
              <span className="ai-full-execution-label">{t(executionLabel)}</span>
              <span className="ai-compact-status">{t(executionLabel)}</span>
              {grant && creative.mode === 'auto'
                ? t(' · {v0}/{v1} 点', { v0: grant.usedUnits, v1: grant.unitLimit })
                : ''}
            </span>
            {grant && creative.mode === 'auto' && (
              <button className="ai-grant-stop" type="button" onClick={() => void revokeGrant()}>
                {t('停止授权')}
              </button>
            )}
            <span className="ai-price-summary">
              {selected ? t('文字 {v0} 点 / 轮', { v0: selected.unitCost }) : t('点数待确认')}
            </span>
          </div>
        )}
      </footer>
      <PanelSettingsPage
        title={t('助手设置')}
        open={props.visible !== false && overlay === 'settings'}
        onClose={() => setOverlay(null)}
      >
        <div className="ai-options-content">
          <PanelSettings onClose={() => setOverlay(null)} />
          <RubberSegment
            label={t('交流方式')}
            className="assistant-mode"
            value={mode}
            onChange={(value) => {
              setMode(value);
              if (value === 'voice') {
                setOverlay(null);
                showVoice();
              }
            }}
            disabled={inCall}
            options={[
              { value: 'text', label: t('文字协作') },
              { value: 'voice', label: t('实时对话') },
            ]}
          />
          <div className="assistant-models">
            <ModelChoice
              label={t('助手模型')}
              ariaLabel={t('助手模型')}
              value={modelId}
              onChange={setModelId}
              disabled={inCall || busy || submissionBlocked || !!grant}
              placeholder={t('暂无可用模型')}
              options={models.map((item) => ({
                value: item.id,
                label: item.label,
                description: `${t('{v0} 服务点 / 轮', { v0: item.unitCost })}${item.responses?.deprecated ? ` · ${t('已公告停用')}` : ''}`,
              }))}
            />
            {mode === 'text' && !!selected?.responses?.reasoning.length && !selected.responseDefaults?.effortFixedForSampling && (
              <ChoiceSelect label={t('本轮推理档位')} value={activeTuning.effort ?? ''}
                disabled={catalogSelectionLocked || submissionBlocked} onValueChange={(value) =>
                  setTuningByModel((old) => ({ ...old, [modelId]: { ...old[modelId], effort: (value || undefined) as AssistantResponseTuning['effort'] } }))}
                options={[
                  { value: '', label: `${t('默认')} · ${selected.responseDefaults?.effort ?? selected.responses.defaultEffort ?? '—'}` },
                  ...selected.responses.reasoning.map((value) => ({ value, label: value })),
                ]} />
            )}
            {mode === 'text' && selected?.responses?.verbosity && (
              <ChoiceSelect label={t('回答详细度')} value={activeTuning.verbosity ?? ''}
                disabled={catalogSelectionLocked || submissionBlocked} onValueChange={(value) =>
                  setTuningByModel((old) => ({ ...old, [modelId]: { ...old[modelId], verbosity: (value || undefined) as AssistantResponseTuning['verbosity'] } }))}
                options={[
                  { value: '', label: `${t('默认')} · ${selected.responseDefaults?.verbosity ?? 'medium'}` },
                  ...['low', 'medium', 'high'].map((value) => ({ value, label: value })),
                ]} />
            )}
            {mode === 'voice' && (
              <ModelChoice
                label={t('语音模型')}
                ariaLabel={t('语音模型')}
                value={voiceId}
                onChange={setVoiceId}
                disabled={inCall || busy || submissionBlocked || !!grant}
                placeholder={t('暂无语音模型')}
                options={voices.map((item) => ({
                  value: item.id,
                  label: item.label,
                  description: `${formatNumber(item.unitCost)} ${t('点')}`,
                }))}
              />
            )}
            {mode === 'voice' && !translating && voiceOptions.length > 1 && (
              <ChoiceSelect label={t('语音音色')} value={voice} onValueChange={setVoice}
                disabled={inCall || busy || !!pendingVoiceSubmission || !!pendingTeamVoiceSubmission || !voiceSubmissionReady}
                placeholder={t('选择音色')}
                options={voiceOptions.map((option) => ({ value: option, label: option }))} />
            )}
            {mode === 'voice' && (translating || actualDelegation) && (
              <LiveModeSettings
                disabled={inCall || busy || submissionBlocked || !!grant}
                mode={translating ? 'translation' : liveDelegation.type}
                setMode={(value) => setLiveDelegation(value === 'decisions'
                  ? { type: value, questions: [...defaultLiveDecisionQuestions] } : { type: value })}
                delegation={liveDelegation}
                setDelegation={setLiveDelegation}
                translation={liveTranslation}
                setTranslation={setLiveTranslation}
                tiers={selected?.responses?.tiers ?? []}
                maxOutputTokens={selected?.maxOutputTokens ?? 2048}
              />
            )}
            {mode === 'voice' && selectedVoice && (
              <p className="ai-selected-model-meta">
                {t('{v0} 服务点 · 最长 {v1} 秒', {
                  v0: selectedVoice.unitCost,
                  v1: selectedVoice.maxSeconds,
                })}
              </p>
            )}
          </div>
          <CreativeControls
            value={creative}
            onChange={setCreative}
            disabled={inCall || busy || submissionBlocked}
            grant={grant}
            onAuthorize={() => {
              void explicitAuthorize();
            }}
            onRevoke={() => {
              void revokeGrant();
            }}
          />
          <ContextEvidence turnId={parentTurnId} live={contextManifest} />
          {project && (
            <MemoryControls
              key={`${project.id}:${artwork?.id ?? ''}`}
              projectId={project.id}
              artworkId={artwork?.id}
              sourceTurnId={parentTurnId}
              disabled={busy || inCall}
              suggestions={memorySuggestions}
            />
          )}
          <MotionDetails
            className="assistant-context"
            open={sharedRangeOpen}
            onOpenChange={setSharedRangeOpen}
          >
            <summary>
              <Eye size={15} /> {t('共享范围 ·')}
              {shareImage ? t('画面与参数') : t('仅参数')}
              {allowWebSearch ? t(' · 联网') : ''}
            </summary>
            <div className="assistant-context-options">
              <label>
                <input
                  type="checkbox"
                  checked={shareImage}
                  disabled={
                    callState === 'connecting' ||
                    callState === 'closing' ||
                    busy ||
                    submissionBlocked ||
                    !artwork ||
                    !selected?.imageInput
                  }
                  onChange={(event) => setShareImage(event.target.checked)}
                />
                {t('共享当前预览，通话中编辑后持续更新')}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={allowWebSearch}
                  disabled={inCall || busy || submissionBlocked || !selected?.webSearch}
                  onChange={(event) => setAllowWebSearch(event.target.checked)}
                />
                {t('允许公开网络检索，保留来源链接')}
              </label>
              {mode === 'text' && allowWebSearch && selected?.webSearch && (
                <div className="assistant-public-query">
                  <label>
                    {t('可公开的查询词')}
                    <input
                      aria-label={t('公开检索查询词')}
                      value={publicQuery}
                      maxLength={240}
                      disabled={inCall || busy || submissionBlocked}
                      onChange={(event) => setPublicQuery(event.target.value)}
                      placeholder={t('例如：复古产品静物布光参考')}
                    />
                  </label>
                  <label>
                    {t('第二项公开查询（可选）')}
                    <input
                      value={secondPublicQuery}
                      maxLength={240}
                      disabled={inCall || busy || submissionBlocked}
                      onChange={(event) => setSecondPublicQuery(event.target.value)}
                    />
                  </label>
                  {selected.webImageSearch && (
                    <label>
                      <input
                        type="checkbox"
                        checked={publicImages}
                        disabled={inCall || busy || submissionBlocked}
                        onChange={(event) => setPublicImages(event.target.checked)}
                      />
                      {t('同时查找公开图片')}
                    </label>
                  )}
                  <small>
                    {t('公开检索使用这里填写的查询词。共享画面和项目资料在编辑协作步骤中处理。')}
                  </small>
                </div>
              )}
              {mode === 'text' && (spaceIds.length > 0 || (shareImage && selected?.imageInput)) && (
                <MotionDetails className="assistant-context assistant-research-plan">
                  <summary>{t('本轮分工')}</summary>
                  <div className="assistant-research-options">
                    {spaceIds.length > 0 && (
                      <label>
                        {t('在已授权空间检索素材')}
                        <input
                          value={researchLibrary}
                          maxLength={200}
                          disabled={inCall || busy || submissionBlocked}
                          onChange={(event) => setResearchLibrary(event.target.value)}
                        />
                      </label>
                    )}
                    {shareImage && selected?.imageInput && (
                      <label>
                        <input
                          type="checkbox"
                          checked={researchCanvas}
                          disabled={inCall || busy || submissionBlocked}
                          onChange={(event) => setResearchCanvas(event.target.checked)}
                        />
                        {t('检查当前共享画面')}
                      </label>
                    )}
                  </div>
                </MotionDetails>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={memory}
                  disabled={inCall || busy || submissionBlocked}
                  onChange={(event) => setMemory(event.target.checked)}
                />
                {t('使用已确认的偏好、项目要求与素材标注')}
              </label>
              <fieldset disabled={inCall || busy || submissionBlocked}>
                <legend>
                  {t('可搜索的空间 ·')}
                  {spaceIds.length} / 12
                </legend>
                {spaces.map((space) => (
                  <label key={space.id}>
                    <input
                      type="checkbox"
                      checked={spaceIds.includes(space.id)}
                      disabled={!spaceIds.includes(space.id) && spaceIds.length >= 12}
                      onChange={(event) => {
                        cancelSearch();
                        setSpaceIds((old) =>
                          event.target.checked
                            ? old.length < 12
                              ? [...old, space.id]
                              : old
                            : old.filter((id) => id !== space.id),
                        );
                        setReferenceIds([]);
                      }}
                    />
                    {space.name}
                    <small>{space.kind === 'team' ? t('团队') : t('个人')}</small>
                  </label>
                ))}
              </fieldset>
              <div className="assistant-resource-search">
                <input
                  aria-label={t('搜索授权素材')}
                  value={resourceQuery}
                  maxLength={200}
                  onChange={(event) => {
                    cancelSearch();
                    setResourceQuery(event.target.value);
                  }}
                  disabled={inCall}
                  placeholder={t('找一张以前用过的图片')}
                />
                <button
                  aria-label={t('查找素材')}
                  onClick={search}
                  disabled={inCall || !spaceIds.length}
                >
                  <MagnifyingGlass size={17} />
                </button>
              </div>
              {searchStatus && <p role="status">{renderStatus(searchStatus)}</p>}
              {!!resources.length && (
                <CloudImageResults
                  resources={resources}
                  selected={referenceIds}
                  disabled={inCall || busy}
                  onSelect={toggleReference}
                  useSource={props.onUseCanvasSource}
                  sourceProjectId={artwork?.projectId}
                  currentAssetId={artwork?.assetId}
                />
              )}
              <p>
                {t('检索只返回名称与标注；只有选中的')}
                {referenceIds.length} {t('张参考图和勾选的当前预览会发送给模型。')}
              </p>
            </div>
          </MotionDetails>
        </div>
      </PanelSettingsPage>
      <Modal
        title={t('会话记录')}
        open={props.visible !== false && overlay === 'history'}
        keepMounted
        onClose={() => setOverlay(null)}
        className="ai-options-dialog"
      >
        <div className="ai-history-options">
          <button
            type="button"
            className="ai-history-row"
            disabled={busy || inCall || submissionBlocked}
            onClick={newConversation}
          >
            <Plus size={18} />
            {t('新会话')}
          </button>
          <ChoiceSelect
            label={t('会话记录')}
            ariaLabel={t('会话记录')}
            value={conversationId ?? ''}
            disabled={busy || inCall}
            options={[
              { value: '', label: t('新会话') },
              ...conversations.map((item) => ({
                value: item.id,
                label: item.title,
                description: t('{v0} 轮', { v0: item.turnCount }),
              })),
            ]}
            onValueChange={(value) => {
              setConversationId(value);
              freshConversation.current = !value;
              setParentTurnId(undefined);
              setMessages([]);
              setCandidates([]);
              setWorkspace(null);
              setMemorySuggestions({ items: [] });
              setContextManifest(null);
              setResearchGraph(null);
              setExecutionEvents([]);
              setSettledTurn(null);
              setToolStatus('');
              setError('');
              followingConversation.current = true;
              setOverlay(null);
            }}
          />
          <button
            type="button"
            className="text-button"
            disabled={busy || inCall || !project}
            onClick={() => {
              void loadProjectCandidates();
              setOverlay(null);
            }}
          >
            {t('查看项目候选（含语音协作）')}
          </button>
        </div>
      </Modal>
      <Modal
        title={t('核对原请求')}
        open={props.visible !== false && overlay === 'recovery'}
        keepMounted
        onClose={() => setOverlay(null)}
        className="ai-options-dialog"
      >
        <div className="ai-options-content">
          {voiceRecoveryError && (
            <section
              className="assistant-candidate"
              aria-label={t('语音恢复记录读取失败')}
              role="alert"
            >
              <h4>{t('暂时无法核对上次通话')}</h4>
              <p>{t(voiceRecoveryError)}</p>
              <p>{t('读取成功前暂停新通话。重新读取本机记录不会向模型发送请求。')}</p>
              <button type="button" disabled={inCall} onClick={restoreVoiceSubmission}>
                {t('重新读取本机记录')}
              </button>
            </section>
          )}
          {pendingTeamVoiceSubmission && (
            <section
              className="assistant-candidate"
              aria-label={t('团队语音未决邀请')}
              role="status"
            >
              <h4>{t('原团队 AI 邀请仍待确认')}</h4>
              <p>
                {t(
                  '请返回作品的团队语音面板查看邀请状态，或在「用量」中核对。核验前暂停新的个人 AI 通话。',
                )}
              </p>
              <p style={{ overflowWrap: 'anywhere' }}>
                {t('请求标识：')}
                <code>{pendingTeamVoiceSubmission.idempotencyKey}</code>
              </p>
            </section>
          )}
          {pendingVoiceSubmission && !inCall && (
            <section
              className="assistant-candidate"
              aria-label={t('语音请求恢复')}
              aria-live="polite"
            >
              <h4>
                {pendingVoiceSubmission.sessionId ||
                pendingVoiceSubmission.state === 'already-prepared'
                  ? t('上次通话待平台核验')
                  : t('上次通话的准备结果待确认')}
              </h4>
              <p>
                {t('已保留项目「')}
                {pendingVoiceSubmission.projectTitle}
                {t(
                  '」的原请求，核验完成前暂停创建新通话。 结束通话、断网或等待一段时间，都不能证明预占已结清。',
                )}
              </p>
              <p style={{ overflowWrap: 'anywhere' }}>
                {t('请求标识：')}
                <code>{pendingVoiceSubmission.idempotencyKey}</code>
                {pendingVoiceSubmission.sessionId && (
                  <>
                    <br />
                    {t('会话标识：')}
                    <code>{pendingVoiceSubmission.sessionId}</code>
                  </>
                )}
              </p>
              <p>
                {t(
                  '可在「用量」查看已知任务的状态与预占，并将以上标识提供给平台运营核验。 当前界面不支持自动恢复这次通话，原连接凭证也不能重新发放，仍需平台协助处理。',
                )}
              </p>
              {!pendingVoiceSubmission.sessionId &&
                pendingVoiceSubmission.state !== 'already-prepared' && (
                  <>
                    <p>
                      {t(
                        '沿原请求核对只使用当时的模型、画面、参数和授权。如服务器尚未受理， 将继续原通话并使用原授权额度；已准备过的通话会保持待核验状态。',
                      )}
                    </p>
                    {pendingVoiceSubmission.requestBody === null ? (
                      <p>
                        {t(
                          '原始共享画面只保留在页面内存中，当前无法重放，请凭原标识联系平台核验。',
                        )}
                      </p>
                    ) : pendingVoiceSubmission.projectId !== project?.id ? (
                      <p>{t('请先返回原项目，再沿原请求核对。')}</p>
                    ) : (
                      <button
                        type="button"
                        disabled={busy || submissionBlocked || !voiceSubmissionReady}
                        onClick={() => void startVoice(pendingVoiceSubmission)}
                      >
                        {t('沿原请求核对 / 继续')}
                      </button>
                    )}
                  </>
                )}
            </section>
          )}
          {pendingSubmission && (
            <section
              className="assistant-candidate"
              aria-label={t('协作请求恢复')}
              aria-live="polite"
            >
              <h4>
                {pendingSubmission.state === 'unknown'
                  ? t('本轮结果待平台核验')
                  : busy
                    ? t('正在核对本轮协作')
                    : pendingSubmission.turnId
                      ? t('本轮已受理，可恢复查看进度')
                      : t('发送结果待确认，原请求已保留')}
              </h4>
              <p>
                {pendingSubmission.state === 'unknown'
                  ? t(
                      '服务方的执行与用量结果尚未确认。核验完成前保留本轮请求，可刷新结果或查看用量记录。',
                    )
                  : pendingSubmission.turnId
                    ? t('恢复时只读取这一轮的结果与进度，不再提交新的模型请求。')
                    : t(
                        '原文字、画面、模型和授权已冻结。按原请求核对时，已受理的请求会返回原结果；如尚未受理，将继续原请求并使用原授权额度。',
                      )}
              </p>
              {pendingSubmission.automatic && !pendingSubmission.turnId && (
                <p>{t('原请求使用预算内自动执行授权，继续时沿用当时的画面与执行范围。')}</p>
              )}
              {!pendingSubmission.turnId &&
                pendingSubmission.projectId === project?.id &&
                pendingSubmission.editorKey !== assistantEditorKey(editorState(props)) && (
                  <p>{t('当前画布已变化。按原请求继续时，仍使用发送前保存的画面与参数。')}</p>
                )}
              {!pendingSubmission.turnId && pendingSubmission.requestBody === null && (
                <p>
                  {t(
                    '原始共享画面仅保留在页面内存中，刷新后已不可重放。请先核对会话与用量记录并联系平台处理。',
                  )}
                </p>
              )}
              {pendingSubmission.projectId !== project?.id ? (
                <p>
                  {t('请返回项目「')}
                  {pendingSubmission.projectTitle}
                  {t('」恢复本轮，再开始新的付费协作。')}
                </p>
              ) : (
                <div>
                  <button type="button" disabled={busy || inCall} onClick={refreshHistory}>
                    {t('刷新会话记录')}
                  </button>
                  <button
                    type="button"
                    disabled={
                      busy ||
                      inCall ||
                      !submissionReady ||
                      (!pendingSubmission.turnId && pendingSubmission.requestBody === null)
                    }
                    onClick={() => void recoverSubmission()}
                  >
                    {pendingSubmission.turnId ? t('读取本轮结果') : t('按原请求核对并继续')}
                  </button>
                </div>
              )}
            </section>
          )}
        </div>
      </Modal>
    </section>
    </>
  );
}
