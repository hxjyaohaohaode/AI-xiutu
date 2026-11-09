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
import { secureUuid } from '../lib/uuid';
import { api, errorMessage, jsonRequest } from '../lib/api';
import type { Artwork, Asset, Project, PublicConfig } from '../lib/types';
import { Busy, IconButton, InlineError, Modal } from './Ui';
import { Disclosure } from './Controls';
import { VoiceCapture } from './VoiceCapture';
import { AIThread } from '../ai/AIThread';
import { recipeDifferences, additionalRecipeChanges } from '../ai/recipeDiff';
import { ImageParameters } from '../ai/ImageParameters';
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
    label: '语音',
    icon: <Microphone size={18} />,
    placeholder: '',
    button: '确认发送语音',
    hint: '录音先在本机，确认后识别',
    chips: [],
  },
];
const draftCache = new Map<string, { prompt: string; operation: AIOperation }>();
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
}) {
  const scope = (userId ?? 'local') + ':' + (project?.id ?? 'none');
  const cached = draftCache.get(scope);
  const [modelResponse, setModelResponse] = useState<ModelResponse | null>(null);
  const [modelId, setModelId] = useState('');
  const [operation, setOperation] = useState<AIOperation>(
    referenceFile ? 'generate-image' : (cached?.operation ?? initialOperation),
  );
  const [prompt, setPrompt] = useState(cached?.prompt ?? '');
  const [jobs, setJobs] = useState<AIJob[]>([]);
  const [threadId, setThreadId] = useState<string | null | 'recent'>('recent');
  const [parentJobId, setParentJobId] = useState<string | null>(null);
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
  const [width, setWidth] = useState(2048),
    [height, setHeight] = useState(2048);
  const [imageOptions, setImageOptions] = useState<ImageOptions>({});
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const [voiceEpoch, setVoiceEpoch] = useState(0);
  const [referenceIds, setReferenceIds] = useState<string[]>([]);
  const [uploadedReference, setUploadedReference] = useState<Asset | null>(null);
  const [auxiliary, setAuxiliary] = useState<{ kind: 'mask' | 'markup'; assetId: string } | null>(
    null,
  );
  const [documents, setDocuments] = useState<{ id: string; title: string; version: number }[]>([]);
  const [documentId, setDocumentId] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const submitLock = useRef(false);
  const generation = useRef(0);
  const submittedRecipes = useRef(new Map<string, string>());
  const draft = useRef({ prompt, operation });
  draft.current = { prompt, operation };
  const taskChanged = useRef(onTaskChanged);
  taskChanged.current = onTaskChanged;
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
    setIdempotency(secureUuid());
    setError(null);
  }
  useEffect(
    () => () => {
      draftCache.set(scope, draft.current);
      if (draftCache.size > 20) draftCache.delete(draftCache.keys().next().value!);
      generation.current += 1;
    },
    [scope],
  );
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
    if (!eligible.some((model) => model.id === modelId))
      setModelId(eligible.find(modelReady)?.id ?? eligible[0]?.id ?? '');
  }, [operation, modelResponse, modelId]);
  useEffect(() => {
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
    if (referenceFile) {
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
    setAudioBase64(value);
    setIdempotency(secureUuid());
  }, []);
  function changeOperation(next: AIOperation) {
    setOperation(next);
    setParentJobId(null);
    changed();
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
    if (!canSubmit || !project || submitLock.current) return;
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
      const result = await api<{ job: AIJob }>(
        '/projects/' + project.id + '/ai-jobs',
        jsonRequest('POST', body),
      );
      if (expectedGeneration !== generation.current) return;
      submittedRecipes.current.set(result.job.id, snapshot);
      setJobs((previous) => [result.job, ...previous.filter((job) => job.id !== result.job.id)]);
      setThreadId(result.job.threadId ?? result.job.id);
      setParentJobId(null);
      setPrompt('');
      if (operation === 'transcribe') {
        setAudioBase64(null);
        setVoiceEpoch((value) => value + 1);
      }
      changed();
      setRefresh((value) => value + 1);
      taskChanged.current();
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
      <nav className="ai-task-tabs" aria-label="AI任务类型" data-motion="ai-tabs">
        {tasks.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={operation === item.id}
            disabled={busy}
            onClick={() => changeOperation(item.id)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <div
        className={'ai-readiness ' + (ready && !needsContext ? 'ready' : '')}
        data-motion="ai-status"
      >
        <span className="ai-readiness-dot" aria-hidden />
        <span>{statusText}</span>
        {needsContext && (
          <button
            type="button"
            disabled={busy}
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
          disabled={busy || !eligible.length}
          onChange={(event) => {
            setModelId(event.target.value);
            changed();
          }}
        >
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
            disabled={busy}
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
            disabled={busy}
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
            onOpen={onOpenArtwork}
            onPreview={preview}
            onContinue={continueJob}
            onChanged={() => {
              setRefresh((value) => value + 1);
              onTaskChanged();
            }}
            onTranscript={(target, text) => {
              changeOperation(target);
              setPrompt(text);
              promptInput.current?.focus();
            }}
          />
        ) : (
          <div className="ai-quiet-start" data-motion="empty-state">
            <p>{operation === 'transcribe' ? '说出来，先确认文字再继续。' : '从一句想法开始。'}</p>
            {!!task.chips.length && (
              <div className="prompt-chips">
                {task.chips.map((text) => (
                  <button
                    key={text}
                    type="button"
                    disabled={busy}
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
        {operation === 'transcribe' && <VoiceCapture key={voiceEpoch} onReady={audioReady} />}
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
              disabled={busy}
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
                disabled={busy || !caps?.references.supported || referencedCount >= referenceLimit}
                onClick={() => fileInput.current?.click()}
              >
                <Paperclip size={16} />
                选择图片
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy || !caps?.references.supported || referencedCount >= referenceLimit}
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
                  disabled={busy}
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
                    disabled={busy || !referencedCount}
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
                disabled={busy}
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
              disabled={busy}
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
            disabled={busy}
            value={prompt}
            placeholder={task.placeholder}
            maxLength={1500}
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
              disabled={busy}
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
            <p>{candidate.job.output?.kind === 'edit-plan' ? candidate.job.output.summary : ''}</p>
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
                完整候选还与当前的 {additionalRecipeChanges(recipe, candidate.recipe).join('、')}{' '}
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
    </aside>
  );
}
