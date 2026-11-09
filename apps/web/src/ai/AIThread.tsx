import { useEffect, useState } from 'react';
import {
  ArrowBendDownRight,
  ArrowSquareOut,
  CheckCircle,
  Clock,
  Copy,
  FloppyDisk,
  PencilSimple,
  SpeakerHigh,
  WarningCircle,
} from '@phosphor-icons/react';
import type { EditorRecipe } from '@ai-xiutu/editor';
import { api, errorMessage, formatDate, jsonRequest } from '../lib/api';
import type { Project } from '../lib/types';
import { Busy, InlineError } from '../components/Ui';
import { Disclosure } from '../components/Controls';
import type { AIOperation, AIJob, GeneratedImage, JobOutput } from './types';

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
        utterance.lang = 'zh-CN';
        window.speechSynthesis.speak(utterance);
      }}
    >
      <SpeakerHigh size={16} />
      朗读
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
  const [title, setTitle] = useState(output.title),
    [body, setBody] = useState(output.body);
  const [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(
        '/projects/' + project.id + '/documents',
        jsonRequest('POST', { title: title.trim() || 'AI 创作文案', body }),
      );
      setSaved(true);
      onSaved();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ai-text-result">
      {editing ? (
        <div className="ai-text-edit">
          <input
            aria-label="文案标题"
            value={title}
            maxLength={200}
            disabled={busy}
            onChange={(event) => {
              setTitle(event.target.value);
              setSaved(false);
            }}
          />
          <textarea
            aria-label="文案内容"
            value={body}
            maxLength={100000}
            disabled={busy}
            onChange={(event) => {
              setBody(event.target.value);
              setSaved(false);
            }}
          />
        </div>
      ) : (
        <div className="ai-text-copy">
          <h4>{title}</h4>
          <p>{body}</p>
        </div>
      )}
      <div className="ai-result-actions">
        <button className="text-button" disabled={busy} onClick={() => setEditing(!editing)}>
          <PencilSimple size={16} />
          {editing ? '完成编辑' : '编辑'}
        </button>
        <button
          className="text-button"
          onClick={() => {
            if (!navigator.clipboard) {
              setError('当前页面无法自动复制，请手动选中复制。');
              return;
            }
            void navigator.clipboard
              .writeText(title + '\n\n' + body)
              .catch(() => setError('暂时无法自动复制，请手动选中复制。'));
          }}
        >
          <Copy size={16} />
          复制
        </button>
        <SpeakButton text={body} />
        <button
          className="text-button"
          disabled={busy || saved || !body.trim()}
          onClick={() => void save()}
        >
          {busy ? <Busy label="" /> : saved ? <CheckCircle size={16} /> : <FloppyDisk size={16} />}
          {saved ? '已存为文档' : '存为文档'}
        </button>
      </div>
      {(title !== output.title || body !== output.body) && (
        <p className="control-note">
          这里的修改需存为文档才会保存；“继续润色”仍以上次模型的原始结果为起点。
        </p>
      )}
      <InlineError message={error} />
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
        识别文字，可先修改
        <textarea
          aria-label="语音识别文字"
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
          用于调整
        </button>
        <button
          className="text-button"
          disabled={!value.trim()}
          onClick={() => onUse('generate-image', value)}
        >
          用于生图
        </button>
        <button
          className="text-button"
          disabled={!value.trim()}
          onClick={() => onUse('generate-text', value)}
        >
          用于文案
        </button>
      </div>
      <p className="control-note">先填入输入框；确认发送后才执行下一次任务。</p>
    </div>
  );
}
export const jobStateLabel = (state: AIJob['state']) =>
  ({
    queued: '已排队',
    running: '正在处理',
    unknown: '结果待核验',
    completed: '已完成',
    failed: '未完成',
    cancelled: '已取消',
  })[state];
export function AIThread({
  jobs,
  project,
  onOpen,
  onPreview,
  onContinue,
  onTranscript,
  onChanged,
}: {
  jobs: AIJob[];
  project: Project;
  onOpen: (id: string) => void;
  onPreview: (job: AIJob) => void;
  onContinue: (job: AIJob, image?: GeneratedImage) => void;
  onTranscript: (operation: AIOperation, text: string) => void;
  onChanged: () => void;
}) {
  return (
    <div className="ai-thread" aria-label="真实创作记录">
      {jobs.map((job) => {
        const prompt = job.request?.prompt || job.prompt;
        const images = job.output?.kind === 'image' ? (job.output.images ?? [job.output]) : [];
        return (
          <section
            className="ai-turn"
            key={job.id}
            aria-label={'创作记录，' + jobStateLabel(job.state)}
          >
            <div className="ai-user-message" data-motion="ai-user-message">
              <div className="ai-turn-label">
                <span>你的要求</span>
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
                    ? '确认发送一段语音识别'
                    : '历史任务未记录完整要求'}
                </p>
              )}
              <div className="ai-request-meta">
                {job.request?.width && (
                  <span>
                    {job.request.width}×{job.request.height}
                  </span>
                )}
                {job.request?.expectedVersion && <span>基于 V{job.request.expectedVersion}</span>}
                {job.parentJobId && (
                  <span>
                    <ArrowBendDownRight size={13} />
                    接上一次结果
                  </span>
                )}
                {(job.request?.referenceAssetIds?.length || job.request?.referenceAssetId) && (
                  <span>{job.request?.referenceAssetIds?.length ?? 1} 张参考图</span>
                )}
                {job.contextSummary?.parentResultIncluded && <span>包含上次文案</span>}
                {job.contextSummary?.documentVersion && (
                  <span>文档 V{job.contextSummary.documentVersion}</span>
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
                <span>{job.reservedUnits} 点</span>
              </header>
              {job.state === 'unknown' && (
                <p className="ai-status-copy">
                  外部结果尚不明确，预占保持等待核验。此任务不会自动重发。
                </p>
              )}
              {job.state === 'failed' && (
                <p className="ai-status-copy">
                  本次未完成，已有作品没有改变。点数以任务最终账务状态为准。
                </p>
              )}
              {(job.state === 'queued' || job.state === 'running') && (
                <p className="ai-status-copy">
                  可以继续本地编辑。只有通过审核的最终结果才会出现在这里。
                </p>
              )}
              {job.state === 'completed' && job.output?.kind === 'edit-plan' && (
                <div data-motion="ai-answer">
                  <p>{job.output.summary}</p>
                  {!!job.output.parameterChanges?.length && (
                    <p className="control-note">
                      已生成 {job.output.parameterChanges.length} 项参数建议，预览前可逐项对照。
                    </p>
                  )}
                  <div className="ai-result-actions">
                    <button className="button button-primary" onClick={() => onPreview(job)}>
                      预览建议
                    </button>
                    <button className="text-button" onClick={() => onContinue(job)}>
                      <ArrowBendDownRight size={16} />
                      继续调整
                    </button>
                  </div>
                </div>
              )}
              {job.state === 'completed' && images.length > 0 && (
                <div
                  className="ai-image-gallery"
                  data-motion="ai-result-media"
                  data-motion-pixels="true"
                >
                  {images.map((image, index) => (
                    <div key={image.assetId} className="ai-generated-image">
                      <button
                        className="ai-image-open"
                        onClick={() => onOpen(image.artworkId)}
                        aria-label={'打开生成图片 ' + (index + 1)}
                      >
                        <img
                          src={image.thumbnailUrl ?? '/v1/assets/' + image.assetId + '/thumbnail'}
                          alt={'AI 生成候选 ' + (index + 1)}
                          loading="lazy"
                        />
                      </button>
                      <div className="ai-image-meta">
                        <span>
                          {image.width}×{image.height}
                        </span>
                        <span>候选 {index + 1}</span>
                      </div>
                      <div className="ai-result-actions">
                        <button className="text-button" onClick={() => onOpen(image.artworkId)}>
                          <ArrowSquareOut size={16} />
                          打开编辑
                        </button>
                        <button className="text-button" onClick={() => onContinue(job, image)}>
                          <ArrowBendDownRight size={16} />
                          继续改这张
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {job.state === 'completed' && job.output?.kind === 'text' && (
                <div data-motion="ai-answer">
                  <TextResult output={job.output} project={project} onSaved={onChanged} />
                  <button className="text-button continue-copy" onClick={() => onContinue(job)}>
                    <ArrowBendDownRight size={16} />
                    基于生成稿继续润色
                  </button>
                </div>
              )}
              {job.state === 'completed' &&
                job.output?.kind === 'transcript' &&
                (job.output.noSpeech || !job.output.text.trim()) && (
                  <p className="ai-status-copy">
                    没有识别到清晰语音。本次识别已完成并结算，可以检查麦克风后重新录制。
                  </p>
                )}
              {job.state === 'completed' &&
                job.output?.kind === 'transcript' &&
                !!job.output.text.trim() && (
                  <TranscriptResult text={job.output.text} onUse={onTranscript} />
                )}
            </article>
          </section>
        );
      })}
    </div>
  );
}
