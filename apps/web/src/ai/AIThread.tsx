import { getLocale, t } from '../i18n';
import { useContext, useEffect, useState } from 'react';
import {
  ArrowBendDownRight,
  ArrowClockwise,
  ImageSquare,
  ArrowSquareOut,
  CheckCircle,
  Clock,
  Copy,
  FloppyDisk,
  PencilSimple,
  SpeakerHigh,
  WarningCircle,
} from '@phosphor-icons/react';
import { formatDate } from '../lib/api';
import type { Artwork, Project } from '../lib/types';
import { Busy, InlineError, Modal } from '../components/Ui';
import { ChoiceSelect } from '../components/ChoiceSelect';
import { Disclosure } from '../components/Controls';
import type { AIOperation, AIJob, GeneratedImage, JobOutput } from './types';
import { useResultDecisions, type ResultDecisionController } from './useResultDecisions';
import { ResultActions } from './ResultActions';
import { QueuedCancellation } from './QueuedCancellation';
import { AIVisibilityContext } from './AIVisibility';
import { AssistantText } from './AssistantText';

export function SpeakButton({ text }: { text: string }) {
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
      type="button"
      className="text-button"
      onClick={() => {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = getLocale();
        window.speechSynthesis.speak(utterance);
      }}
    >
      <SpeakerHigh size={16} />
      {t('朗读')}
    </button>
  );
}
function TextResult({
  output,
  controller,
  documents,
  canEdit,
}: {
  output: Extract<JobOutput, { kind: 'text' }>;
  controller: ResultDecisionController;
  documents: { id: string; title: string; version: number }[];
  canEdit: boolean;
}) {
  const visible = useContext(AIVisibilityContext);
  const [title, setTitle] = useState(output.title),
    [body, setBody] = useState(output.body);
  const [editing, setEditing] = useState(false),
    [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [targetId, setTargetId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const busy = controller.busy;
  const locked = busy || !!controller.uncertain;
  const target = documents.find((document) => document.id === targetId);
  async function save(destination?: { id: string; title: string; version: number }) {
    if (!visible || locked || !canEdit) return;
    const response = await controller.decide({
      action: 'save-text',
      title: title.trim() || t('AI 创作文案'),
      body,
      ...(destination ? { targetDocumentId: destination.id, expectedDocumentVersion: destination.version } : {}),
    });
    if (response) {
      setSaved(true);
      setConfirming(false);
    }
  }
  return (
    <div className="ai-text-result">
      {editing ? (
        <div className="ai-text-edit">
          <input
            aria-label={t('文案标题')}
            value={title}
            maxLength={120}
            disabled={locked}
            onChange={(event) => {
              setTitle(event.target.value);
              setSaved(false);
            }}
          />
          <textarea
            aria-label={t('文案内容')}
            value={body}
            maxLength={100000}
            disabled={locked}
            onChange={(event) => {
              setBody(event.target.value);
              setSaved(false);
            }}
          />
        </div>
      ) : (
        <div className="ai-text-copy">
          <h4>{title}</h4>
          <AssistantText text={body} />
        </div>
      )}
      <div className="ai-result-actions">
        <button
          className="text-button"
          disabled={locked || !canEdit}
          onClick={() => setEditing(!editing)}
        >
          <PencilSimple size={16} />
          {editing ? t('完成编辑') : t('编辑')}
        </button>
        <button
          className="text-button"
          onClick={() => {
            if (!navigator.clipboard) {
              setError(t('当前页面无法自动复制，请手动选中复制。'));
              return;
            }
            void navigator.clipboard
              .writeText(title + '\n\n' + body)
              .catch(() => setError(t('暂时无法自动复制，请手动选中复制。')));
          }}
        >
          <Copy size={16} />
          {t('复制')}
        </button>
        <SpeakButton text={body} />
        <button
          className="text-button"
          disabled={locked || saved || !canEdit}
          onClick={() => {
            setTargetId('');
            if (body === '') setConfirming(true);
            else void save();
          }}
        >
          {busy ? <Busy label="" /> : saved ? <CheckCircle size={16} /> : <FloppyDisk size={16} />}
          {saved ? t('已存为文档') : t('存为文档')}
        </button>
        {documents.length > 0 && (
          <button
            className="text-button"
            disabled={locked || saved || !canEdit}
            onClick={() => {
              setTargetId(documents[0]!.id);
              setConfirming(true);
            }}
          >
            {t('保存到已有文档')}
          </button>
        )}
      </div>
      <InlineError message={error} />
      {controller.uncertain?.action === 'save-text' && (
        <button
          className="text-button"
          disabled={busy}
          onClick={async () => {
            const response = await controller.decide(controller.uncertain!);
            if (response) {
              setSaved(true);
              setConfirming(false);
            }
          }}
        >
          {t('核验并重试同一文档保存')}
        </button>
      )}
      <Modal
        title={t('保存 AI 文案')}
        open={visible && confirming}
        canClose={() => !busy}
        onClose={() => setConfirming(false)}
      >
        <div className="ai-decision-confirm" data-motion="result-confirmation">
          <ChoiceSelect
            label={t('保存位置')}
            ariaLabel={t('文案保存位置')}
            disabled={locked}
            value={targetId}
            onValueChange={setTargetId}
            options={[
              { value: '', label: t('新建项目文档') },
              ...documents.map((document) => ({
                value: document.id,
                label: `${document.title} · V${document.version}`,
              })),
            ]}
          />
          {target && (
            <p>{t('保存至「{title}」的新版本，基于 V{version}。', { title: target.title, version: target.version })}</p>
          )}
          {(title !== output.title || body !== output.body) && (
            <p className="control-note">
              {t('经手动编辑')}
            </p>
          )}
          {body === '' && (
            <p className="control-note">
              {target ? t('新版本正文为空，旧版本保留。') : t('将创建正文为空的文档。')}
            </p>
          )}
          <InlineError message={controller.error} />
          <div className="ai-result-actions">
            <button
              className="button button-secondary"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              {t('返回')}
            </button>
            <button
              className="button button-primary"
              disabled={locked || !canEdit || (!!targetId && !target)}
              onClick={() => {
                if (visible && confirming) void save(target);
              }}
            >
              {busy ? <Busy label={t('保存中')} /> : target ? t('保存为文档新版本') : t('新建文档')}
            </button>
          </div>
          {controller.uncertain?.action === 'save-text' && (
            <button
              className="text-button"
              disabled={busy}
              onClick={async () => {
                if (!visible || !confirming) return;
                const response = await controller.decide(controller.uncertain!);
                if (response) {
                  setSaved(true);
                  setConfirming(false);
                }
              }}
            >
              {t('核验并重试同一文档保存')}
            </button>
          )}
        </div>
      </Modal>
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
    <div className="ai-transcript-result" data-motion="voice-result">
      <label>
        {t('识别文字，可先修改')}
        <textarea
          aria-label={t('语音识别文字')}
          value={value}
          maxLength={1500}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <div className="ai-result-actions">
        <SpeakButton text={value} />
        <button
          className="text-button"
          disabled={!value.trim()}
          onClick={() => onUse('edit-plan', value)}
        >
          {t('用于调整')}
        </button>
        <button
          className="text-button"
          disabled={!value.trim()}
          onClick={() => onUse('generate-image', value)}
        >
          {t('用于生图')}
        </button>
        <button
          className="text-button"
          disabled={!value.trim()}
          onClick={() => onUse('generate-text', value)}
        >
          {t('用于文案')}
        </button>
      </div>
    </div>
  );
}
export const jobStateLabel = (state: AIJob['state']) =>
  t(
    {
      queued: '已排队',
      running: '正在处理',
      unknown: '结果待核验',
      completed: '已完成',
      failed: '未完成',
      cancelled: '已取消',
    }[state],
  );
function GeneratedImagePreview({
  image,
  index,
  onOpen,
}: {
  image: GeneratedImage;
  index: number;
  onOpen: (id: string) => void;
}) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const source = image.thumbnailUrl ?? '/v1/assets/' + image.assetId + '/thumbnail';
  const localSource = source.startsWith('/v1/assets/');
  const src = attempt && localSource
    ? source + (source.includes('?') ? '&' : '?') + 'previewReload=' + attempt
    : source;
  return (
    <div
      className="ai-result-frame"
      style={{ aspectRatio: Math.max(1, image.width) + ' / ' + Math.max(1, image.height) }}
      data-state={failed ? 'unavailable' : 'completed'}
    >
      {failed ? (
        <div className="ai-result-placeholder">
          <ImageSquare size={26} weight="light" />
          <span>{t('预览暂不可用')}</span>
          <button
            type="button"
            className="ai-image-retry"
            onClick={() => {
              setAttempt((value) => value + 1);
              setFailed(false);
            }}
          >
            <ArrowClockwise size={16} />{t('重新载入预览')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="ai-image-open"
          onClick={() => onOpen(image.artworkId)}
          aria-label={t('打开生成候选 ') + (index + 1)}
        >
          <img
            key={attempt}
            src={src}
            alt={t('AI 生成候选 ') + (index + 1)}
            width={image.width}
            height={image.height}
            loading="lazy"
            onError={() => setFailed(true)}
          />
        </button>
      )}
    </div>
  );
}
function PendingImagePreview({ job }: { job: AIJob }) {
  const width = Math.max(1, job.request?.width ?? 1);
  const height = Math.max(1, job.request?.height ?? 1);
  const pending = job.state === 'queued' || job.state === 'running';
  return (
    <div
      className="ai-result-frame"
      style={{ aspectRatio: width + ' / ' + height }}
      data-state={job.state}
      aria-busy={pending}
    >
      <div className="ai-result-placeholder" role="status">
        {pending ? <Clock size={26} weight="light" /> : <ImageSquare size={26} weight="light" />}
        <span>{jobStateLabel(job.state)}</span>
      </div>
    </div>
  );
}
type ThreadResultProps = {
  job: AIJob;
  project: Project;
  artwork: Artwork | null;
  userId?: string | null;
  isDirty: boolean;
  documents: { id: string; title: string; version: number }[];
  onOpen: (id: string) => void;
  onPreview: (job: AIJob) => void;
  onContinue: (job: AIJob, image?: GeneratedImage) => void;
  onTranscript: (operation: AIOperation, text: string) => void;
  onChanged: () => void;
  onDecisionApplied?: (id: string) => void | Promise<void>;
  onBeforeArtworkWrite?: () => void | Promise<void>;
  onAfterArtworkWrite?: () => void | Promise<void>;
};
function CompletedResult({
  job,
  project,
  artwork,
  userId,
  isDirty,
  documents,
  onOpen,
  onPreview,
  onContinue,
  onTranscript,
  onChanged,
  onDecisionApplied,
  onBeforeArtworkWrite,
  onAfterArtworkWrite,
}: ThreadResultProps) {
  const controller = useResultDecisions(job, (userId ?? 'session') + ':' + project.id, onChanged, {
    onBeforeArtworkWrite,
    onAfterArtworkWrite,
  });
  const canEdit = ['owner', 'admin', 'editor'].includes(project.role);
  const images = job.output?.kind === 'image' ? (job.output.images ?? [job.output]) : [];
  const actionProps = { job, controller, artwork, isDirty, canEdit, onOpen, onDecisionApplied };
  return (
    <>
      {job.output?.kind === 'edit-plan' && (
        <div data-motion="ai-answer">
          <p>{job.output.summary}</p>
          <div className="ai-result-actions">
            <button className="button button-primary" onClick={() => onPreview(job)}>
              {t('对照与本地预览')}
            </button>
            <button className="text-button" onClick={() => onContinue(job)}>
              <ArrowBendDownRight size={16} />
              {t('继续调整')}
            </button>
          </div>
          <ResultActions {...actionProps} />
        </div>
      )}
      {images.length > 0 && (
        <div className="ai-image-gallery" data-motion="ai-result-media" data-motion-pixels="true">
          {images.map((image, index) => (
            <div key={image.assetId} className="ai-generated-image">
              <GeneratedImagePreview image={image} index={index} onOpen={onOpen} />
              <div className="ai-image-meta">
                <span>
                  {image.width}×{image.height}
                </span>
                <span>
                  {t('候选')}
                  {index + 1}
                </span>
              </div>
              <div className="ai-result-actions">
                <button className="text-button" onClick={() => onOpen(image.artworkId)}>
                  <ArrowSquareOut size={16} />
                  {t('打开候选')}
                </button>
                <button className="text-button" onClick={() => onContinue(job, image)}>
                  <ArrowBendDownRight size={16} />
                  {t('继续改这张')}
                </button>
              </div>
              <ResultActions {...actionProps} outputIndex={image.index ?? index} />
            </div>
          ))}
        </div>
      )}
      {job.output?.kind === 'text' && (
        <div data-motion="ai-answer">
          <TextResult
            output={job.output}
            controller={controller}
            documents={documents}
            canEdit={canEdit}
          />
          <button className="text-button continue-copy" onClick={() => onContinue(job)}>
            <ArrowBendDownRight size={16} />
            {t('基于生成稿继续润色')}
          </button>
          <ResultActions {...actionProps} />
        </div>
      )}
      {job.output?.kind === 'transcript' && (job.output.noSpeech || !job.output.text.trim()) && (
        <p className="ai-status-copy">
          {t('本次已结算，未识别到清晰语音。')}
        </p>
      )}
      {job.output?.kind === 'transcript' && !!job.output.text.trim() && (
        <TranscriptResult text={job.output.text} onUse={onTranscript} />
      )}
      <InlineError message={controller.error} />
    </>
  );
}
export function AIThread({
  jobs,
  project,
  artwork = null,
  userId,
  isDirty = true,
  documents = [],
  onOpen,
  onPreview,
  onContinue,
  onTranscript,
  onChanged,
  onDecisionApplied,
  onBeforeArtworkWrite,
  onAfterArtworkWrite,
}: {
  jobs: AIJob[];
  project: Project;
  artwork?: Artwork | null;
  userId?: string | null;
  isDirty?: boolean;
  documents?: { id: string; title: string; version: number }[];
  onDecisionApplied?: (id: string) => void | Promise<void>;
  onBeforeArtworkWrite?: () => void | Promise<void>;
  onAfterArtworkWrite?: () => void | Promise<void>;
  onOpen: (id: string) => void;
  onPreview: (job: AIJob) => void;
  onContinue: (job: AIJob, image?: GeneratedImage) => void;
  onTranscript: (operation: AIOperation, text: string) => void;
  onChanged: () => void;
}) {
  return (
    <div className="ai-thread" aria-label={t('真实创作记录')}>
      {jobs.map((job) => {
        const prompt = job.request?.prompt || job.prompt;
        return (
          <section
            className="ai-turn"
            key={job.id}
            aria-label={t('创作记录，') + jobStateLabel(job.state)}
          >
            <div className="ai-user-message" data-motion="ai-user-message">
              <div className="ai-turn-label">
                <span>{t('你的要求')}</span>
                <time>{formatDate(job.createdAt)}</time>
              </div>
              {prompt ? (
                prompt.length > 220 ? (
                  <Disclosure title={prompt.slice(0, 100) + '…'} role="ai-user-message">
                    <p>{prompt}</p>
                  </Disclosure>
                ) : (
                  <p>{prompt}</p>
                )
              ) : (
                <p>
                  {job.operation === 'transcribe'
                    ? t('确认发送一段语音识别')
                    : t('历史任务未记录完整要求')}
                </p>
              )}
              <div className="ai-request-meta">
                {job.request?.width && (
                  <span>
                    {job.request.width}×{job.request.height}
                  </span>
                )}
                {job.request?.expectedVersion && (
                  <span>
                    {t('基于 V')}
                    {job.request.expectedVersion}
                  </span>
                )}
                {job.parentJobId && (
                  <span>
                    <ArrowBendDownRight size={13} />
                    {t('接上一次结果')}
                  </span>
                )}
                {(job.request?.referenceAssetIds?.length || job.request?.referenceAssetId) && (
                  <span>
                    {job.request?.referenceAssetIds?.length ?? 1} {t('张参考图')}
                  </span>
                )}
                {job.contextSummary?.parentResultIncluded && <span>{t('包含上次文案')}</span>}
                {job.contextSummary?.documentVersion && (
                  <span>
                    {t('文档 V')}
                    {job.contextSummary.documentVersion}
                  </span>
                )}
              </div>
            </div>
            <article className={'ai-answer state-' + job.state}>
              <header className="ai-answer-state" data-motion="ai-status">
                {job.state === 'completed' ? (
                  <CheckCircle size={17} />
                ) : job.state === 'unknown' || job.state === 'failed' ? (
                  <WarningCircle size={17} />
                ) : (
                  <Clock size={17} />
                )}
                <strong>{jobStateLabel(job.state)}</strong>
                <span>
                  {job.reservedUnits} {t('点')}
                </span>
              </header>
              {(job.operation ?? job.request?.operation) === 'generate-image' &&
                job.state !== 'completed' && <PendingImagePreview job={job} />}
              {job.state === 'unknown' && (
                <p className="ai-status-copy">
                  {t('结果待核验，预占保留。')}
                </p>
              )}
              {job.state === 'failed' && (
                <p className="ai-status-copy">
                  {t('任务未完成，点数以用量记录为准。')}
                </p>
              )}
              <QueuedCancellation
                key={(userId ?? 'session') + ':' + project.id + ':' + job.id}
                job={job}
                onChanged={onChanged}
              />
              {job.state === 'cancelled' && (
                <p className="ai-status-copy">{t('已取消，点数变化见用量。')}</p>
              )}
              {job.state === 'completed' && (
                <CompletedResult
                  key={(userId ?? 'session') + ':' + project.id + ':' + job.id}
                  {...{
                    job,
                    project,
                    artwork,
                    userId,
                    isDirty,
                    documents,
                    onOpen,
                    onPreview,
                    onContinue,
                    onTranscript,
                    onChanged,
                    onDecisionApplied,
                    onBeforeArtworkWrite,
                    onAfterArtworkWrite,
                  }}
                />
              )}
            </article>
          </section>
        );
      })}
    </div>
  );
}
