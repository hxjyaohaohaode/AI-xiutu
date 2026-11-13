import { captureSketchVisual } from '../editor/capture';
import {
  fileTranscriptionOptionsSchema, supportsFileTranscriptionOptions, type FileTranscriptionOptions,
  openAISpeechOptionsSchema, openAIAudioChatOptionsSchema, openAISearchOptionsSchema,
  openAIEmbeddingOptionsSchema, openAITranslationOptionsSchema, type OpenAISpecialistOperation,
} from '@ai-xiutu/contracts';
import { TranscriptionParameters } from '../ai/TranscriptionParameters';
import { SpecialistOptions, specialistDefaults, specialistTaskLabels } from '../ai/SpecialistOptions';
import { ModelReadStatus } from '../ai/ModelReadStatus';
import { t } from '../i18n';
import '../ai/interaction-surfaces.css';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Sparkle,
  X,
  ArrowLeft,
  SlidersHorizontal,
  ImageSquare,
  FileText,
  Microphone,
  PencilSimple,
  Plus,
  Paperclip,
  ArrowBendDownRight,
  WarningCircle,
  CaretDown,
  ClockCounterClockwise,
  GearSix,
  ArrowClockwise,
  Scan,
  Export,
  SpeakerHigh,
  MagnifyingGlass,
  Translate,
  Waveform,
  Hash,
} from '@phosphor-icons/react';
import {
  MAX_HEADER_BYTES,
  parseEditorRecipe,
  patchEditorAdjustments,
  readImageHeader,
  type EditorRecipe,
} from '@ai-xiutu/editor';
import type {
  AssetCopyRecord,
  AssistantCloudResource,
  AssistantVisualAttachment,
} from '@ai-xiutu/contracts';
import { secureUuid } from '../lib/uuid';
import { readModelCatalog, api, errorMessage, jsonRequest } from '../lib/api';
import { assetCopyAttempt } from '../lib/asset-copy';
import type { Artwork, Asset, Project, PublicConfig } from '../lib/types';
import { Busy, IconButton, InlineError, Modal } from './Ui';
import { ChoiceSelect } from './ChoiceSelect';
import { useConfirmation } from './ConfirmationDialog';
import PromptBar from './react-bits/PromptBar';
import { ComposerVisual } from '../ai/ComposerVisual';
import { DraftAttachmentCard, visualAttachmentLabel } from '../ai/DraftAttachmentCard';
import { AIVisibilityContext, IDLE_AI_ACTIVITY, type AIActivity } from '../ai/AIVisibility';
import { useRetainedDialogValue } from '../ai/useRetainedDialogValue';
import { PanelSettings } from '../ai/PanelSettings';
import { PanelSettingsPage } from '../ai/PanelSettingsPage';
import { ModelChoice } from '../ai/ModelChoice';
import { VoiceCapture } from './VoiceCapture';
import {
  prepareGenerationDraft,
  type GenerationDraftInput,
  type ReferenceCopyJournal,
} from './generationDraft';
import { AIThread, type CollageResultActions } from '../ai/AIThread';
import type { OnResultApplied } from '../ai/ResultActions';
import { recipeDifferences, additionalRecipeChanges } from '../ai/recipeDiff';
import { ImageParameters } from '../ai/ImageParameters';
import { LiveAssistant, type CaptureCurrentImage } from '../ai/LiveAssistant';
import {
  acceptJobSubmission,
  clearJobSubmission,
  freezeJobSubmission,
  isJobAdmissionRejected,
  jobSubmissionRequest,
  jobSubmissionResolved,
  readJobSubmission,
  saveJobSubmission,
  type JobSubmission,
} from '../ai/jobSubmission';
import {
  allowedImageSizes,
  imageBatchError,
  defaultImageOptions,
  imageOptionsError,
  imagePointQuote,
  imageSizeError,
  requestImageOptions,
  reconcileImageOptions,
} from '../ai/capabilities';
import type {
  AIOperation,
  AIJob,
  AIModel,
  GeneratedImage,
  ImageOptions,
  ModelResponse,
} from '../ai/types';
export type { AIOperation } from '../ai/types';

const tasks = [
  {
    id: 'edit-plan' as const,
    label: '调整',
    icon: <SlidersHorizontal size={18} />,
    placeholder: '想更柔和、提亮阴影，还是保留更多细节？',
    button: '生成调整建议',
    hint: '只发送文字与配方，照片不外传',
    chips: ['让光线柔和一点', '提亮阴影，保留高光', '降低饱和度，更自然'],
  },
  {
    id: 'generate-image' as const,
    label: '生图',
    icon: <ImageSquare size={18} />,
    placeholder: '描述画面，或加一张参考图继续创作…',
    button: '生成图片',
    hint: '仅发送本轮明确选择的参考图',
    chips: ['按参考图构图，保持自然光', '改为简洁的手绘风格', '保留主体，换成纯色背景'],
  },
  {
    id: 'generate-text' as const,
    label: '文案',
    icon: <FileText size={18} />,
    placeholder: '写标题、介绍，或继续润色上一版…',
    button: '生成文案',
    hint: '仅发送文字与已选上下文',
    chips: ['给这件作品写三个标题', '把语气改得简洁自然', '写一段适合分享的作品介绍'],
  },
  {
    id: 'transcribe' as const,
    label: '转文字',
    icon: <Microphone size={18} />,
    placeholder: '',
    button: '确认发送语音',
    hint: '录音先在本机，确认后识别',
    chips: [],
  },
  { id: 'speak' as const, label: specialistTaskLabels.speak, icon: <SpeakerHigh size={18} />, placeholder: '输入要朗读的文字…', button: '生成朗读', hint: '生成可下载的 AI 朗读音频', chips: [] },
  { id: 'audio-chat' as const, label: specialistTaskLabels['audio-chat'], icon: <Waveform size={18} />, placeholder: '输入问题，可附上录音…', button: '提交音频问答', hint: '选择文字或语音回答', chips: [] },
  { id: 'web-search' as const, label: specialistTaskLabels['web-search'], icon: <MagnifyingGlass size={18} />, placeholder: '输入要公开搜索的问题…', button: '发起联网搜索', hint: '将输入的问题用于公开搜索', chips: [] },
  { id: 'embed' as const, label: specialistTaskLabels.embed, icon: <Hash size={18} />, placeholder: '输入要转换成向量的文字…', button: '生成向量', hint: '可复制浮点数组或 Base64 向量', chips: [] },
  { id: 'translate-audio' as const, label: specialistTaskLabels['translate-audio'], icon: <Translate size={18} />, placeholder: '', button: '确认翻译语音', hint: '确认后发送录音并返回译文与译音', chips: [] },
];
interface AIPanelDraft {
  prompt: string;
  operation: AIOperation;
  assistantOpen: boolean;
  modelId: string;
  width: number;
  height: number;
  imageOptions: ImageOptions;
  transcriptionOptions?: Record<string, FileTranscriptionOptions>;
  specialistSettings?: Record<string, Record<string, string | number>>;
  referenceIds: string[];
  parentJobId: string | null;
  threadId: string | null | 'recent';
  documentId: string;
  generationGrantId?: string;
  auxiliary: { kind: 'mask' | 'markup'; assetId: string } | null;
}
// Scoped in-memory drafts contain text, settings and asset ids, never image bytes.
const draftCache = new Map<string, AIPanelDraft>();
function initialRecovery(actorId: string | null) {
  if (!actorId) return { pending: null, ready: false, error: null };
  try {
    return { pending: readJobSubmission(sessionStorage, actorId), ready: true, error: null };
  } catch (error) {
    return { pending: null, ready: false, error: errorMessage(error) };
  }
}
export function AIPanel({
  project,
  artwork,
  recipe,
  config,
  userId = null,
  projectAssets = [],
  currentAsset = null,
  initialOperation = 'edit-plan',
  referenceFile,
  referenceSource = 'sketch',
  onReferenceFile,
  onClearReference,
  onDraw,
  onClose,
  visible = true,
  mobilePage = false,
  visualAttachment,
  onClearVisualAttachment,
  onActivityChange,
  onPreview,
  previewActive,
  onConfirmPreview,
  onCancelPreview,
  onSave,
  onExport,
  onTopUp,
  voiceEntry = 0,
  onCreateProject,
  onOpenArtwork,
  onTaskChanged,
  onDecisionApplied,
  isDirty = true,
  isLoggedIn,
  onAuth,
  captureCurrentImage,
  captureReferenceCanvas,
  referenceCanvasLabel = '用当前编辑图',
  onUseCanvasSource,
  collageActions,
  generationRequest,
  returnLabel,
  onBeforeArtworkWrite,
  onAfterArtworkWrite,
}: {
  project: Project | null;
  artwork: Artwork | null;
  recipe: EditorRecipe;
  config: PublicConfig | null;
  userId?: string | null;
  projectAssets?: Asset[];
  currentAsset?: Asset | null;
  initialOperation?: AIOperation;
  referenceFile: File | null;
  referenceSource?: 'sketch' | 'upload';
  onReferenceFile?: (file: File, source: 'sketch' | 'upload') => void;
  onClearReference: () => void;
  onDraw: () => void;
  onClose: () => void;
  visible?: boolean;
  mobilePage?: boolean;
  visualAttachment?: AssistantVisualAttachment | null;
  onClearVisualAttachment?: (attachment: AssistantVisualAttachment) => void;
  onActivityChange?: (activity: AIActivity) => void;
  onPreview: (recipe: EditorRecipe) => void;
  previewActive?: boolean;
  onConfirmPreview?: () => void;
  onCancelPreview?: () => void;
  onSave: () => void;
  onExport?: () => void;
  onTopUp?: () => void;
  voiceEntry?: number;
  onCreateProject: () => void;
  onOpenArtwork: (id: string) => void;
  onTaskChanged: () => void;
  onDecisionApplied?: OnResultApplied;
  isDirty?: boolean;
  isLoggedIn: boolean;
  onAuth: () => void;
  captureCurrentImage?: CaptureCurrentImage;
  captureReferenceCanvas?: () => Promise<File>;
  referenceCanvasLabel?: string;
  onUseCanvasSource?: (item: AssistantCloudResource) => void;
  collageActions?: CollageResultActions;
  generationRequest?: string;
  returnLabel?: string;
  onBeforeArtworkWrite?: () => void | Promise<void>;
  onAfterArtworkWrite?: () => void | Promise<void>;
}) {
  const scope = (userId ?? 'local') + ':' + (project?.id ?? 'none');
  const { confirm, cancel: cancelConfirmation, dialog: confirmationDialog } = useConfirmation();
  const cached = draftCache.get(scope);
  const [recovery, setRecovery] = useState(() => initialRecovery(userId));
  const pendingSubmission = recovery.pending;
  const pending = useRef<JobSubmission | null>(pendingSubmission);
  const mounted = useRef(true);
  const [assistantOpen, setAssistantOpen] = useState(
    !pendingSubmission &&
      !referenceFile &&
      (Boolean(visualAttachment) || (cached?.assistantOpen ?? initialOperation === 'edit-plan')),
  );
  const [uploadForAssistant, setUploadForAssistant] = useState<{
    file: File;
    attachment: AssistantVisualAttachment;
  } | null>(null);
  useEffect(() => {
    if (!assistantOpen || !referenceFile || visualAttachment) return;
    let active = true;
    void captureSketchVisual(referenceFile, referenceSource === 'sketch' ? 'sketch' : 'photo')
      .then((attachment) => { if (active) setUploadForAssistant({ file: referenceFile, attachment }); })
      .catch(() => { if (active) setError(t('无法读取参考图，请重新选择。')); });
    return () => { active = false; };
  }, [assistantOpen, referenceFile, referenceSource, visualAttachment]);
  const [assistantVisited, setAssistantVisited] = useState(assistantOpen);
  const lastVoiceEntry = useRef(0);
  useEffect(() => {
    if (voiceEntry > lastVoiceEntry.current && !pendingSubmission) setAssistantOpen(true);
    lastVoiceEntry.current = voiceEntry;
  }, [voiceEntry, pendingSubmission]);
  const panel = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!mobilePage || !visible) return;
    panel.current
      ?.querySelector<HTMLButtonElement>('[data-ai-return]:not([inert] *)')
      ?.focus({ preventScroll: true });
  }, [mobilePage, visible]);
  useEffect(() => {
    if (assistantOpen) setAssistantVisited(true);
  }, [assistantOpen]);
  const [overlay, setOverlay] = useState<
    'tasks' | 'settings' | 'references' | 'history' | 'recovery' | null
  >(null);
  const [assistantActivity, setAssistantActivity] = useState<AIActivity>(IDLE_AI_ACTIVITY);
  const [capturingReference, setCapturingReference] = useState(false);
  const referenceCaptureLock = useRef(false);
  const assistantLocked = assistantActivity.requestActive;
  const [generationGrantId, setGenerationGrantId] = useState<string | undefined>(
    cached?.generationGrantId,
  );
  const [modelResponse, setModelResponse] = useState<ModelResponse | null>(null);
  const [modelId, setModelId] = useState(
    pendingSubmission && pendingSubmission.projectId === project?.id
      ? pendingSubmission.modelId
      : (cached?.modelId ?? ''),
  );
  const [operation, setOperation] = useState<AIOperation>(
    pendingSubmission && pendingSubmission.projectId === project?.id
      ? pendingSubmission.operation
      : referenceFile
        ? 'generate-image'
        : (cached?.operation ?? initialOperation),
  );
  const [prompt, setPrompt] = useState(
    pendingSubmission && pendingSubmission.projectId === project?.id && !pendingSubmission.jobId
      ? pendingSubmission.prompt
      : (cached?.prompt ?? ''),
  );
  const [jobs, setJobs] = useState<AIJob[]>([]);
  const [threadId, setThreadId] = useState<string | null | 'recent'>(cached?.threadId ?? 'recent');
  const [parentJobId, setParentJobId] = useState<string | null>(cached?.parentJobId ?? null);
  const [candidate, setCandidate] = useState<{
    recipe: EditorRecipe;
    job: AIJob;
    snapshot: string;
  } | null>(null);
  const displayedCandidate = useRetainedDialogValue(candidate);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [idempotency, setIdempotency] = useState(() => secureUuid());
  const [width, setWidth] = useState(cached?.width ?? 2048),
    [height, setHeight] = useState(cached?.height ?? 2048);
  const [imageOptions, setImageOptions] = useState<ImageOptions>(cached?.imageOptions ?? {});
  const previousModel = useRef(cached?.modelId ?? '');
  const appliedCapabilityKey = useRef('');
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const [transcriptionOptions, setTranscriptionOptions] = useState<Record<string, FileTranscriptionOptions>>(cached?.transcriptionOptions ?? {});
  const [specialistSettings, setSpecialistSettings] = useState<Record<string, Record<string, string | number>>>(cached?.specialistSettings ?? {});
  const [voiceEpoch, setVoiceEpoch] = useState(0);
  const [referenceIds, setReferenceIds] = useState<string[]>(cached?.referenceIds ?? []);
  const [uploadedReference, setUploadedReference] = useState<{ file: File; asset: Asset } | null>(null);
  const [visualReference, setVisualReference] = useState<{
    attachment: AssistantVisualAttachment;
    file: File | null;
  } | null>(null);
  const currentVisualReference = visualReference?.attachment === visualAttachment
    ? visualReference
    : null;
  const selectedReferenceFile = referenceFile ?? currentVisualReference?.file ?? null;
  const selectedReferenceSource = referenceFile ? referenceSource : 'upload';
  const selectedReferenceLabel =
    !referenceFile && currentVisualReference?.file
      ? visualAttachmentLabel(currentVisualReference.attachment.kind)
      : t(selectedReferenceSource === 'sketch' ? '草图' : '参考图');
  const [preparedReferenceAssets, setPreparedReferenceAssets] = useState<Asset[]>([]);
  const [preparingDraft, setPreparingDraft] = useState(false);
  const activityReporter = useRef(onActivityChange);
  activityReporter.current = onActivityChange;
  useEffect(() => {
    onActivityChange?.({
      ...assistantActivity,
      requestActive: assistantActivity.requestActive || busy || preparingDraft,
    });
  }, [assistantActivity, busy, preparingDraft, onActivityChange]);
  useEffect(() => () => activityReporter.current?.(IDLE_AI_ACTIVITY), []);
  useEffect(() => {
    if (!visible) setOverlay(null);
  }, [visible]);
  const [auxiliary, setAuxiliary] = useState<{ kind: 'mask' | 'markup'; assetId: string } | null>(
    cached?.auxiliary ?? null,
  );
  const [documents, setDocuments] = useState<{ id: string; title: string; version: number }[]>([]);
  const [documentId, setDocumentId] = useState(cached?.documentId ?? '');
  const fileInput = useRef<HTMLInputElement>(null);
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const submitLock = useRef(false);
  const generation = useRef(0);
  const generationDraftEpoch = useRef(0);
  const handledGenerationRequest = useRef<string | undefined>(undefined);
  const referenceCopies = useRef<ReferenceCopyJournal>(new Map());
  const panelContext = useRef({ scope, assistantOpen });
  panelContext.current = { scope, assistantOpen };
  const consentIdentity = JSON.stringify([
    userId,
    isLoggedIn,
    project?.id,
    project?.spaceId,
    project?.role,
    artwork?.id,
    artwork?.assetId,
    artwork?.headVersion,
    currentAsset?.id,
    currentAsset?.projectId,
    recipe,
  ]);
  const consentContext = useRef({
    identity: consentIdentity,
    referenceFile: selectedReferenceFile,
    referenceSource: selectedReferenceSource,
    visible,
  });
  // Keep a distinct lifetime even if the user leaves an artwork and returns to
  // the same values while a question is open. Unrelated renders do not revoke it.
  if (
    consentContext.current.identity !== consentIdentity ||
    consentContext.current.referenceFile !== selectedReferenceFile ||
    consentContext.current.referenceSource !== selectedReferenceSource ||
    consentContext.current.visible !== visible
  )
    consentContext.current = {
      identity: consentIdentity,
      referenceFile: selectedReferenceFile,
      referenceSource: selectedReferenceSource,
      visible,
    };
  const previewPending = useRef(false);
  useLayoutEffect(() => {
    if (!visible) cancelConfirmation();
  }, [visible, cancelConfirmation]);
  const submittedRecipes = useRef(new Map<string, string>());
  const draftValue: AIPanelDraft = {
    prompt,
    operation,
    assistantOpen,
    modelId,
    width,
    height,
    imageOptions,
    transcriptionOptions,
    specialistSettings,
    referenceIds,
    parentJobId,
    threadId,
    documentId,
    generationGrantId,
    auxiliary,
  };
  const draft = useRef(draftValue);
  draft.current = draftValue;
  const taskChanged = useRef(onTaskChanged);
  taskChanged.current = onTaskChanged;
  const inputLocked = busy || !!pendingSubmission || (isLoggedIn && !recovery.ready);
  const selected = (modelResponse?.models ?? []).find((model) => model.id === modelId);
  const eligible = (modelResponse?.models ?? []).filter(
    (model) => model.enabled !== false && (model.operations ?? ['edit-plan']).includes(operation),
  );
  const modelReady = (model?: AIModel) =>
    model?.runtimeAvailable === true && model.runtimeOperations?.includes(operation) === true;
  const opStatus = modelResponse?.operationStatus?.[operation];
  const enabled =
    opStatus?.available ??
    modelResponse?.availableOperations?.includes(operation) ??
    (operation === 'edit-plan' && !!modelResponse?.executionEnabled);
  const ready = !!enabled && modelReady(selected);
  const sourceTask = tasks.find((item) => item.id === operation)!;
  const task = {
    ...sourceTask,
    label: t(sourceTask.label),
    placeholder: t(sourceTask.placeholder),
    button: t(sourceTask.button),
    hint: t(sourceTask.hint),
    chips: sourceTask.chips.map((chip) => t(chip)),
  };
  const caps = selected?.parameterCapabilities;
  const sizeFailure =
    operation === 'generate-image' && imageOptions.size !== 'auto' ? imageSizeError(selected, width, height, imageOptions) : null;
  const optionsFailure =
    operation === 'generate-image' ? imageOptionsError(selected, imageOptions) : null;
  const batchFailure =
    operation === 'generate-image' ? imageBatchError(selected, width, height, imageOptions) : null;
  const quote =
    operation === 'generate-image'
      ? imagePointQuote(selected, imageOptions)
      : (selected?.pointsPerPlan ?? null);
  const needsArtwork = operation === 'edit-plan';
  const parent = jobs.find((job) => job.id === parentJobId);
  const referencedCount = referenceIds.length + (selectedReferenceFile ? 1 : 0);
  const referenceLimit = caps?.references.maxCount ?? 0;
  const referenceFailure =
    operation === 'generate-image' && referencedCount
      ? imageOptions.outputFormat === 'svg'
        ? t('SVG 仅支持文字生图。')
        : !caps?.references.supported || referencedCount > referenceLimit
          ? t('当前模型最多支持 {count} 张参考图，请移除多余参考或切换模型。', { count: referenceLimit })
          : null
      : null;
  const reason =
    selected?.runtimeReason ||
    opStatus?.reason ||
    modelResponse?.reason ||
    config?.capabilities.aiUnavailableReason ||
    '服务尚未开放当前任务';
  const needsContext = !isLoggedIn
    ? 'login'
    : !project
      ? 'project'
      : needsArtwork && !artwork
        ? 'artwork'
        : null;
  const statusText =
    needsContext === 'login'
      ? t('登录后保存 AI 创作')
      : needsContext === 'project'
        ? t('先选择一个保存项目')
        : needsContext === 'artwork'
          ? t('先保存当前作品版本')
          : loading
            ? t('正在读取模型能力')
            : ready
              ? t('已准备好')
              : t('{task}暂未开通', { task: task.label });
  const fileOptions = selected?.provider === 'openai' ? transcriptionOptions[modelId] ?? {} : {};
  const validFileOptions = fileTranscriptionOptionsSchema.safeParse(fileOptions);
  const transcriptionOptionsReady = validFileOptions.success && supportsFileTranscriptionOptions(modelId, validFileOptions.data);
  const specialist = Object.hasOwn(specialistTaskLabels, operation) ? operation as OpenAISpecialistOperation : undefined;
  const audioOnly = operation === 'transcribe' || operation === 'translate-audio';
  const needsRecording = audioOnly || operation === 'audio-chat';
  const promptLimit = operation === 'generate-image' ? 4000
    : operation === 'speak' || operation === 'embed' ? 4096 : 1500;
  const specialistOptions = specialist ? specialistSettings[modelId] ?? specialistDefaults(specialist) : {};
  const { city, country, region, timezone, ...searchOptions } = specialistOptions;
  const location = Object.fromEntries(Object.entries({ city, country, region, timezone }).filter(([, value]) => value !== undefined));
  const checkedSpecialist = specialist && ({
    speak: openAISpeechOptionsSchema,
    'audio-chat': openAIAudioChatOptionsSchema,
    'web-search': openAISearchOptionsSchema,
    embed: openAIEmbeddingOptionsSchema,
    'translate-audio': openAITranslationOptionsSchema,
  }[specialist].safeParse(specialist === 'web-search'
    ? { ...searchOptions, ...(Object.keys(location).length ? { location } : {}) }
    : specialistOptions));
  const audioChatNeedsRecording = operation === 'audio-chat' && specialistOptions.output === 'text' && !audioBase64;
  const canSubmit =
    !busy &&
    recovery.ready &&
    !pendingSubmission &&
    quote !== null &&
    !!project &&
    ready &&
    (!needsArtwork || !!artwork) &&
    (audioOnly ? !!audioBase64 : !!prompt.trim()) &&
    (operation !== 'transcribe' || transcriptionOptionsReady) &&
    (!checkedSpecialist || checkedSpecialist.success) &&
    !audioChatNeedsRecording &&
    !sizeFailure &&
    !optionsFailure &&
    !batchFailure &&
    (operation !== 'generate-image' ||
      (referencedCount <= referenceLimit && (!referencedCount || !!caps?.references.supported)));
  const allThreads = Array.from(new Set(jobs.map((job) => job.threadId ?? job.id)));
  const visibleThread = threadId === 'recent' ? (allThreads[0] ?? null) : threadId;
  const visibleJobs = jobs
    .filter((job) => (job.threadId ?? job.id) === visibleThread)
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  function changed() {
    if (pending.current) return;
    setIdempotency(secureUuid());
    setError(null);
  }
  function rememberSubmission(value: JobSubmission) {
    saveJobSubmission(sessionStorage, value);
    pending.current = value;
    if (mounted.current) setRecovery({ pending: value, ready: true, error: null });
  }
  function resolveSubmission(value: JobSubmission) {
    clearJobSubmission(sessionStorage, value);
    if (pending.current?.idempotencyKey !== value.idempotencyKey) return;
    pending.current = null;
    if (mounted.current) {
      setRecovery({ pending: null, ready: true, error: null });
      setIdempotency(secureUuid());
    }
  }
  function rememberReceipt(saved: JobSubmission, job: AIJob) {
    const accepted = acceptJobSubmission(saved, job);
    rememberSubmission(accepted);
    if (jobSubmissionResolved(job.state)) resolveSubmission(accepted);
    const key = `${saved.actorId}:${saved.projectId}`;
    const old = draftCache.get(key);
    if (old?.prompt.trim() === saved.prompt) draftCache.set(key, { ...old, prompt: '' });
    if (draft.current.prompt.trim() === saved.prompt)
      draft.current = { ...draft.current, prompt: '' };
    return accepted;
  }
  function restoreRecovery() {
    const previous = pending.current;
    const next = initialRecovery(userId);
    pending.current = next.pending;
    setRecovery(next);
    if (next.ready && !next.pending && previous) {
      const savedDraft = draftCache.get(scope);
      if (savedDraft && savedDraft.prompt !== previous.prompt)
        setPrompt((old) => (old.trim() === previous.prompt ? savedDraft.prompt : old));
    }
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      draftCache.set(scope, draft.current);
      if (draftCache.size > 20) draftCache.delete(draftCache.keys().next().value!);
      generation.current += 1;
    };
  }, [scope]);
  useEffect(() => {
    if (!isLoggedIn || !visible) return;
    const controller = new AbortController();
    let refreshing = false;
    let lastRead = -Infinity;
    async function refreshModels() {
      if (refreshing || controller.signal.aborted || document.visibilityState === 'hidden') return;
      if (Date.now() - lastRead < 15_000) return;
      refreshing = true;
      setLoading(true);
      setCatalogError('');
      lastRead = Date.now();
      try {
        const result = await readModelCatalog<ModelResponse>('/models', controller.signal);
        if (!controller.signal.aborted) setModelResponse(result);
      } catch (failure) {
        if (!controller.signal.aborted) setCatalogError(errorMessage(failure));
      } finally {
        refreshing = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void refreshModels();
    const refreshModelsOnFocus = () => void refreshModels();
    const interval = window.setInterval(refreshModelsOnFocus, 60_000);
    window.addEventListener('focus', refreshModelsOnFocus);
    document.addEventListener('visibilitychange', refreshModelsOnFocus);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshModelsOnFocus);
      document.removeEventListener('visibilitychange', refreshModelsOnFocus);
    };
  }, [isLoggedIn, visible, catalogAttempt]);
  useEffect(() => {
    if (!modelResponse || pending.current || busy || preparingDraft) return;
    if (!eligible.some((model) => model.id === modelId))
      setModelId(eligible.find(modelReady)?.id ?? eligible[0]?.id ?? '');
  }, [operation, modelResponse, modelId, pendingSubmission, busy, preparingDraft]);
  const selectedCapabilityKey = JSON.stringify([
    modelId,
    selected?.parameterCapabilities,
    selected?.minWidth,
    selected?.maxWidth,
    selected?.minHeight,
    selected?.maxHeight,
    selected?.minPixels,
    selected?.maxPixels,
    selected?.maxDimension,
    selected?.minAspectRatio,
    selected?.maxAspectRatio,
  ]);
  useEffect(() => {
    if (
      !selected ||
      pending.current ||
      busy ||
      preparingDraft ||
      appliedCapabilityKey.current === selectedCapabilityKey
    )
      return;
    appliedCapabilityKey.current = selectedCapabilityKey;
    const changedModel = modelId !== previousModel.current;
    previousModel.current = modelId;
    setImageOptions((current) => {
      const next = changedModel
        ? defaultImageOptions(selected)
        : reconcileImageOptions(selected, current);
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
    const allowed = allowedImageSizes(selected);
    if (imageSizeError(selected, width, height) && allowed[0]) {
      setWidth(allowed[0].width);
      setHeight(allowed[0].height);
    }
    setAuxiliary((current) => {
      if (!current) return current;
      const references = selected.parameterCapabilities?.references;
      const supported =
        references?.supported &&
        (current.kind === 'mask' ? references.allowMask : references.allowMarkup);
      return changedModel || !supported ? null : current;
    });
    changed();
  }, [selectedCapabilityKey, pendingSubmission, busy, preparingDraft]);
  useEffect(() => {
    if (referenceFile && !pending.current) {
      setAssistantOpen(false);
      setOperation('generate-image');
      changed();
    }
  }, [referenceFile]);
  useEffect(() => {
    if (visualAttachment && !pending.current) {
      setOverlay(null);
      setAssistantOpen(true);
    }
  }, [visualAttachment]);
  useEffect(() => {
    if (
      !visible ||
      !generationRequest ||
      handledGenerationRequest.current === generationRequest ||
      inputLocked ||
      assistantLocked ||
      preparingDraft
    )
      return;
    handledGenerationRequest.current = generationRequest;
    setOverlay(null);
    if (operation !== 'generate-image') changeOperation('generate-image');
    setAssistantOpen(false);
  }, [visible, generationRequest, inputLocked, assistantLocked, preparingDraft, operation]);
  useEffect(() => {
    if (!project) {
      setJobs([]);
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let live = true;
    let digest = '';
    const load = async () => {
      try {
        const result = await api<{ jobs: AIJob[] }>('/projects/' + project.id + '/ai-jobs', {
          signal: controller.signal,
        });
        if (!live) return;
        const saved = pending.current;
        if (saved?.projectId === project.id && saved.jobId) {
          const receipt = result.jobs.find((job) => job.id === saved.jobId);
          if (receipt && (receipt.state !== saved.state || jobSubmissionResolved(receipt.state))) {
            rememberReceipt(saved, receipt);
            setPrompt((old) => (old.trim() === saved.prompt ? '' : old));
          }
        }
        setJobs(result.jobs);
        const next = result.jobs.map((job) => job.id + ':' + job.state).join('|');
        if (digest && next !== digest) taskChanged.current();
        digest = next;
        if (result.jobs.some((job) => job.state === 'queued' || job.state === 'running'))
          timer = setTimeout(load, 2000);
      } catch (error) {
        if (live && (error as Error).name !== 'AbortError') setError(errorMessage(error));
      }
    };
    void load();
    return () => {
      live = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [project?.id, refresh]);
  useEffect(() => {
    if (!project) return;
    let live = true;
    api<{ documents: { id: string; title: string; version: number }[] }>(
      '/projects/' + project.id + '/documents',
    )
      .then((result) => live && setDocuments(result.documents))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [project?.id, refresh]);
  const audioReady = useCallback((value: string | null) => {
    if (pending.current) return;
    setAudioBase64(value);
    setIdempotency(secureUuid());
  }, []);
  function useVisualReference(attachment: AssistantVisualAttachment) {
    if (visualReference?.attachment === attachment) return;
    // Keep the captured image local until the user submits the image task.
    const [header, encoded] = attachment.imageDataUrl.split(',', 2);
    const format = header?.match(/^data:image\/(jpeg|png|webp);base64$/)?.[1];
    if (!format || !encoded) return;
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    const type = 'image/' + format;
    const name = attachment.kind + '.' + format;
    setVisualReference({ attachment, file: new File([bytes], name, { type }) });
  }
  function dismissVisualReference() {
    setVisualReference(visualAttachment ? { attachment: visualAttachment, file: null } : null);
  }
  function changeOperation(next: AIOperation) {
    if (pending.current) return;
    setGenerationGrantId(undefined);
    generationDraftEpoch.current += 1;
    setOperation(next);
    setAudioBase64(null);
    setVoiceEpoch((value) => value + 1);
    setParentJobId(null);
    changed();
  }
  async function prepareAssistantGenerationDraft(input: GenerationDraftInput) {
    if (!project || !isLoggedIn || !userId) throw new Error('请先登录并选择草案要保存的项目。');
    const expectedScope = scope;
    const expectedGeneration = generation.current;
    const expectedEpoch = ++generationDraftEpoch.current;
    const expectedContext = consentContext.current;
    const expectedInput = JSON.stringify(input);
    let copiedAny = false;
    const assertCurrent = () => {
      if (
        !mounted.current ||
        !consentContext.current.visible ||
        consentContext.current !== expectedContext ||
        JSON.stringify(input) !== expectedInput ||
        generation.current !== expectedGeneration ||
        generationDraftEpoch.current !== expectedEpoch ||
        panelContext.current.scope !== expectedScope ||
        !panelContext.current.assistantOpen
      )
        throw new Error('当前项目、来源或草稿已变化，请回到原草案后再继续。');
    };
    setPreparingDraft(true);
    try {
      return await prepareGenerationDraft(input, {
        actorScope: userId,
        projectId: project.id,
        journal: referenceCopies.current,
        assertCurrent,
        makeId: (sourceId) => {
          let storage: Storage | undefined;
          try {
            storage = window.sessionStorage;
          } catch {
            // The shared copy helper keeps an in-memory identity in private mode.
          }
          return assetCopyAttempt(userId, sourceId, project.id, storage).idempotencyKey;
        },
        loadProjectAssets: async () =>
          (await api<{ assets: Asset[] }>('/projects/' + project.id)).assets,
        confirmCopy: (count) =>
          confirm({
            title: t('复制草案参考图'),
            description: t(
              '这份草案引用的 {count} 张图片需独立复制到“{project}”，副本会占用目标空间的素材与存储额度。已有副本由服务器核验后复用，不重复占用。\n\n复制需要来源授权；若授权或空间不足，将保留草案供重试，不会丢弃任何参考图。已完成的独立副本会留在目标项目，不会随草案取消而自动删除。',
              { count, project: project.title },
            ),
            confirmLabel: t('确认复制并继续'),
          }),
        copyAsset: async (sourceId, idempotencyKey) => {
          const result = await api<{ asset: Asset; copy: AssetCopyRecord }>(
            '/assets/' + encodeURIComponent(sourceId) + '/copy',
            jsonRequest('POST', { targetProjectId: project.id, idempotencyKey }),
          );
          copiedAny = true;
          return result;
        },
        onAssetReady: (asset) => {
          setPreparedReferenceAssets((previous) => [
            ...previous.filter((item) => item.id !== asset.id),
            asset,
          ]);
        },
        commit: (prepared) => {
          // No image request is sent here. The user still chooses a model and
          // its supported parameters before explicitly submitting generation.
          onClearReference();
          dismissVisualReference();
          setUploadedReference(null);
          setAuxiliary(null);
          setReferenceIds(prepared.referenceAssetIds);
          setThreadId(null);
          changeOperation('generate-image');
          setGenerationGrantId(prepared.executionGrantId);
          setPrompt(prepared.prompt);
          setAssistantOpen(false);
        },
      });
    } finally {
      if (
        generation.current === expectedGeneration &&
        panelContext.current.scope === expectedScope &&
        generationDraftEpoch.current === expectedEpoch
      ) {
        setPreparingDraft(false);
        if (copiedAny) taskChanged.current();
      }
    }
  }
  async function chooseLocal(file: File | undefined) {
    if (!file || !onReferenceFile) return;
    const expected = consentContext.current;
    try {
      const limit = Math.min(
        config?.limits.maxUploadBytes ?? 20 * 1024 * 1024,
        caps?.references.maxBytes ?? 20 * 1024 * 1024,
      );
      if (file.size > limit) throw new Error('参考图超过当前上传或模型字节限制。');
      const header = readImageHeader(
        new Uint8Array(await file.slice(0, MAX_HEADER_BYTES).arrayBuffer()),
        { maxPixels: config?.media?.maxPixels ?? 40_000_000, maxDimension: 16384 },
      );
      if (header.animated || !['png', 'jpeg', 'webp'].includes(header.format))
        throw new Error('AI参考请选择已确认的静态 PNG、JPEG 或 WebP。');
      if (!mounted.current || consentContext.current !== expected || pending.current) return;
      dismissVisualReference();
      onReferenceFile(new File([file], file.name, { type: 'image/' + header.format }), 'upload');
    } catch (error) {
      setError(errorMessage(error));
    }
  }
  async function useEditedFrame() {
    if (!captureReferenceCanvas || referenceCaptureLock.current) return;
    const expected = consentContext.current;
    referenceCaptureLock.current = true;
    setCapturingReference(true);
    setError('');
    try {
      const file = await captureReferenceCanvas();
      if (mounted.current && consentContext.current === expected) await chooseLocal(file);
    } catch (error) {
      if (mounted.current && consentContext.current === expected) setError(errorMessage(error));
    } finally {
      referenceCaptureLock.current = false;
      if (mounted.current) setCapturingReference(false);
    }
  }
  function continueJob(job: AIJob, image?: GeneratedImage) {
    if (pending.current || !recovery.ready) {
      setError('上一轮创作结果仍待确认，请先恢复原请求，再继续新的创作。');
      return;
    }
    if (job.state !== 'completed') return;
    const next = job.operation ?? 'edit-plan';
    setOperation(next);
    setParentJobId(job.id);
    setThreadId(job.threadId ?? job.id);
    setModelId(job.modelId);
    setPrompt('');
    if (image) {
      setReferenceIds([image.assetId]);
      setAuxiliary(null);
      onClearReference();
      dismissVisualReference();
    }
    changed();
    setTimeout(() => promptInput.current?.focus(), 0);
  }
  async function submit() {
    if (!canSubmit || !project || !userId || pending.current || submitLock.current) return;
    submitLock.current = true;
    setBusy(true);
    setError(null);
    const expectedGeneration = generation.current;
    try {
      const snapshot = JSON.stringify(recipe);
      const body: Record<string, unknown> = { operation, modelId, idempotencyKey: idempotency };
      if (parentJobId) body.parentJobId = parentJobId;
      if (operation === 'edit-plan') {
        if (!artwork) throw new Error('请先保存当前作品。');
        Object.assign(body, {
          prompt: prompt.trim(),
          artworkId: artwork.id,
          expectedVersion: artwork.headVersion,
          recipe,
        });
      } else if (operation === 'generate-image') {
        Object.assign(body, { prompt: prompt.trim(), width, height });
        if (generationGrantId) body.executionGrantId = generationGrantId;
        const options = requestImageOptions(selected, imageOptions);
        if (options && !referencedCount) delete options.inputFidelity;
        if (options) body.imageOptions = options;
        const ids = [...referenceIds];
        if (selectedReferenceFile) {
          if (selectedReferenceFile.size > Math.min(
            config?.limits.maxUploadBytes ?? 20 * 1024 * 1024,
            caps?.references.maxBytes ?? 20 * 1024 * 1024,
          )) throw new Error('参考图超过当前云端上传限制。');
          let asset = uploadedReference?.file === selectedReferenceFile ? uploadedReference.asset : null;
          if (!asset) {
            const form = new FormData();
            form.append('file', selectedReferenceFile);
            asset = (
              await api<{ asset: Asset }>(
                '/projects/' + project.id + '/assets?source=' + selectedReferenceSource,
                { method: 'POST', body: form },
              )
            ).asset;
            if (expectedGeneration !== generation.current) return;
            setUploadedReference({ file: selectedReferenceFile, asset });
          }
          ids.push(asset.id);
        }
        if (ids.length) {
          if (selected?.provider === 'openai') body.referenceAssetIds = ids;
          else body.referenceAssetId = ids[0];
        }
        if (auxiliary) {
          if (!ids.length) throw new Error('遮罩或标注需要先选择参考图。');
          body[auxiliary.kind === 'mask' ? 'maskAssetId' : 'markupAssetId'] = auxiliary.assetId;
        }
      } else if (operation === 'generate-text') {
        body.prompt = prompt.trim();
        const doc = documents.find((item) => item.id === documentId);
        if (doc) {
          body.contextDocumentId = doc.id;
          body.expectedDocumentVersion = doc.version;
        }
      } else if (operation === 'transcribe') {
        if (!audioBase64) throw new Error('请先录制一段语音。');
        body.audioBase64 = audioBase64;
        if (validFileOptions.success && Object.values(validFileOptions.data).some((value) => value !== undefined))
          body.transcriptionOptions = validFileOptions.data;
      } else if (checkedSpecialist?.success) {
        if (!audioOnly) body.prompt = prompt.trim();
        if (needsRecording && audioBase64) body.audioBase64 = audioBase64;
        body.options = checkedSpecialist.data;
      }
      if (expectedGeneration !== generation.current) return;
      const frozen = freezeJobSubmission({
        actorId: userId,
        projectId: project.id,
        projectTitle: project.title,
        body,
        recipeSnapshot: snapshot,
      });
      rememberSubmission(frozen);
      await runSubmission(frozen, expectedGeneration, true);
    } catch (error) {
      if (expectedGeneration === generation.current) setError(errorMessage(error));
    } finally {
      submitLock.current = false;
      if (expectedGeneration === generation.current) setBusy(false);
    }
  }
  async function runSubmission(
    saved: JobSubmission,
    expectedGeneration: number,
    firstAttempt = false,
  ) {
    let job: AIJob;
    try {
      const request = jobSubmissionRequest(saved);
      if (saved.jobId) {
        const result = await api<{ jobs: AIJob[] }>(request.path, request.init);
        const found = result.jobs.find((item) => item.id === saved.jobId);
        if (!found)
          throw new Error(
            '最近 100 条项目记录中没有找到本轮任务。已保留原请求，请在用量记录中核对或联系平台；不会创建新任务。',
          );
        job = found;
      } else {
        job = (await api<{ job: AIJob }>(request.path, request.init)).job;
      }
    } catch (error) {
      if (!saved.jobId && isJobAdmissionRejected(error, !firstAttempt)) resolveSubmission(saved);
      throw error;
    }
    // Persist a late acknowledgement even if the panel closed while POST was pending.
    rememberReceipt(saved, job);
    if (expectedGeneration !== generation.current || !mounted.current) return;
    submittedRecipes.current.set(job.id, saved.recipeSnapshot);
    setJobs((previous) => [job, ...previous.filter((item) => item.id !== job.id)]);
    setThreadId(job.threadId ?? job.id);
    setParentJobId(null);
    setPrompt((old) => (old.trim() === saved.prompt ? '' : old));
    if (['transcribe', 'translate-audio', 'audio-chat'].includes(saved.operation)) {
      setAudioBase64(null);
      setVoiceEpoch((value) => value + 1);
    }
    setRefresh((value) => value + 1);
    taskChanged.current();
  }
  async function recoverSubmission() {
    if (!userId || !project || submitLock.current) return;
    const expectedGeneration = generation.current;
    submitLock.current = true;
    setBusy(true);
    setError(null);
    try {
      // Another mounted lifetime may have received the original response meanwhile.
      const saved = readJobSubmission(sessionStorage, userId);
      if (!saved) {
        restoreRecovery();
        return;
      }
      if (saved.projectId !== project.id) return;
      pending.current = saved;
      await runSubmission(saved, expectedGeneration);
    } catch (error) {
      if (expectedGeneration === generation.current) setError(errorMessage(error));
    } finally {
      submitLock.current = false;
      if (expectedGeneration === generation.current) setBusy(false);
    }
  }
  async function preview(job: AIJob) {
    if (previewPending.current || !visible) return;
    if (job.output?.kind !== 'edit-plan' || !artwork) return;
    if ((job.artworkId ?? job.output.artworkId) !== artwork.id) {
      setError('请先打开这条建议对应的作品。');
      return;
    }
    if (job.output.baseVersion !== artwork.headVersion) {
      setError('建议基于旧版本，请到对比视图核对后再决定。');
      return;
    }
    const expectedContext = consentContext.current;
    const expectedGeneration = generation.current;
    const snapshot = JSON.stringify(recipe);
    const assertCurrent = () => {
      if (
        !mounted.current ||
        generation.current !== expectedGeneration ||
        !consentContext.current.visible ||
        consentContext.current !== expectedContext
      )
        throw new Error('作品、来源或草稿已变化，请重新选择建议。');
    };
    previewPending.current = true;
    try {
      const submitted = submittedRecipes.current.get(job.id);
      if (!submitted || submitted !== snapshot) {
        if (
          !(await confirm({
            title: t('核对建议起点'),
            description: t(
              '本地编辑与建议起点可能不同。预览将作为可撤销的一步替换对应参数，云端不变。',
            ),
            confirmLabel: t('继续核对建议'),
          }))
        )
          return;
        assertCurrent();
      }
      let next = parseEditorRecipe(job.output.recipe);
      if (recipe.schemaVersion >= 2 && next.schemaVersion === 1) {
        if (
          !(await confirm({
            title: t('预览旧版建议'),
            description: t(
              '这是旧版 AI 建议。仅更新 13 项基础明暗与色彩，保留当前曲线、构图、选区和新版参数。',
            ),
            confirmLabel: t('继续查看差异'),
          }))
        )
          return;
        assertCurrent();
        next = patchEditorAdjustments(recipe, next.adjustments);
      }
      assertCurrent();
      setCandidate({ recipe: next, job, snapshot });
    } catch (error) {
      if (mounted.current && generation.current === expectedGeneration)
        setError(errorMessage(error));
    } finally {
      previewPending.current = false;
    }
  }
  const availableAssets = [
    ...projectAssets,
    ...preparedReferenceAssets.filter((asset) => asset.projectId === project?.id),
    ...jobs.flatMap((job) =>
      job.output?.kind === 'image'
        ? (job.output.images ?? [job.output]).map((image) => ({
            id: image.assetId,
            projectId: project?.id ?? '',
            name: t('AI 候选'),
            mime: 'image/png',
            width: image.width,
            height: image.height,
            bytes: 0,
            url: image.url ?? '/v1/assets/' + image.assetId + '/file',
            thumbnailUrl: image.thumbnailUrl ?? '/v1/assets/' + image.assetId + '/thumbnail',
          }))
        : [],
    ),
  ].filter((asset, index, array) => array.findIndex((item) => item.id === asset.id) === index);
  const taskPicker = (
    <button
      type="button"
      className="ai-task-trigger"
      aria-label={t('切换 AI 任务')}
      aria-haspopup="dialog"
      disabled={inputLocked || preparingDraft || assistantLocked}
      onClick={() => setOverlay('tasks')}
    >
      {assistantOpen ? <Sparkle size={18} /> : task.icon}
      <span>{assistantOpen ? t('对话') : task.label}</span>
      <CaretDown size={13} />
    </button>
  );
  const taskNavigation = mobilePage ? (
    <div className="ai-page-navigation">
      <IconButton label={returnLabel ?? t('返回编辑器')} data-ai-return onClick={onClose}>
        <ArrowLeft size={20} />
      </IconButton>
      {taskPicker}
    </div>
  ) : (
    taskPicker
  );
  const removeLocalReference = () => {
    if (referenceFile) onClearReference();
    dismissVisualReference();
    setUploadedReference(null);
    changed();
  };
  const modelOptions = [
    ...(pendingSubmission && modelId && !eligible.some((model) => model.id === modelId)
      ? [{ value: modelId, label: t('{model} · 原请求模型', { model: modelId }) }]
      : []),
    ...eligible.map((model) => ({
      value: model.id,
      label: model.label,
      description: modelReady(model)
        ? model.provider === 'openai'
          ? 'OpenAI'
          : model.provider === 'qwen'
            ? 'Qwen'
            : model.provider === 'ark'
              ? 'Ark'
              : undefined
        : t('当前未开通'),
    })),
  ];
  return (
    <AIVisibilityContext.Provider value={visible}>
      <aside
        ref={panel}
        className="ai-panel ai-workbench ai-workbench-v2"
        data-settings-open={overlay === 'settings' || undefined}
        aria-label={t('AI创作助手')}
      >
        {(assistantOpen || assistantVisited) && (
          <LiveAssistant
            navigation={taskNavigation}
            visible={visible && assistantOpen}
            hidden={!assistantOpen}
            onClose={mobilePage ? undefined : onClose}
            onActivityChange={setAssistantActivity}
            project={project}
            artwork={artwork}
            recipe={recipe}
            isLoggedIn={isLoggedIn}
            onAuth={onAuth}
            onSave={onSave}
            onExport={onExport}
            onTopUp={onTopUp}
            voiceEntry={voiceEntry}
            onPreview={onPreview}
            previewActive={previewActive}
            onConfirmPreview={onConfirmPreview}
            onCancelPreview={onCancelPreview}
            imageModelIds={(modelResponse?.models ?? [])
              .filter(
                (model) => model.enabled !== false && model.operations?.includes('generate-image'),
              )
              .map((model) => model.id)}
            onBeforeArtworkWrite={onBeforeArtworkWrite}
            onAfterArtworkWrite={onAfterArtworkWrite}
            onApplied={onDecisionApplied ?? onOpenArtwork}
            captureCurrentImage={captureCurrentImage}
            visualAttachment={visualAttachment ?? (uploadForAssistant && uploadForAssistant.file === referenceFile ? uploadForAssistant.attachment : null)}
            onClearVisualAttachment={(attachment) => {
              if (attachment === uploadForAssistant?.attachment) removeLocalReference();
              else onClearVisualAttachment?.(attachment);
            }}
            onUseCanvasSource={onUseCanvasSource}
            onPrepareGenerationDraft={prepareAssistantGenerationDraft}
          />
        )}
        {!assistantOpen && (
          <>
            <header className="ai-workbench-header">
              {taskNavigation}
              <div className="ai-header-actions">
                {onExport && (
                  <IconButton label={t('导出当前照片')} onClick={onExport}>
                    <Export size={18} />
                  </IconButton>
                )}
                <IconButton label={t('创作记录')} onClick={() => setOverlay('history')}>
                  <ClockCounterClockwise size={18} />
                </IconButton>
                <IconButton label={t('任务设置')} onClick={() => setOverlay('settings')}>
                  <GearSix size={18} />
                </IconButton>
                {!mobilePage && (
                  <IconButton className="ai-panel-close" label={t('收起 AI 面板')} onClick={onClose}>
                    <X size={18} />
                  </IconButton>
                )}
              </div>
            </header>
            <div className="ai-conversation-body" aria-label={t('创作内容')}>
              {(needsContext || (!ready && !loading)) && (
                <div className="ai-availability" role="status">
                  <span>{needsContext ? statusText : t(reason)}</span>
                  {needsContext && (
                    <button
                      type="button"
                      disabled={inputLocked}
                      onClick={
                        needsContext === 'login'
                          ? onAuth
                          : needsContext === 'project'
                            ? onCreateProject
                            : onSave
                      }
                    >
                      {needsContext === 'login'
                        ? t('登录')
                        : needsContext === 'project'
                          ? t('选择项目')
                          : t('保存作品')}
                    </button>
                  )}
                </div>
              )}
              {isLoggedIn && loading && !modelResponse && <ModelReadStatus label={t('正在读取模型')} />}
              {isLoggedIn && catalogError && <ModelReadStatus label={t('模型列表加载失败')} error={catalogError} retry={() => setCatalogAttempt((n) => n + 1)} />}
              {visibleJobs.length && project ? (
                <AIThread
                  jobs={visibleJobs}
                  project={project}
                  artwork={artwork}
                  userId={userId}
                  isDirty={isDirty}
                  documents={documents}
                  onDecisionApplied={onDecisionApplied}
                  collageActions={collageActions}
                  onBeforeArtworkWrite={onBeforeArtworkWrite}
                  onAfterArtworkWrite={onAfterArtworkWrite}
                  onOpen={onOpenArtwork}
                  onPreview={preview}
                  onContinue={continueJob}
                  onChanged={() => {
                    setRefresh((value) => value + 1);
                    onTaskChanged();
                  }}
                  onTranscript={(target, text) => {
                    if (pending.current || !recovery.ready) {
                      setError(t('请先核对上一轮创作结果，再使用识别文字发起新任务。'));
                      return;
                    }
                    changeOperation(target);
                    setPrompt(text);
                    promptInput.current?.focus({ preventScroll: true });
                  }}
                />
              ) : audioOnly || specialist ? null : (
                <div className="ai-conversation-empty">
                  <ComposerVisual
                    kind={
                      operation === 'generate-image'
                        ? 'image'
                        : operation === 'generate-text'
                          ? 'text'
                          : 'adjust'
                    }
                  />
                  <div className="ai-prompt-suggestions" aria-label={t('填写示例要求')}>
                    {task.chips.slice(0, 2).map((text) => (
                      <button
                        key={text}
                        type="button"
                        disabled={inputLocked}
                        onClick={() => {
                          setPrompt(text);
                          changed();
                          promptInput.current?.focus({ preventScroll: true });
                        }}
                      >
                        {text}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {needsRecording && !pendingSubmission && (
                <VoiceCapture key={voiceEpoch} active={visible} onReady={audioReady}
                  notice={operation === 'translate-audio' ? '本机录音，确认发送后翻译。最多 30 秒。'
                    : operation === 'audio-chat' ? '可附上最多 30 秒的本机录音，确认提交后才发送。'
                      : undefined} />
              )}
            </div>
            <footer className="ai-composer-region">
              {pendingSubmission && (
                <div className="ai-pending-strip" role="status">
                  <WarningCircle size={16} />
                  <span>
                    {pendingSubmission.state === 'unknown'
                      ? t('结果待核验，暂不能提交新任务')
                      : pendingSubmission.jobId
                        ? t('本轮任务已受理')
                        : t('发送结果待确认，原请求已保留')}
                  </span>
                  <button type="button" onClick={() => setOverlay('recovery')}>
                    {t('核对请求')}
                  </button>
                </div>
              )}
              {recovery.error && (
                <div className="ai-pending-strip" role="alert">
                  <span>{recovery.error}</span>
                  <button type="button" onClick={restoreRecovery}>
                    {t('重读记录')}
                  </button>
                </div>
              )}
              <InlineError message={error} />
              {onTopUp && error && /额度|服务点|credit|quota/i.test(error) && (
                <button className="text-button" type="button" onClick={onTopUp}>{t('充值与订阅')}</button>
              )}
              {audioChatNeedsRecording && <p className="ai-inline-error" role="status">{t('选择纯文字回答时，请先添加录音。')}</p>}
              {(sizeFailure || optionsFailure || batchFailure || referenceFailure) &&
                operation === 'generate-image' && (
                  <p className="ai-inline-error" role="status">
                    {sizeFailure || optionsFailure || batchFailure || referenceFailure}
                  </p>
                )}
              <form
                className="ai-task-composer assistant-reference-composer"
                data-ai-composer
                onSubmit={(event) => { event.preventDefault(); void submit(); }}
              >
                {parent && (
                  <div className="ai-context-strip">
                    <ArrowBendDownRight size={14} />
                    <span>
                      {operation === 'generate-text'
                        ? t('续写上次文案')
                        : operation === 'generate-image'
                          ? t('修改所选候选')
                          : t('沿用当前草稿')}
                    </span>
                    <IconButton
                      label={t('取消续接，作为新创作')}
                      disabled={inputLocked}
                      onClick={() => {
                        setParentJobId(null);
                        changed();
                      }}
                    >
                      <X size={14} />
                    </IconButton>
                  </div>
                )}
                {operation === 'generate-image' && selectedReferenceFile && (
                  <DraftAttachmentCard
                    source={selectedReferenceFile}
                    label={selectedReferenceLabel}
                    disabled={inputLocked}
                    onRemove={removeLocalReference}
                  />
                )}
                {referenceIds.length > 0 && (
                  <button
                    type="button"
                    className="ai-selected-context"
                    onClick={() => setOverlay('references')}
                    title={operation !== 'generate-image' ? t('参考图已保留，生图时使用') : undefined}
                  >
                    <Paperclip size={14} />
                    {referenceIds.length} {t('张参考')}
                  </button>
                )}
                <PromptBar
                  className="assistant-reference-prompt"
                  width={1200}
                  inputRef={promptInput}
                  value={prompt}
                  placeholder={task.placeholder}
                  hideInput={audioOnly}
                  allowEmpty={audioOnly}
                  maxLength={promptLimit}
                  disabled={inputLocked}
                  sendDisabled={!canSubmit}
                  onValueChange={(value) => { setPrompt(value); changed(); }}
                  onSend={() => void submit()}
                  commands={[]}
                  efforts={[]}
                  models={eligible.map((model) => ({
                    key: model.id, name: model.label, disabled: !modelReady(model),
                  }))}
                  modelKey={modelId}
                  onModelChange={(value) => { setModelId(value); changed(); }}
                  labels={{
                    input: t('本轮创作要求'), send: task.button,
                    attach: t('添加或管理参考图'), sources: t('参考图'),
                    chooseModel: t('选择模型'), models: t('模型'), empty: t('暂无适用模型'),
                  }}
                  sources={operation === 'generate-image' ? [
                    { key: 'references', name: t('参考图'), icon: <Paperclip size={17} />, action: () => setOverlay('references') },
                    { key: 'sketch', name: t('画草图'), icon: <PencilSimple size={17} />,
                      disabled: !caps?.references.supported || referencedCount >= referenceLimit, action: onDraw },
                    ...(captureReferenceCanvas ? [{
                      key: 'canvas', name: t(referenceCanvasLabel), icon: <Scan size={17} />,
                      disabled: capturingReference || !caps?.references.supported || referencedCount >= referenceLimit,
                      action: () => void useEditedFrame(),
                    }] : []),
                  ] : []}
                  tools={!needsRecording && (
                    <button type="button" className="prompt-bar__tool"
                      aria-label={t('改用语音输入，识别后再确认')}
                      disabled={inputLocked} onClick={() => changeOperation('transcribe')}>
                      <Microphone size={17} />
                    </button>
                  )}
                />
              </form>
              <div className="ai-composer-meta">
                <span>
                  {quote !== null && t('{v0} 点 / 次', { v0: quote })}
                  {operation === 'generate-image'
                    ? imageOptions.size === 'auto' ? t(' · 自动尺寸 · {count} 张', { count: imageOptions.n ?? 1 }) : t(' · {v0}×{v1} · {v2} 张', {
                        v0: width,
                        v1: height,
                        v2: imageOptions.n ?? 1,
                      })
                    : ''}
                </span>
                {prompt.length > promptLimit * 0.8 && (
                  <span>
                    {prompt.length}/{promptLimit}
                  </span>
                )}
              </div>
              {operation === 'generate-image' && selectedReferenceFile && (
                <p className="ai-input-disclosure">{t('发送时会上传选中的参考图。')}</p>
              )}
            </footer>
            {displayedCandidate && (
              <Modal
                title={t('对照调整建议')}
                open={visible && !!candidate}
                onClose={() => setCandidate(null)}
              >
                <div className="ai-proposal-review" data-motion="modal-content">
                  <p>
                    {displayedCandidate.job.output?.kind === 'edit-plan'
                      ? displayedCandidate.job.output.summary
                      : ''}
                  </p>
                  <div className="proposal-differences" role="table" aria-label={t('参数变化')}>
                    <div role="row" className="proposal-diff-heading">
                      <span role="columnheader">{t('参数')}</span>
                      <span role="columnheader">{t('当前')}</span>
                      <span role="columnheader">{t('建议')}</span>
                    </div>
                    {recipeDifferences(recipe, displayedCandidate.recipe).map((change) => (
                      <div role="row" key={change.path}>
                        <span role="cell">{change.label}</span>
                        <span role="cell">
                          {Number(change.before.toFixed(4))}
                          {change.unit === 'ratio' ? '' : change.unit}
                        </span>
                        <strong role="cell">
                          {Number(change.after.toFixed(4))}
                          {change.unit === 'ratio' ? '' : change.unit}
                        </strong>
                      </div>
                    ))}
                  </div>
                  {!recipeDifferences(recipe, displayedCandidate.recipe).length && (
                    <p className="control-note">{t('数值参数未变化')}</p>
                  )}
                  {!!additionalRecipeChanges(recipe, displayedCandidate.recipe).length && (
                    <p className="ai-proposal-extra">
                      {t('同时更新：{changes}', {
                        changes: additionalRecipeChanges(recipe, displayedCandidate.recipe)
                          .map((label) => t(label))
                          .join(' / '),
                      })}
                    </p>
                  )}
                  <button
                    className="button button-primary"
                    onClick={() => {
                      if (!visible || !candidate) return;
                      if (
                        !artwork ||
                        candidate.job.output?.kind !== 'edit-plan' ||
                        artwork.id !== candidate.job.output.artworkId ||
                        artwork.headVersion !== candidate.job.output.baseVersion ||
                        candidate.snapshot !== JSON.stringify(recipe)
                      ) {
                        setCandidate(null);
                        setError(t('作品或草稿已经改变，请重新预览这条建议。'));
                        return;
                      }
                      onPreview(candidate.recipe);
                      setCandidate(null);
                    }}
                  >
                    {t('在画布预览')}
                  </button>
                </div>
              </Modal>
            )}
          </>
        )}
        <Modal
          title={t('选择 AI 任务')}
          open={visible && overlay === 'tasks'}
          keepMounted
          onClose={() => setOverlay(null)}
          className="ai-options-dialog"
        >
          <div className="ai-task-picker" role="group" aria-label={t('AI任务类型')}>
            <button
              type="button"
              aria-pressed={assistantOpen}
              disabled={inputLocked || preparingDraft || assistantLocked}
              onClick={() => {
                setAssistantOpen(true);
                setOverlay(null);
              }}
            >
              <Sparkle size={21} />
              <span>
                <strong>{t('AI 助手')}</strong>
                <small>{t('文字交流、看图建议与实时通话')}</small>
              </span>
            </button>
            {tasks.filter((item) => !Object.hasOwn(specialistTaskLabels, item.id) ||
              modelResponse?.models.some((model) => model.enabled && model.runtimeOperations?.includes(item.id))).map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={!assistantOpen && operation === item.id}
                disabled={inputLocked || preparingDraft || assistantLocked}
                onClick={() => {
                  if (item.id === 'generate-image' && visualAttachment && !referenceFile)
                    useVisualReference(visualAttachment);
                  setAssistantOpen(false);
                  changeOperation(item.id);
                  setOverlay(null);
                }}
              >
                {item.icon}
                <span>
                  <strong>{t(item.label)}</strong>
                  <small>{t(item.hint)}</small>
                </span>
              </button>
            ))}
          </div>
        </Modal>
        <PanelSettingsPage
          title={t('模型与参数')}
          open={visible && overlay === 'settings'}
          onClose={() => setOverlay(null)}
        >
          <div className="ai-options-content">
            <PanelSettings onClose={() => setOverlay(null)} />
            <ModelChoice
              label={t('模型')}
              ariaLabel={t('{task}模型', { task: task.label })}
              value={modelId}
              disabled={inputLocked || !eligible.length}
              placeholder={t('暂无适用模型')}
              options={modelOptions}
              onChange={(value) => {
                setModelId(value);
                changed();
              }}
            />
            {!ready && !loading && !needsContext && (
              <p className="ai-inline-error" role="status">
                {t(reason)}
              </p>
            )}
            {operation === 'generate-image' && (
              <section className="ai-option-section">
                <ImageParameters
                  model={selected}
                  width={width}
                  height={height}
                  options={imageOptions}
                  hasReference={referencedCount > 0}
                  disabled={inputLocked}
                  onSize={(w, h) => {
                    setImageOptions((current) => {
                      if (!current.size) return current;
                      const { size: _auto, ...explicit } = current;
                      return explicit;
                    });
                    setWidth(w);
                    setHeight(h);
                    changed();
                  }}
                  onOptions={(next) => {
                    setImageOptions(next);
                    changed();
                  }}
                />
              </section>
            )}
            {operation === 'generate-text' && documents.length > 0 && (
              <section className="ai-option-section">
                <ChoiceSelect
                  className="context-document-select"
                  label={t('本轮上下文')}
                  value={documentId}
                  disabled={inputLocked}
                  onValueChange={(value) => {
                    setDocumentId(value);
                    changed();
                  }}
                  options={[
                    { value: '', label: t('不引用文档') },
                    ...documents.map((doc) => ({
                      value: doc.id,
                      label: `${doc.title} · V${doc.version}`,
                    })),
                  ]}
                />
              </section>
            )}
            {operation === 'transcribe' && selected?.provider === 'openai' && (
              <>
                <TranscriptionParameters
                  key={modelId}
                  modelId={modelId}
                  options={fileOptions}
                  disabled={inputLocked}
                  onChange={(value) => {
                    setTranscriptionOptions((current) => ({ ...current, [modelId]: value }));
                    changed();
                  }}
                />
                {!transcriptionOptionsReady && (
                  <p className="ai-inline-error" role="status">{t('请核对转写语言、提示和参数范围。')}</p>
                )}
              </>
            )}
            {specialist && (
              <>
                <SpecialistOptions operation={specialist} modelId={modelId} values={specialistOptions}
                  disabled={inputLocked} onChange={(value) => {
                    setSpecialistSettings((old) => ({ ...old, [modelId]: value }));
                    changed();
                  }} />
                {checkedSpecialist && !checkedSpecialist.success && (
                  <p className="ai-inline-error" role="status">{t('请检查模型参数的取值范围。')}</p>
                )}
              </>
            )}
            <p className="ai-option-price">
              {quote === null ? t('选择可用模型后确认点数') : t('本轮 {v0} 服务点', { v0: quote })}
            </p>
          </div>
        </PanelSettingsPage>
        <Modal
          title={t('参考图与局部编辑')}
          open={visible && overlay === 'references'}
          keepMounted
          onClose={() => setOverlay(null)}
          className="ai-options-dialog"
        >
          <div className="ai-options-content">
            <div className="reference-actions">
              <button
                type="button"
                className="text-button"
                disabled={
                  inputLocked || !caps?.references.supported || referencedCount >= referenceLimit
                }
                onClick={() => fileInput.current?.click()}
              >
                <Paperclip size={16} />
                {t('选择图片')}
              </button>
              <button
                type="button"
                className="text-button"
                disabled={
                  inputLocked || !caps?.references.supported || referencedCount >= referenceLimit
                }
                data-action="open-sketch"
                onClick={onDraw}
              >
                <PencilSimple size={16} />
                {t('画草图')}
              </button>
              {currentAsset && (
                <button
                  type="button"
                  className="text-button"
                  disabled={
                    inputLocked ||
                    !caps?.references.supported ||
                    referenceIds.includes(currentAsset.id) ||
                    referencedCount >= referenceLimit
                  }
                  onClick={() => {
                    setReferenceIds((ids) => [...ids, currentAsset.id]);
                    changed();
                  }}
                >
                  {t('使用当前原图')}
                </button>
              )}
              {captureReferenceCanvas && (
                <button
                  type="button"
                  className="text-button"
                  disabled={
                    inputLocked ||
                    capturingReference ||
                    !caps?.references.supported ||
                    referencedCount >= referenceLimit
                  }
                  onClick={() => void useEditedFrame()}
                >
                  <Scan size={16} /> {t(capturingReference ? '正在读取画布' : referenceCanvasLabel)}
                </button>
              )}
            </div>
            <input
              ref={fileInput}
              className="sr-only"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                void chooseLocal(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            {selectedReferenceFile && (
              <div className="pending-reference ai-reference-pending">
                <Paperclip size={18} />
                <span>
                  {referenceFile ? referenceFile.name : selectedReferenceLabel}
                  <small>{t('确认发送后上传')}</small>
                </span>
                <IconButton
                  label={t('移除本地参考')}
                  disabled={inputLocked}
                  onClick={removeLocalReference}
                >
                  <X size={16} />
                </IconButton>
              </div>
            )}
            <div className="reference-picker">
              {availableAssets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  aria-pressed={referenceIds.includes(asset.id)}
                  disabled={
                    inputLocked ||
                    !caps?.references.supported ||
                    (!referenceIds.includes(asset.id) && referencedCount >= referenceLimit)
                  }
                  onClick={() => {
                    setReferenceIds((ids) =>
                      ids.includes(asset.id)
                        ? ids.filter((id) => id !== asset.id)
                        : [...ids, asset.id],
                    );
                    changed();
                  }}
                >
                  <img
                    src={asset.thumbnailUrl ?? '/v1/assets/' + asset.id + '/thumbnail'}
                    alt=""
                    loading="lazy"
                  />
                  <span>{asset.name}</span>
                </button>
              ))}
            </div>
            {(!caps?.references.supported || !referenceLimit) && (
              <p className="control-note">{t('当前模型不支持参考图')}</p>
            )}
            {(caps?.references.allowMask || caps?.references.allowMarkup) && (
              <div className="auxiliary-picker">
                <ChoiceSelect
                  label={t('遮罩 / 标注图')}
                  value={auxiliary ? auxiliary.kind + ':' + auxiliary.assetId : ''}
                  disabled={inputLocked || !referencedCount}
                  onValueChange={(value) => {
                    const [kind, assetId] = value.split(':');
                    setAuxiliary(
                      kind && assetId ? { kind: kind as 'mask' | 'markup', assetId } : null,
                    );
                    changed();
                  }}
                  options={[
                    { value: '', label: t('不附加') },
                    ...(caps.references.allowMask
                      ? availableAssets.map((asset) => ({
                          value: `mask:${asset.id}`,
                          label: t('遮罩 · {v0}', { v0: asset.name }),
                        }))
                      : []),
                    ...(caps.references.allowMarkup
                      ? availableAssets.map((asset) => ({
                          value: `markup:${asset.id}`,
                          label: t('标注 · {v0}', { v0: asset.name }),
                        }))
                      : []),
                  ]}
                />
                {auxiliary?.kind === 'mask' && (
                  <p className="control-note">{t('遮罩透明处为修改区域。')}</p>
                )}
              </div>
            )}
            <p className="control-note">{t('原图未包含本地调整。')}</p>
          </div>
        </Modal>
        <Modal
          title={t('创作记录')}
          open={visible && overlay === 'history'}
          keepMounted
          onClose={() => setOverlay(null)}
          className="ai-options-dialog"
        >
          <div className="ai-history-options">
            <button
              type="button"
              className="ai-history-row"
              disabled={inputLocked}
              onClick={() => {
                setThreadId(null);
                setParentJobId(null);
                setPrompt('');
                changed();
                setOverlay(null);
              }}
            >
              <Plus size={18} />
              {t('新建创作')}
            </button>
            {allThreads.map((id) => {
              const first = jobs.filter((job) => (job.threadId ?? job.id) === id).at(-1);
              return (
                <button
                  key={id}
                  type="button"
                  className="ai-history-row"
                  aria-pressed={visibleThread === id}
                  disabled={inputLocked}
                  onClick={() => {
                    setThreadId(id);
                    setParentJobId(null);
                    setOverlay(null);
                  }}
                >
                  <ClockCounterClockwise size={17} />
                  <span>
                    {(first?.request?.prompt || first?.prompt || t('录音记录')).slice(0, 60)}
                  </span>
                </button>
              );
            })}
            {!allThreads.length && (
              <p className="ai-secondary-copy">{t('已保存的创作会显示在这里。')}</p>
            )}
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => setRefresh((value) => value + 1)}
            >
              <ArrowClockwise size={16} />
              {t('刷新记录')}
            </button>
          </div>
        </Modal>
        <Modal
          title={t('核对原请求')}
          open={visible && overlay === 'recovery'}
          keepMounted
          onClose={() => setOverlay(null)}
          className="ai-options-dialog"
        >
          {pendingSubmission && (
            <section
              className="assistant-candidate"
              aria-label={t('创作请求恢复')}
              aria-live="polite"
            >
              <h4>
                {pendingSubmission.state === 'unknown'
                  ? t('本轮创作待平台核验')
                  : pendingSubmission.jobId
                    ? t('本轮已受理，正在保留任务进度')
                    : t('发送结果待确认，原请求已保留')}
              </h4>
              <p>
                {pendingSubmission.jobId
                  ? pendingSubmission.state === 'unknown'
                    ? t('执行与用量结果尚未明确。请先核对本轮任务，核验完成前暂停新的付费创作。')
                    : t('刷新只读取项目内的原任务记录，不会再次提交模型请求。')
                  : t(
                      '原要求、模型、素材和生成参数已冻结。按原请求核对时，已受理的请求返回原结果；尚未受理时会继续原请求并使用原额度。',
                    )}
              </p>
              {!pendingSubmission.jobId && pendingSubmission.requestBody === null && (
                <p>
                  {t(
                    '原始录音仅保留在页面内存中，刷新后已不可重放。请先查看任务和用量记录并联系平台核验。',
                  )}
                </p>
              )}
              {pendingSubmission.projectId === project?.id ? (
                <div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setRefresh((old) => old + 1)}
                  >
                    {t('刷新项目任务')}
                  </button>
                  <button
                    type="button"
                    disabled={
                      busy || (!pendingSubmission.jobId && pendingSubmission.requestBody === null)
                    }
                    onClick={() => void recoverSubmission()}
                  >
                    {pendingSubmission.jobId ? t('读取本轮结果') : t('按原请求核对并继续')}
                  </button>
                </div>
              ) : (
                <p>
                  {t('请返回项目「')}
                  {pendingSubmission.projectTitle}
                  {t('」恢复本轮，再开始新的创作。')}
                </p>
              )}
            </section>
          )}
          {recovery.error && (
            <div role="alert" className="assistant-error">
              <p>{recovery.error}</p>
              <button type="button" className="text-button" onClick={restoreRecovery}>
                {t('重新读取恢复记录')}
              </button>
            </div>
          )}
        </Modal>
        {confirmationDialog}
      </aside>
    </AIVisibilityContext.Provider>
  );
}
