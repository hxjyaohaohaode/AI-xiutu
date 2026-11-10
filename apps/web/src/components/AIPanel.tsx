import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowUp,
  Sparkle,
  X,
  SlidersHorizontal,
  ImageSquare,
  FileText,
  Microphone,
  PencilSimple,
  Plus,
  Paperclip,
  ArrowBendDownRight,
  WarningCircle,
} from '@phosphor-icons/react';
import {
  MAX_HEADER_BYTES,
  parseEditorRecipe,
  patchEditorAdjustments,
  readImageHeader,
  type EditorRecipe,
} from '@ai-xiutu/editor';
import type { AssetCopyRecord } from '@ai-xiutu/contracts';
import { secureUuid } from '../lib/uuid';
import { api, errorMessage, jsonRequest } from '../lib/api';
import { assetCopyAttempt } from '../lib/asset-copy';
import type { Artwork, Asset, Project, PublicConfig } from '../lib/types';
import { Busy, IconButton, InlineError, Modal } from './Ui';
import { Disclosure } from './Controls';
import { VoiceCapture } from './VoiceCapture';
import {
  prepareGenerationDraft,
  type GenerationDraftInput,
  type ReferenceCopyJournal,
} from './generationDraft';
import { AIThread } from '../ai/AIThread';
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
];
interface AIPanelDraft {
  prompt: string;
  operation: AIOperation;
  assistantOpen: boolean;
  modelId: string;
  width: number;
  height: number;
  imageOptions: ImageOptions;
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
  onPreview,
  onSave,
  onCreateProject,
  onOpenArtwork,
  onTaskChanged,
  onDecisionApplied,
  isDirty = true,
  isLoggedIn,
  onAuth,
  captureCurrentImage,
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
  onPreview: (recipe: EditorRecipe) => void;
  onSave: () => void;
  onCreateProject: () => void;
  onOpenArtwork: (id: string) => void;
  onTaskChanged: () => void;
  onDecisionApplied?: (id: string) => void | Promise<void>;
  isDirty?: boolean;
  isLoggedIn: boolean;
  onAuth: () => void;
  captureCurrentImage?: CaptureCurrentImage;
  onBeforeArtworkWrite?: () => void | Promise<void>;
  onAfterArtworkWrite?: () => void | Promise<void>;
}) {
  const scope = (userId ?? 'local') + ':' + (project?.id ?? 'none');
  const cached = draftCache.get(scope);
  const [recovery, setRecovery] = useState(() => initialRecovery(userId));
  const pendingSubmission = recovery.pending;
  const pending = useRef<JobSubmission | null>(pendingSubmission);
  const mounted = useRef(true);
  const [assistantOpen, setAssistantOpen] = useState(!!cached?.assistantOpen && !pendingSubmission);
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [idempotency, setIdempotency] = useState(() => secureUuid());
  const [width, setWidth] = useState(cached?.width ?? 2048),
    [height, setHeight] = useState(cached?.height ?? 2048);
  const [imageOptions, setImageOptions] = useState<ImageOptions>(cached?.imageOptions ?? {});
  const previousModel = useRef(cached?.modelId ?? '');
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const [voiceEpoch, setVoiceEpoch] = useState(0);
  const [referenceIds, setReferenceIds] = useState<string[]>(cached?.referenceIds ?? []);
  const [uploadedReference, setUploadedReference] = useState<Asset | null>(null);
  const [preparedReferenceAssets, setPreparedReferenceAssets] = useState<Asset[]>([]);
  const [preparingDraft, setPreparingDraft] = useState(false);
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
  const referenceCopies = useRef<ReferenceCopyJournal>(new Map());
  const panelContext = useRef({ scope, assistantOpen });
  panelContext.current = { scope, assistantOpen };
  const submittedRecipes = useRef(new Map<string, string>());
  const draftValue: AIPanelDraft = {
    prompt,
    operation,
    assistantOpen,
    modelId,
    width,
    height,
    imageOptions,
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
  const task = tasks.find((item) => item.id === operation)!;
  const caps = selected?.parameterCapabilities;
  const sizeFailure =
    operation === 'generate-image' ? imageSizeError(selected, width, height) : null;
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
  const referencedCount = referenceIds.length + (referenceFile ? 1 : 0);
  const referenceLimit = caps?.references.maxCount ?? 0;
  const referenceFailure =
    operation === 'generate-image' &&
    referencedCount &&
    (!caps?.references.supported || referencedCount > referenceLimit)
      ? '当前模型最多支持 ' + referenceLimit + ' 张参考图，请移除多余参考或切换模型。'
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
      ? '登录后保存 AI 创作'
      : needsContext === 'project'
        ? '先选择一个保存项目'
        : needsContext === 'artwork'
          ? '先保存当前作品版本'
          : loading
            ? '正在读取模型能力'
            : ready
              ? '已准备好'
              : task.label + '暂未开通';
  const canSubmit =
    !busy &&
    recovery.ready &&
    !pendingSubmission &&
    quote !== null &&
    !!project &&
    ready &&
    (!needsArtwork || !!artwork) &&
    (operation === 'transcribe' ? !!audioBase64 : !!prompt.trim()) &&
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
    let live = true;
    setLoading(true);
    api<ModelResponse>('/models')
      .then((result) => {
        if (live) setModelResponse(result);
      })
      .catch((error) => live && setError(errorMessage(error)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!modelResponse || pending.current) return;
    if (!eligible.some((model) => model.id === modelId))
      setModelId(eligible.find(modelReady)?.id ?? eligible[0]?.id ?? '');
  }, [operation, modelResponse, modelId, pendingSubmission]);
  useEffect(() => {
    if (modelId === previousModel.current) return;
    previousModel.current = modelId;
    if (pending.current) return;
    setImageOptions(defaultImageOptions(selected));
    const allowed = allowedImageSizes(selected);
    if (imageSizeError(selected, width, height) && allowed[0]) {
      setWidth(allowed[0].width);
      setHeight(allowed[0].height);
    }
    setAuxiliary(null);
    changed();
  }, [modelId]);
  useEffect(() => {
    setUploadedReference(null);
    if (referenceFile && !pending.current) {
      setOperation('generate-image');
      changed();
    }
  }, [referenceFile]);
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
  function changeOperation(next: AIOperation) {
    if (pending.current) return;
    setGenerationGrantId(undefined);
    generationDraftEpoch.current += 1;
    setOperation(next);
    setParentJobId(null);
    changed();
  }
  async function prepareAssistantGenerationDraft(input: GenerationDraftInput) {
    if (!project || !isLoggedIn || !userId) throw new Error('请先登录并选择草案要保存的项目。');
    const expectedScope = scope;
    const expectedGeneration = generation.current;
    const expectedEpoch = ++generationDraftEpoch.current;
    let copiedAny = false;
    const assertCurrent = () => {
      if (
        generation.current !== expectedGeneration ||
        generationDraftEpoch.current !== expectedEpoch ||
        panelContext.current.scope !== expectedScope ||
        !panelContext.current.assistantOpen
      )
        throw new Error('当前项目或工作面板已变化，请回到原草案后再继续。');
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
          window.confirm(
            `这份草案引用的 ${count} 张图片需独立复制到“${project.title}”，副本会占用目标空间的素材与存储额度。已有副本由服务器核验后复用，不重复占用。\n\n复制需要来源授权；若授权或空间不足，将保留草案供重试，不会丢弃任何参考图。已完成的独立副本会留在目标项目，不会随草案取消而自动删除。继续准备吗？`,
          ),
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
      onReferenceFile(new File([file], file.name, { type: 'image/' + header.format }), 'upload');
    } catch (error) {
      setError(errorMessage(error));
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
    }
    changed();
    setTimeout(() => promptInput.current?.focus(), 0);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
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
        if (options) body.imageOptions = options;
        const ids = [...referenceIds];
        if (referenceFile) {
          if (referenceFile.size > (config?.limits.maxUploadBytes ?? 20 * 1024 * 1024))
            throw new Error('参考图超过当前云端上传限制。');
          let asset = uploadedReference;
          if (!asset) {
            const form = new FormData();
            form.append('file', referenceFile);
            asset = (
              await api<{ asset: Asset }>(
                '/projects/' + project.id + '/assets?source=' + referenceSource,
                { method: 'POST', body: form },
              )
            ).asset;
            if (expectedGeneration !== generation.current) return;
            setUploadedReference(asset);
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
      } else {
        if (!audioBase64) throw new Error('请先录制一段语音。');
        body.audioBase64 = audioBase64;
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
    if (saved.operation === 'transcribe') {
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
  function preview(job: AIJob) {
    if (job.output?.kind !== 'edit-plan' || !artwork) return;
    if ((job.artworkId ?? job.output.artworkId) !== artwork.id) {
      setError('请先打开这条建议对应的作品。');
      return;
    }
    if (job.output.baseVersion !== artwork.headVersion) {
      setError('建议基于旧版本，请到对比视图核对后再决定。');
      return;
    }
    const submitted = submittedRecipes.current.get(job.id);
    if (
      (!submitted || submitted !== JSON.stringify(recipe)) &&
      !window.confirm(
        '本地编辑与建议起点可能不同。预览将作为可撤销的一步替换对应参数，云端不变。继续吗？',
      )
    )
      return;
    try {
      let next = parseEditorRecipe(job.output.recipe);
      if (recipe.schemaVersion >= 2 && next.schemaVersion === 1) {
        if (
          !window.confirm(
            '这是旧版AI建议。仅更新13项基础明暗与色彩，保留当前曲线、构图、选区和新版参数。继续吗？',
          )
        )
          return;
        next = patchEditorAdjustments(recipe, next.adjustments);
      }
      setCandidate({ recipe: next, job, snapshot: JSON.stringify(recipe) });
    } catch (error) {
      setError(errorMessage(error));
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
            name: 'AI 候选',
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
  return (
    <aside className="ai-panel ai-workbench" aria-label="AI创作助手">
      {pendingSubmission && (
        <section className="assistant-candidate" aria-label="创作请求恢复" aria-live="polite">
          <h4>
            {pendingSubmission.state === 'unknown'
              ? '本轮创作待平台核验'
              : pendingSubmission.jobId
                ? '本轮已受理，正在保留任务进度'
                : '发送结果待确认，原请求已保留'}
          </h4>
          <p>
            {pendingSubmission.jobId
              ? pendingSubmission.state === 'unknown'
                ? '执行与用量结果尚未明确。请先核对本轮任务，核验完成前暂停新的付费创作。'
                : '刷新只读取项目内的原任务记录，不会再次提交模型请求。'
              : '原要求、模型、素材和生成参数已冻结。按原请求核对时，已受理的请求返回原结果；尚未受理时会继续原请求并使用原额度。'}
          </p>
          {!pendingSubmission.jobId && pendingSubmission.requestBody === null && (
            <p>
              原始录音仅保留在页面内存中，刷新后已不可重放。请先查看任务和用量记录并联系平台核验。
            </p>
          )}
          {pendingSubmission.projectId === project?.id ? (
            <div>
              <button type="button" disabled={busy} onClick={() => setRefresh((old) => old + 1)}>
                刷新项目任务
              </button>
              <button
                type="button"
                disabled={
                  busy || (!pendingSubmission.jobId && pendingSubmission.requestBody === null)
                }
                onClick={() => void recoverSubmission()}
              >
                {pendingSubmission.jobId ? '读取本轮结果' : '按原请求核对并继续'}
              </button>
            </div>
          ) : (
            <p>请返回项目「{pendingSubmission.projectTitle}」恢复本轮，再开始新的创作。</p>
          )}
        </section>
      )}
      {recovery.error && (
        <div role="alert" className="assistant-error">
          <p>{recovery.error}</p>
          <button type="button" className="text-button" onClick={restoreRecovery}>
            重新读取恢复记录
          </button>
        </div>
      )}
      <nav className="ai-task-tabs" aria-label="AI任务类型" data-motion="ai-tabs">
        <button
          type="button"
          aria-pressed={assistantOpen}
          disabled={inputLocked || preparingDraft}
          onClick={() => setAssistantOpen(true)}
        >
          <Microphone size={18} />
          <span>实时协作</span>
        </button>
        {tasks.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={!assistantOpen && operation === item.id}
            disabled={inputLocked || preparingDraft}
            onClick={() => {
              setAssistantOpen(false);
              changeOperation(item.id);
            }}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      {assistantOpen ? (
        <LiveAssistant
          project={project}
          artwork={artwork}
          recipe={recipe}
          isLoggedIn={isLoggedIn}
          onAuth={onAuth}
          onSave={onSave}
          onPreview={onPreview}
          imageModelIds={(modelResponse?.models ?? [])
            .filter(
              (model) => model.enabled !== false && model.operations?.includes('generate-image'),
            )
            .map((model) => model.id)}
          onBeforeArtworkWrite={onBeforeArtworkWrite}
          onAfterArtworkWrite={onAfterArtworkWrite}
          onApplied={onDecisionApplied ?? onOpenArtwork}
          captureCurrentImage={captureCurrentImage}
          onPrepareGenerationDraft={prepareAssistantGenerationDraft}
        />
      ) : (
        <>
          <div
            className={'ai-readiness ' + (ready && !needsContext ? 'ready' : '')}
            data-motion="ai-status"
          >
            <span className="ai-readiness-dot" aria-hidden />
            <span>{statusText}</span>
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
                {needsContext === 'login' ? '登录' : needsContext === 'project' ? '选项目' : '保存'}
              </button>
            )}
            {!needsContext && !ready && !loading && (
              <details>
                <summary aria-label="查看能力未开放原因">
                  <WarningCircle size={16} />
                </summary>
                <p>{reason}</p>
              </details>
            )}
          </div>
          <div className="ai-model-row">
            <select
              aria-label={task.label + '模型'}
              value={modelId}
              disabled={inputLocked || !eligible.length}
              onChange={(event) => {
                setModelId(event.target.value);
                changed();
              }}
            >
              {pendingSubmission && modelId && !eligible.some((model) => model.id === modelId) && (
                <option value={modelId}>{modelId} · 原请求模型</option>
              )}
              {!eligible.length && <option value="">暂无适用模型</option>}
              {eligible.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                  {modelReady(model) ? '' : ' · 未开通'}
                </option>
              ))}
            </select>
            <span className="ai-price">{quote === null ? '点数待确认' : quote + ' 点 / 次'}</span>
          </div>
          {allThreads.length > 0 && (
            <div className="ai-conversation-toolbar" data-motion="ai-context">
              <select
                aria-label="选择已保存创作线程"
                value={visibleThread ?? ''}
                disabled={inputLocked}
                onChange={(event) => {
                  setThreadId(event.target.value || null);
                  setParentJobId(null);
                }}
              >
                <option value="">新的创作</option>
                {allThreads.map((id) => {
                  const first = jobs.filter((job) => (job.threadId ?? job.id) === id).at(-1);
                  return (
                    <option key={id} value={id}>
                      {(first?.request?.prompt || first?.prompt || '语音 / 创作记录').slice(0, 28)}
                    </option>
                  );
                })}
              </select>
              <IconButton
                label="新建创作线程"
                disabled={inputLocked}
                onClick={() => {
                  setThreadId(null);
                  setParentJobId(null);
                  setPrompt('');
                  changed();
                }}
              >
                <Plus size={17} />
              </IconButton>
            </div>
          )}
          <div className="ai-scroll">
            {visibleJobs.length && project ? (
              <AIThread
                jobs={visibleJobs}
                project={project}
                artwork={artwork}
                userId={userId}
                isDirty={isDirty}
                documents={documents}
                onDecisionApplied={onDecisionApplied}
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
                    setError('请先核对上一轮创作结果，再使用识别文字发起新任务。');
                    return;
                  }
                  changeOperation(target);
                  setPrompt(text);
                  promptInput.current?.focus();
                }}
              />
            ) : (
              <div className="ai-quiet-start" data-motion="empty-state">
                <p>
                  {operation === 'transcribe' ? '说出来，先确认文字再继续。' : '从一句想法开始。'}
                </p>
                {!!task.chips.length && (
                  <div className="prompt-chips">
                    {task.chips.map((text) => (
                      <button
                        key={text}
                        type="button"
                        disabled={inputLocked}
                        onClick={() => {
                          setPrompt(text);
                          changed();
                          promptInput.current?.focus();
                        }}
                      >
                        {text}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {operation === 'transcribe' && !pendingSubmission && (
              <VoiceCapture key={voiceEpoch} onReady={audioReady} />
            )}
            {operation === 'generate-image' && (
              <Disclosure
                title="生成设置"
                summary={width + '×' + height + ' · ' + (imageOptions.n ?? 1) + ' 张'}
                role="ai-options"
              >
                <ImageParameters
                  model={selected}
                  width={width}
                  height={height}
                  options={imageOptions}
                  disabled={inputLocked}
                  onSize={(w, h) => {
                    setWidth(w);
                    setHeight(h);
                    changed();
                  }}
                  onOptions={(next) => {
                    setImageOptions(next);
                    changed();
                  }}
                />
              </Disclosure>
            )}
            {operation === 'generate-image' && (
              <Disclosure
                title="参考与局部编辑"
                summary={referencedCount ? referencedCount + ' 张参考' : '可选'}
                role="ai-reference"
              >
                <div className="reference-actions">
                  <button
                    type="button"
                    className="text-button"
                    disabled={
                      inputLocked ||
                      !caps?.references.supported ||
                      referencedCount >= referenceLimit
                    }
                    onClick={() => fileInput.current?.click()}
                  >
                    <Paperclip size={16} />
                    选择图片
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    disabled={
                      inputLocked ||
                      !caps?.references.supported ||
                      referencedCount >= referenceLimit
                    }
                    onClick={onDraw}
                  >
                    <PencilSimple size={16} />
                    画草图
                  </button>
                  {currentAsset && (
                    <button
                      type="button"
                      className="text-button"
                      disabled={
                        busy ||
                        !caps?.references.supported ||
                        referenceIds.includes(currentAsset.id) ||
                        referencedCount >= referenceLimit
                      }
                      onClick={() => {
                        setReferenceIds((ids) => [...ids, currentAsset.id]);
                        changed();
                      }}
                    >
                      使用当前原图
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
                {referenceFile && (
                  <div className="pending-reference">
                    <Paperclip size={18} />
                    <span>
                      {referenceFile.name}
                      <small>确认发送后上传</small>
                    </span>
                    <IconButton
                      label="移除本地参考"
                      disabled={inputLocked}
                      onClick={() => {
                        onClearReference();
                        setUploadedReference(null);
                        changed();
                      }}
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
                        busy ||
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
                  <p className="control-note">当前模型没有开放参考图，选择已开通的模型后可使用。</p>
                )}
                {(caps?.references.allowMask || caps?.references.allowMarkup) && (
                  <div className="auxiliary-picker">
                    <label>
                      遮罩 / 标注图
                      <select
                        value={auxiliary ? auxiliary.kind + ':' + auxiliary.assetId : ''}
                        disabled={inputLocked || !referencedCount}
                        onChange={(event) => {
                          const [kind, assetId] = event.target.value.split(':');
                          setAuxiliary(
                            kind && assetId ? { kind: kind as 'mask' | 'markup', assetId } : null,
                          );
                          changed();
                        }}
                      >
                        <option value="">不附加</option>
                        {caps.references.allowMask &&
                          availableAssets.map((asset) => (
                            <option key={'mask' + asset.id} value={'mask:' + asset.id}>
                              遮罩 · {asset.name}
                            </option>
                          ))}
                        {caps.references.allowMarkup &&
                          availableAssets.map((asset) => (
                            <option key={'markup' + asset.id} value={'markup:' + asset.id}>
                              标注 · {asset.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <p className="control-note">
                      二者互斥，需先选参考图；遮罩透明区域表示修改范围，必须符合模型对尺寸和格式的要求。
                    </p>
                  </div>
                )}
                <p className="control-note">
                  参考只表示创作依据，不保证像素级保留。当前原图不包含尚未导出的本地调整。
                </p>
              </Disclosure>
            )}
            {operation === 'generate-text' && documents.length > 0 && (
              <Disclosure
                title="引用项目文档"
                summary={documentId ? '已选 1 份' : '可选'}
                role="ai-options"
              >
                <label className="context-document-select">
                  本轮上下文
                  <select
                    value={documentId}
                    disabled={inputLocked}
                    onChange={(event) => {
                      setDocumentId(event.target.value);
                      changed();
                    }}
                  >
                    <option value="">不引用文档</option>
                    {documents.map((doc) => (
                      <option key={doc.id} value={doc.id}>
                        {doc.title} · V{doc.version}
                      </option>
                    ))}
                  </select>
                </label>
              </Disclosure>
            )}
          </div>
          <form className="ai-composer" onSubmit={submit} data-motion="ai-composer">
            {parent && (
              <div className="ai-parent-context">
                <ArrowBendDownRight size={15} />
                <span>
                  {operation === 'generate-text'
                    ? '基于上次生成文案'
                    : operation === 'generate-image'
                      ? '继续修改所选候选'
                      : '基于当前草稿继续调整'}
                </span>
                <IconButton
                  label="取消续接，作为新创作"
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
            <InlineError message={error} />
            {operation !== 'transcribe' && (
              <textarea
                ref={promptInput}
                aria-label="本轮创作要求"
                disabled={inputLocked}
                value={prompt}
                placeholder={task.placeholder}
                maxLength={operation === 'generate-image' ? 4000 : 1500}
                rows={2}
                onChange={(event) => {
                  setPrompt(event.target.value);
                  changed();
                }}
              />
            )}
            <div className="ai-composer-actions">
              <span>
                {needsArtwork && artwork
                  ? '作品 V' + artwork.headVersion
                  : (project?.title ?? '本地想法')}
              </span>
              {operation !== 'transcribe' && (
                <IconButton
                  label="改用语音输入，识别后再确认"
                  disabled={inputLocked}
                  onClick={() => changeOperation('transcribe')}
                >
                  <Microphone size={18} />
                </IconButton>
              )}
              <button
                type="submit"
                className="ai-send"
                title={task.button}
                aria-label={task.button}
                disabled={!canSubmit}
              >
                {busy ? <Busy label="" /> : <ArrowUp size={20} />}
                <span>{operation === 'transcribe' ? '识别' : '发送'}</span>
              </button>
            </div>
            <p className="ai-submit-note">
              {task.hint}
              {operation === 'generate-image' && referenceFile ? '；发送即确认上传' : ''}。
            </p>
            {(sizeFailure || optionsFailure || batchFailure || referenceFailure) &&
              operation === 'generate-image' && (
                <p className="parameter-error">
                  {sizeFailure || optionsFailure || batchFailure || referenceFailure}
                </p>
              )}
          </form>
          {candidate && (
            <Modal
              title="对照调整建议"
              subtitle="与当前草稿逐项对比，确认后才进入本地编辑记录。"
              onClose={() => setCandidate(null)}
            >
              <div className="ai-proposal-review" data-motion="modal-content">
                <p>
                  {candidate.job.output?.kind === 'edit-plan' ? candidate.job.output.summary : ''}
                </p>
                <div className="proposal-differences" role="table" aria-label="参数变化">
                  <div role="row" className="proposal-diff-heading">
                    <span role="columnheader">参数</span>
                    <span role="columnheader">当前</span>
                    <span role="columnheader">建议</span>
                  </div>
                  {recipeDifferences(recipe, candidate.recipe).map((change) => (
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
                {!recipeDifferences(recipe, candidate.recipe).length && (
                  <p className="control-note">基础与新版数值参数没有变化。</p>
                )}
                {!!additionalRecipeChanges(recipe, candidate.recipe).length && (
                  <p className="parameter-error">
                    完整候选还与当前的{' '}
                    {additionalRecipeChanges(recipe, candidate.recipe).join('、')}{' '}
                    不同；确认将一起替换，可撤销。
                  </p>
                )}
                <p className="control-note">
                  云端版本不会自动改写。预览后可以继续精修，再由你保存新版本。
                </p>
                <button
                  className="button button-primary"
                  onClick={() => {
                    if (
                      !artwork ||
                      candidate.job.output?.kind !== 'edit-plan' ||
                      artwork.id !== candidate.job.output.artworkId ||
                      artwork.headVersion !== candidate.job.output.baseVersion ||
                      candidate.snapshot !== JSON.stringify(recipe)
                    ) {
                      setCandidate(null);
                      setError('作品或草稿已经改变，请重新预览这条建议。');
                      return;
                    }
                    onPreview(candidate.recipe);
                    setCandidate(null);
                  }}
                >
                  作为可撤销的一步预览
                </button>
              </div>
            </Modal>
          )}
        </>
      )}
    </aside>
  );
}
