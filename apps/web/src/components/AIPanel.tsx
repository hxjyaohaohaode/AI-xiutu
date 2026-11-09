import { secureUuid } from '../lib/uuid';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowUp,
  Sparkle,
  X,
  SlidersHorizontal,
  CheckCircle,
  Clock,
  WarningCircle,
  ImageSquare,
  FileText,
  Microphone,
  PencilSimple,
  SpeakerHigh,
  Copy,
  ArrowSquareOut,
  FloppyDisk,
} from '@phosphor-icons/react';
import { parseRecipe, type RecipeV1 } from '@ai-xiutu/editor';
import { api, errorMessage, formatDate, jsonRequest } from '../lib/api';
import type { Artwork, Asset, Project, PublicConfig } from '../lib/types';
import { Busy, IconButton, InlineError } from './Ui';
import { VoiceCapture } from './VoiceCapture';

export type AIOperation = 'edit-plan' | 'generate-image' | 'generate-text' | 'transcribe';
type Model = {
  id: string;
  label: string;
  provider?: string;
  operations?: AIOperation[];
  pointsPerPlan?: number;
  enabled: boolean;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  minPixels?: number;
  maxPixels?: number;
  maxDimension?: number;
  minAspectRatio?: number;
  maxAspectRatio?: number;
  runtimeAvailable?: boolean;
  runtimeOperations?: AIOperation[];
  runtimeReason?: string | null;
};
type JobOutput =
  | {
      kind: 'edit-plan';
      recipe: RecipeV1;
      summary: string;
      baseVersion: number;
      inputHash: string;
      artworkId: string;
    }
  | {
      kind: 'image';
      assetId: string;
      artworkId: string;
      width: number;
      height: number;
      url: string;
      thumbnailUrl?: string;
      modelId: string;
    }
  | { kind: 'text'; title: string; body: string; summary: string }
  | { kind: 'transcript'; text: string; noSpeech?: boolean };
type Job = {
  id: string;
  operation?: AIOperation;
  artworkId?: string;
  modelId: string;
  state: string;
  output: JobOutput | null;
  errorCode: string | null;
  reservedUnits: number;
  createdAt: string;
  updatedAt: string;
};
type ModelResponse = {
  models: Model[];
  executionEnabled: boolean;
  reason?: string;
  availableOperations?: AIOperation[];
  operationStatus?: Record<string, { available: boolean; reason: string | null }>;
};
const tasks: {
  id: AIOperation;
  label: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  placeholder: string;
  button: string;
}[] = [
  {
    id: 'edit-plan',
    label: '调整',
    icon: <SlidersHorizontal size={17} />,
    title: '说说你想要的感觉。',
    description: '把文字想法变成可修改的编辑参数。先预览，喜欢了再保存。',
    placeholder: '例如：保留自然肤色，让光线更柔和一点…',
    button: '获取调整建议',
  },
  {
    id: 'generate-image',
    label: '生图',
    icon: <ImageSquare size={17} />,
    title: '从一笔草图，到新画面。',
    description: '写下场景与风格，也可以画一张草图作为参考。结果会保存为独立作品。',
    placeholder: '例如：按照草图构图，画一座黄昏时分的玻璃花房…',
    button: '生成一张图片',
  },
  {
    id: 'generate-text',
    label: '文案',
    icon: <FileText size={17} />,
    title: '给画面，配一段文字。',
    description: '创作说明、社交文案或团队简报，先在这里一起推敲。',
    placeholder: '例如：为一组春日街拍写三条自然、不夸张的发布文案…',
    button: '生成文案',
  },
  {
    id: 'transcribe',
    label: '语音',
    icon: <Microphone size={17} />,
    title: '用声音，开始下一步。',
    description: '先识别成文字，再由你决定用于调整、生图或文案。每一步单独确认。',
    placeholder: '',
    button: '发送语音识别',
  },
];
const sizes = [
  { width: 1024, height: 1024, label: '1:1 · 1024' },
  { width: 1536, height: 1024, label: '3:2 · 1536' },
  { width: 1024, height: 1536, label: '2:3 · 1536' },
  { width: 2048, height: 2048, label: '1:1 · 2048' },
  { width: 2560, height: 1440, label: '16:9 · 2560' },
  { width: 1440, height: 2560, label: '9:16 · 2560' },
  { width: 3840, height: 2160, label: '16:9 · 4K' },
  { width: 2160, height: 3840, label: '9:16 · 4K' },
  { width: 4096, height: 4096, label: '1:1 · 4096' },
];

function SpeakButton({ text }: { text: string }) {
  const supported = 'speechSynthesis' in window;
  useEffect(
    () => () => {
      if (supported) window.speechSynthesis.cancel();
    },
    [supported],
  );
  if (!supported) return null;
  return (
    <button
      className="text-button"
      onClick={() => {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'zh-CN';
        window.speechSynthesis.speak(utterance);
      }}
    >
      <SpeakerHigh size={16} />
      浏览器朗读
    </button>
  );
}
function TextResult({
  output,
  project,
  onSaved,
}: {
  output: Extract<JobOutput, { kind: 'text' }>;
  project: Project;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(output.title);
  const [body, setBody] = useState(output.body);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(
        `/projects/${project.id}/documents`,
        jsonRequest('POST', { title: title.trim() || 'AI 创作文案', body }),
      );
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ai-text-result">
      <input
        aria-label="生成文案标题"
        value={title}
        maxLength={200}
        onChange={(e) => {
          setTitle(e.target.value);
          setSaved(false);
        }}
      />
      <textarea
        aria-label="生成文案，可继续修改"
        value={body}
        maxLength={100000}
        onChange={(e) => {
          setBody(e.target.value);
          setSaved(false);
        }}
      />
      <InlineError message={error} />
      <div className="ai-result-actions">
        <button
          className="text-button"
          onClick={() =>
            navigator.clipboard
              .writeText(`${title}\n\n${body}`)
              .catch(() => setError('暂时无法自动复制，请选中文字手动复制。'))
          }
        >
          <Copy size={16} />
          复制
        </button>
        <SpeakButton text={body} />
        <button
          className="button button-secondary"
          disabled={busy || saved || !body.trim()}
          onClick={() => void save()}
        >
          {busy ? (
            <Busy />
          ) : saved ? (
            <>
              <CheckCircle size={16} />
              已存为文档
            </>
          ) : (
            <>
              <FloppyDisk size={16} />
              存为项目文档
            </>
          )}
        </button>
      </div>
    </div>
  );
}
function TranscriptResult({
  text,
  onUse,
}: {
  text: string;
  onUse: (operation: AIOperation, text: string) => void;
}) {
  const [value, setValue] = useState(text);
  return (
    <div className="ai-transcript-result">
      <label>
        识别文字，可以先修改
        <textarea
          aria-label="语音识别文字"
          value={value}
          maxLength={1500}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <SpeakButton text={value} />
      <div className="transcript-targets">
        <button
          className="button button-secondary"
          disabled={!value.trim()}
          onClick={() => onUse('edit-plan', value)}
        >
          用于调整
        </button>
        <button
          className="button button-secondary"
          disabled={!value.trim()}
          onClick={() => onUse('generate-image', value)}
        >
          用于生图
        </button>
        <button
          className="button button-secondary"
          disabled={!value.trim()}
          onClick={() => onUse('generate-text', value)}
        >
          用于文案
        </button>
      </div>
      <p className="fine-print">只填入输入框，不会自动执行下一项任务。</p>
    </div>
  );
}

export function AIPanel({
  project,
  artwork,
  recipe,
  config,
  initialOperation = 'edit-plan',
  referenceFile,
  onClearReference,
  onDraw,
  onClose,
  onPreview,
  onSave,
  onCreateProject,
  onOpenArtwork,
  onTaskChanged,
  isLoggedIn,
  onAuth,
}: {
  project: Project | null;
  artwork: Artwork | null;
  recipe: RecipeV1;
  config: PublicConfig | null;
  initialOperation?: AIOperation;
  referenceFile: File | null;
  onClearReference: () => void;
  onDraw: () => void;
  onClose: () => void;
  onPreview: (recipe: RecipeV1) => void;
  onSave: () => void;
  onCreateProject: () => void;
  onOpenArtwork: (id: string) => void;
  onTaskChanged: () => void;
  isLoggedIn: boolean;
  onAuth: () => void;
}) {
  const [modelResponse, setModelResponse] = useState<ModelResponse | null>(null);
  const [modelId, setModelId] = useState('');
  const [operation, setOperation] = useState<AIOperation>(initialOperation);
  const [prompt, setPrompt] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [idempotency, setIdempotency] = useState(() => secureUuid());
  const [size, setSize] = useState('2048x2048');
  const [customSize, setCustomSize] = useState(false);
  const [customWidth, setCustomWidth] = useState(2048);
  const [customHeight, setCustomHeight] = useState(2048);
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const [referenceAsset, setReferenceAsset] = useState<Asset | null>(null);
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null);
  const submittedRecipes = useRef(new Map<string, string>());
  const taskChanged = useRef(onTaskChanged);
  taskChanged.current = onTaskChanged;
  const eligibleModels = (modelResponse?.models ?? []).filter(
    (model) => model.enabled !== false && (model.operations ?? ['edit-plan']).includes(operation),
  );
  const chosen = eligibleModels.find((model) => model.id === modelId);
  const task = tasks.find((item) => item.id === operation)!;
  const modelReady = (model?: Model) =>
    model?.runtimeAvailable === true && model.runtimeOperations?.includes(operation) === true;
  const operationStatus = modelResponse?.operationStatus?.[operation];
  const enabled =
    operationStatus?.available ??
    (modelResponse?.availableOperations
      ? modelResponse.availableOperations.includes(operation)
      : operation === 'edit-plan' && !!modelResponse?.executionEnabled);
  const reason =
    chosen?.runtimeReason ||
    operationStatus?.reason ||
    modelResponse?.reason ||
    config?.capabilities.aiUnavailableReason ||
    (chosen && !modelReady(chosen)
      ? '这个模型尚未配置用于当前任务。可以切换其他已开通的模型。'
      : '');
  const minWidth = chosen?.minWidth ?? 64;
  const minHeight = chosen?.minHeight ?? 64;
  const maxWidth = Math.min(chosen?.maxWidth ?? 8192, chosen?.maxDimension ?? 8192);
  const maxHeight = Math.min(chosen?.maxHeight ?? 8192, chosen?.maxDimension ?? 8192);
  const minPixels = chosen?.minPixels ?? 1;
  const maxPixels = chosen?.maxPixels ?? 0;
  function sizeError(width: number, height: number) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height))
      return '宽高需要填写整数像素。';
    if (width < minWidth || width > maxWidth || height < minHeight || height > maxHeight)
      return `当前范围：宽 ${minWidth}–${maxWidth}，高 ${minHeight}–${maxHeight} 像素。`;
    if (!maxPixels) return '服务尚未返回这个模型的像素范围。';
    if (width * height < minPixels || width * height > maxPixels)
      return `总像素需要在 ${(minPixels / 1e6).toFixed(2)}–${(maxPixels / 1e6).toFixed(2)} 百万之间。`;
    if (typeof chosen?.minAspectRatio !== 'number' || typeof chosen?.maxAspectRatio !== 'number')
      return '服务尚未返回这个模型的宽高比范围。';
    if (width / height < chosen.minAspectRatio || width / height > chosen.maxAspectRatio)
      return `宽高比需要在 ${chosen.minAspectRatio}–${chosen.maxAspectRatio} 之间。`;
    return null;
  }
  const allowedSizes = sizes.filter((value) => !sizeError(value.width, value.height));
  const [presetWidth, presetHeight] = size.split('x').map(Number);
  const imageWidth = customSize ? customWidth : (presetWidth ?? 0);
  const imageHeight = customSize ? customHeight : (presetHeight ?? 0);
  const imageSizeError = sizeError(imageWidth, imageHeight);

  useEffect(() => {
    setOperation(initialOperation);
  }, [initialOperation, referenceFile]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    api<ModelResponse>('/models')
      .then((result) => {
        if (live) setModelResponse(result);
      })
      .catch((e) => live && setError(errorMessage(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!eligibleModels.some((model) => model.id === modelId))
      setModelId(eligibleModels.find(modelReady)?.id ?? eligibleModels[0]?.id ?? '');
  }, [operation, modelResponse, modelId]);
  useEffect(() => {
    if (
      allowedSizes.length &&
      !allowedSizes.some((value) => `${value.width}x${value.height}` === size)
    )
      setSize(`${allowedSizes[0]!.width}x${allowedSizes[0]!.height}`);
  }, [modelId, modelResponse, size]);
  useEffect(() => {
    setReferenceAsset(null);
    if (!referenceFile) {
      setReferenceUrl(null);
      return;
    }
    const url = URL.createObjectURL(referenceFile);
    setReferenceUrl(url);
    setIdempotency(secureUuid());
    return () => URL.revokeObjectURL(url);
  }, [referenceFile, project?.id]);
  useEffect(() => {
    setJobs([]);
    if (!project) return;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout>;
    let live = true;
    let digest = '';
    const load = async () => {
      try {
        const result = await api<{ jobs: Job[] }>(`/projects/${project.id}/ai-jobs`, {
          signal: controller.signal,
        });
        if (!live) return;
        setJobs(result.jobs);
        const next = result.jobs.map((job) => `${job.id}:${job.state}`).join('|');
        if (digest && next !== digest) taskChanged.current();
        digest = next;
        if (result.jobs.some((job) => job.state === 'queued' || job.state === 'running'))
          timeout = setTimeout(load, 2000);
      } catch (e) {
        if (live && (e as Error).name !== 'AbortError') setError(errorMessage(e));
      }
    };
    void load();
    return () => {
      live = false;
      controller.abort();
      clearTimeout(timeout);
    };
  }, [project?.id, busy]);
  const audioReady = useCallback((value: string | null) => {
    setAudioBase64(value);
    setIdempotency(secureUuid());
  }, []);
  function changeOperation(value: AIOperation) {
    setOperation(value);
    setError(null);
    setIdempotency(secureUuid());
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      !project ||
      !enabled ||
      !modelId ||
      !modelReady(chosen) ||
      (operation === 'generate-image' && imageSizeError)
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const snapshot = JSON.stringify(recipe);
      const body: Record<string, unknown> = { operation, modelId, idempotencyKey: idempotency };
      if (operation === 'edit-plan') {
        if (!artwork) throw new Error('请先保存当前作品。');
        Object.assign(body, {
          prompt: prompt.trim(),
          artworkId: artwork.id,
          expectedVersion: artwork.headVersion,
          recipe,
        });
      } else if (operation === 'generate-image') {
        Object.assign(body, { prompt: prompt.trim(), width: imageWidth, height: imageHeight });
        if (referenceFile) {
          if (referenceFile.size > (config?.limits.maxUploadBytes ?? 20 * 1024 * 1024))
            throw new Error('这张参考图超过当前云端上传限制，请使用较小的副本。');
          let attached = referenceAsset;
          if (!attached) {
            const form = new FormData();
            form.append('file', referenceFile);
            attached = (
              await api<{ asset: Asset }>(`/projects/${project.id}/assets`, {
                method: 'POST',
                body: form,
              })
            ).asset;
            setReferenceAsset(attached);
          }
          body.referenceAssetId = attached.id;
        }
      } else if (operation === 'generate-text') body.prompt = prompt.trim();
      else {
        if (!audioBase64) throw new Error('请先录制一段语音。');
        body.audioBase64 = audioBase64;
      }
      const result = await api<{ job: Job }>(
        `/projects/${project.id}/ai-jobs`,
        jsonRequest('POST', body),
      );
      if (result.job?.id) submittedRecipes.current.set(result.job.id, snapshot);
      setPrompt('');
      if (operation === 'transcribe') setAudioBase64(null);
      setIdempotency(secureUuid());
      taskChanged.current();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function preview(job: Job) {
    if (job.output?.kind !== 'edit-plan' || !artwork) return;
    if ((job.artworkId ?? job.output.artworkId) !== artwork.id) {
      setError('这条建议不属于当前作品，请先打开对应作品。');
      return;
    }
    if (job.output.baseVersion !== artwork.headVersion) {
      setError('这条建议基于较早的作品版本。请先到「对比」查看相应版本，再决定如何调整。');
      return;
    }
    const submitted = submittedRecipes.current.get(job.id);
    if (
      (!submitted || submitted !== JSON.stringify(recipe)) &&
      !window.confirm(
        '当前本地编辑可能已与这条建议的起点不同。预览会替换当前参数，并保留为可撤销的一步；云端不会改变。继续预览吗？',
      )
    )
      return;
    try {
      onPreview(parseRecipe(job.output.recipe));
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  const requiresArtwork = operation === 'edit-plan';
  const relevantJobs = jobs
    .filter((job) => (job.operation ?? 'edit-plan') === operation)
    .slice(0, 12);
  const readyToSubmit =
    !busy &&
    enabled &&
    !!project &&
    modelReady(chosen) &&
    (!requiresArtwork || !!artwork) &&
    (operation === 'transcribe' ? !!audioBase64 : !!prompt.trim()) &&
    (operation !== 'generate-image' || !imageSizeError);
  return (
    <aside className="ai-panel" aria-label="AI创作助手">
      <header>
        <div className="ai-panel-title">
          <span>
            <Sparkle size={21} weight="fill" />
          </span>
          <div>
            <h2>一起想一想</h2>
            <small>把想法，慢慢变成作品</small>
          </div>
        </div>
        <IconButton label="关闭AI面板" onClick={onClose}>
          <X size={20} />
        </IconButton>
      </header>
      <nav className="ai-task-tabs" aria-label="AI任务类型">
        {tasks.map((item) => (
          <button
            key={item.id}
            aria-pressed={operation === item.id}
            className={operation === item.id ? 'selected' : ''}
            disabled={busy}
            onClick={() => changeOperation(item.id)}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>
      <div className="ai-scroll">
        <div className="ai-intro">
          <Sparkle size={26} weight="light" />
          <h3>{task.title}</h3>
          <p>{task.description}</p>
          <span className="ai-data-note">
            {operation === 'edit-plan'
              ? '发送文字和编辑参数，不发送照片'
              : operation === 'generate-image'
                ? '提交时发送文字与已选择的参考草图'
                : operation === 'generate-text'
                  ? '按文字要求生成，不会读取未选择的项目文档'
                  : '确认后发送录音，识别完成后再决定下一步'}
          </span>
        </div>
        {loading ? (
          <Busy label="读取创作能力" />
        ) : (
          (!enabled || !modelReady(chosen)) && (
            <div className="capability-notice">
              <SlidersHorizontal size={19} />
              <div>
                <strong>{task.label}能力暂未开放</strong>
                <p>
                  {reason || '当前服务尚未配置此模型。你可以先整理想法、画草图，或继续手动编辑。'}
                </p>
              </div>
            </div>
          )
        )}
        {!isLoggedIn ? (
          <div className="ai-context-prompt">
            <p>登录后，把每次创作留在自己的项目中。</p>
            <button className="button button-secondary" onClick={onAuth}>
              登录创作空间
            </button>
          </div>
        ) : !project ? (
          <div className="ai-context-prompt">
            <p>选择或创建一个项目，用来保存任务和结果。</p>
            <button className="button button-secondary" onClick={onCreateProject}>
              创建项目
            </button>
          </div>
        ) : requiresArtwork && !artwork ? (
          <div className="ai-context-prompt">
            <p>先把当前照片保存到项目，调整建议才能绑定作品版本。</p>
            <button className="button button-secondary" onClick={onSave}>
              先保存作品
            </button>
          </div>
        ) : (
          <div className="context-chip">
            <span className="status-dot" />
            {requiresArtwork ? artwork?.title : project.title}
            {requiresArtwork && <small>V{artwork?.headVersion}</small>}
          </div>
        )}
        {operation === 'generate-image' && (
          <div className="sketch-reference">
            {referenceUrl ? (
              <>
                <div className="sketch-preview">
                  <img src={referenceUrl} alt="本次生图的草图参考" />
                  <IconButton
                    label="移除参考草图"
                    onClick={() => {
                      onClearReference();
                      setReferenceAsset(null);
                    }}
                  >
                    <X size={17} />
                  </IconButton>
                </div>
                <span>
                  {referenceAsset ? '已保存到项目，将作为生成参考' : '本地草图 · 点击生成后上传'}
                </span>
              </>
            ) : (
              <button className="sketch-entry" onClick={onDraw}>
                <PencilSimple size={27} />
                <strong>先画一张草图</strong>
                <span>画出构图、位置和大致轮廓</span>
              </button>
            )}
            <button className="text-button" onClick={onDraw}>
              <PencilSimple size={16} />
              {referenceUrl ? '重新画一张' : '打开草图板'}
            </button>
          </div>
        )}
        {operation === 'transcribe' && <VoiceCapture onReady={audioReady} />}
        {relevantJobs.length > 0 && (
          <div className="ai-jobs">
            <div className="section-label">项目中的{task.label}记录</div>
            {relevantJobs.map((job) => (
              <article className={`ai-job ${job.state}`} key={job.id}>
                <header>
                  {job.state === 'completed' ? (
                    <CheckCircle size={17} />
                  ) : job.state === 'unknown' || job.state === 'failed' ? (
                    <WarningCircle size={17} />
                  ) : (
                    <Clock size={17} />
                  )}
                  <strong>
                    {job.state === 'completed'
                      ? '结果已准备好'
                      : job.state === 'unknown'
                        ? '结果待核对'
                        : job.state === 'running'
                          ? '正在处理'
                          : job.state === 'queued'
                            ? '等待处理'
                            : job.state === 'cancelled'
                              ? '已取消'
                              : '未能完成'}
                  </strong>
                  <small>{formatDate(job.createdAt)}</small>
                </header>
                {job.state === 'unknown' && (
                  <p>请求结果尚不明确，已保留原任务。请等待核对，不要重复提交同一请求。</p>
                )}
                {job.state === 'failed' && <p>本次任务未完成，已有作品和文档没有改变。</p>}
                {job.output?.kind === 'edit-plan' && (
                  <>
                    <p>{job.output.summary}</p>
                    {job.state === 'completed' && (
                      <button
                        className="button button-secondary button-full"
                        onClick={() => preview(job)}
                      >
                        预览这份建议
                      </button>
                    )}
                  </>
                )}
                {job.state === 'completed' && job.output?.kind === 'image' && (
                  <div className="ai-image-result">
                    <img
                      src={job.output.thumbnailUrl ?? `/v1/assets/${job.output.assetId}/thumbnail`}
                      alt="本次AI生成的图片"
                      loading="lazy"
                    />
                    <span>
                      AI 生成 · {job.output.width} × {job.output.height}
                    </span>
                    <button
                      className="button button-secondary button-full"
                      onClick={() => {
                        if (job.output?.kind === 'image') onOpenArtwork(job.output.artworkId);
                      }}
                    >
                      打开继续编辑
                      <ArrowSquareOut size={16} />
                    </button>
                  </div>
                )}
                {job.state === 'completed' && job.output?.kind === 'text' && project && (
                  <TextResult output={job.output} project={project} onSaved={onTaskChanged} />
                )}
                {job.state === 'completed' &&
                  job.output?.kind === 'transcript' &&
                  (job.output.noSpeech || !job.output.text.trim()) && (
                    <p>
                      没有识别到清晰语音。本次识别已完成并按任务点数结算，可以检查麦克风后重新录制。
                    </p>
                  )}
                {job.state === 'completed' &&
                  job.output?.kind === 'transcript' &&
                  !!job.output.text.trim() && (
                    <TranscriptResult
                      text={job.output.text}
                      onUse={(target, text) => {
                        changeOperation(target);
                        setPrompt(text);
                      }}
                    />
                  )}
                <footer>
                  {job.reservedUnits} 点 ·{' '}
                  {job.state === 'unknown'
                    ? '等待结算确认'
                    : job.state === 'completed'
                      ? '任务已完成'
                      : '按任务实际状态结算'}
                </footer>
              </article>
            ))}
          </div>
        )}
      </div>
      <form className="ai-composer" onSubmit={submit}>
        <InlineError message={error} />
        {operation !== 'transcribe' && (
          <>
            <label className="sr-only" htmlFor="ai-prompt">
              你的创作要求
            </label>
            <textarea
              id="ai-prompt"
              disabled={busy}
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                setIdempotency(secureUuid());
              }}
              placeholder={task.placeholder}
              maxLength={1500}
            />
          </>
        )}
        {operation === 'generate-image' && (
          <div className="ai-dimensions">
            <div className="ai-dimension-mode">
              <strong>生成尺寸</strong>
              <button
                type="button"
                aria-pressed={!customSize}
                onClick={() => setCustomSize(false)}
                disabled={busy}
              >
                常用
              </button>
              <button
                type="button"
                aria-pressed={customSize}
                onClick={() => setCustomSize(true)}
                disabled={busy}
              >
                自定义
              </button>
              <span>每次 1 张</span>
            </div>
            {customSize ? (
              <div className="ai-custom-size">
                <label>
                  宽
                  <input
                    type="number"
                    aria-label="生成宽度像素"
                    min={minWidth}
                    max={maxWidth}
                    step="1"
                    value={customWidth}
                    disabled={busy}
                    onChange={(event) => {
                      setCustomWidth(Number(event.target.value));
                      setIdempotency(secureUuid());
                    }}
                  />
                </label>
                <span>×</span>
                <label>
                  高
                  <input
                    type="number"
                    aria-label="生成高度像素"
                    min={minHeight}
                    max={maxHeight}
                    step="1"
                    value={customHeight}
                    disabled={busy}
                    onChange={(event) => {
                      setCustomHeight(Number(event.target.value));
                      setIdempotency(secureUuid());
                    }}
                  />
                </label>
                <small>px</small>
              </div>
            ) : (
              <select
                aria-label="常用生成图片尺寸"
                value={size}
                onChange={(event) => {
                  setSize(event.target.value);
                  setIdempotency(secureUuid());
                }}
                disabled={busy || !allowedSizes.length}
              >
                {!allowedSizes.length && <option value="">没有符合当前模型的常用尺寸</option>}
                {allowedSizes.map((value) => (
                  <option value={`${value.width}x${value.height}`} key={value.label}>
                    {value.label} · {value.width}×{value.height}
                  </option>
                ))}
              </select>
            )}
            <p className={imageSizeError ? 'dimension-error' : 'dimension-hint'}>
              {imageSizeError ??
                `${((imageWidth * imageHeight) / 1e6).toFixed(2)} 百万像素 · 模型上限 ${(maxPixels / 1e6).toFixed(2)} 百万`}
            </p>
          </div>
        )}

        <div className="ai-composer-bottom">
          <div>
            <select
              aria-label={`${task.label}模型`}
              value={modelId}
              onChange={(e) => {
                setModelId(e.target.value);
                setIdempotency(secureUuid());
              }}
              disabled={busy || !eligibleModels.length}
            >
              {!eligibleModels.length && <option value="">暂无适用模型</option>}
              {eligibleModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                  {modelReady(model) ? '' : ' · 未开通'}
                </option>
              ))}
            </select>
            <small>
              {typeof chosen?.pointsPerPlan === 'number'
                ? `${chosen.pointsPerPlan} 服务点 / 次`
                : '点数以当前服务配置为准'}
            </small>
          </div>
          <button
            type="submit"
            className="ai-send"
            title={task.button}
            aria-label={task.button}
            disabled={!readyToSubmit}
          >
            {busy ? <Busy label="" /> : <ArrowUp size={21} />}
          </button>
        </div>
        <p className="fine-print">
          {operation === 'edit-plan'
            ? '建议先进入本地草稿，保存时检查云端版本。'
            : operation === 'generate-image'
              ? '点击发送即确认上传参考草图并生成新作品。'
              : operation === 'generate-text'
                ? '生成结果可以修改，确认后再存为项目文档。'
                : '点击发送语音识别，仅执行一次识别任务。'}
        </p>
      </form>
    </aside>
  );
}
