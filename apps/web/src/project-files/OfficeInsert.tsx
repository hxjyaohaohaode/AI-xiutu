import { useEffect, useRef, useState } from 'react';
import { Plus } from '@phosphor-icons/react';
import { officeCharts, type OfficeBlock, type DocumentLayout } from '@ai-xiutu/contracts';
import { t, useLocale } from '../i18n';
import { api, errorMessage } from '../lib/api';
import type { Asset, ProjectDocument } from '../lib/types';
import { chartDataUrl, chartNames, snapshotSvg } from '@ai-xiutu/contracts/office-data';
import { chartFromDocument } from './presentation-model';

type Kind = OfficeBlock['kind'];
const labels: Record<Kind, string> = {
  note: '笔记',
  image: '项目图片',
  audio: '音频',
  reference: '引用文档',
  chart: '图表',
};
type Audio = { id: string; name: string; bytes: number };

export function OfficeBlockView({
  block,
  onOpen,
}: {
  block: OfficeBlock;
  onOpen?: (id: string, version: number) => void;
}) {
  if (block.kind === 'note')
    return <aside className="office-embed office-note">{block.text}</aside>;
  if (block.kind === 'image')
    return (
      <figure className="office-embed">
        <img loading="lazy" src={'/v1/assets/' + block.assetId + '/thumbnail'} alt={block.title} />
        {block.title && <figcaption>{block.title}</figcaption>}
      </figure>
    );
  if (block.kind === 'audio')
    return (
      <figure className="office-embed">
        <figcaption>{block.title}</figcaption>
        <audio
          controls
          preload="metadata"
          aria-label={block.title}
          src={'/v1/office-audio/' + block.id}
        />
      </figure>
    );
  if (block.kind === 'reference')
    return (
      <div className="office-embed office-reference">
        {onOpen ? (
          <button
            type="button"
            className="text-button"
            onClick={() => onOpen(block.documentId, block.version)}
          >
            {block.title}
          </button>
        ) : (
          <span>{block.title}</span>
        )}
        <small>{t('版本 {v0}', { v0: block.version })}</small>
      </div>
    );
  try {
    return (
      <figure className="office-embed">
        <img src={chartDataUrl(snapshotSvg(block.chart))} alt={block.chart.title} />
      </figure>
    );
  } catch {
    return <p role="status">{t('图表数据不可用')}</p>;
  }
}

export function OfficeInsert({
  projectId,
  documents,
  onInsert,
}: {
  projectId: string;
  documents: ProjectDocument[];
  onInsert: (block: OfficeBlock) => boolean;
}) {
  useLocale();
  const [kind, setKind] = useState<Kind | ''>('');
  const [note, setNote] = useState('');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [audio, setAudio] = useState<Audio[]>([]);
  const [selected, setSelected] = useState('');
  const [chart, setChart] = useState<DocumentLayout['chart']>('bar');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const uploadController = useRef<AbortController | null>(null);
  useEffect(() => () => uploadController.current?.abort(), [projectId]);
  useEffect(() => {
    if (kind !== 'image' && kind !== 'audio') return;
    const controller = new AbortController(),
      path = '/projects/' + projectId;
    const fetch =
      kind === 'image'
        ? api<{ assets: Asset[] }>(path, { signal: controller.signal }).then((value) => {
            if (!controller.signal.aborted) setAssets(value.assets);
          })
        : api<{ files: Audio[] }>(path + '/office-audio', { signal: controller.signal }).then(
            (value) => {
              if (!controller.signal.aborted) setAudio(value.files);
            },
          );
    void fetch.catch((e) => {
      if (!controller.signal.aborted) setError(errorMessage(e));
    });
    return () => controller.abort();
  }, [projectId, kind]);
  function choose(value: Kind | '') {
    setKind(value);
    setSelected('');
    setError('');
  }
  async function upload(file: File) {
    if (busy || !file.size || file.size > 8 * 1024 * 1024) {
      setError(t('请选择 8 MiB 以内的 WAV、MP3 或 Ogg 音频'));
      return;
    }
    const controller = new AbortController();
    uploadController.current = controller;
    const body = new FormData();
    body.append('file', file);
    setBusy(true);
    setError('');
    try {
      const result = await api<{ file: Audio }>('/projects/' + projectId + '/office-audio', {
        method: 'POST',
        body,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setAudio((files) => [result.file, ...files.filter((item) => item.id !== result.file.id)]);
      setSelected(result.file.id);
    } catch (error) {
      if (!controller.signal.aborted) setError(errorMessage(error));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  function insert() {
    let block: OfficeBlock | undefined;
    if (kind === 'note' && note.trim()) block = { kind, text: note.trim() };
    if (kind === 'image') {
      const asset = assets.find((item) => item.id === selected);
      if (asset) block = { kind, assetId: asset.id, title: asset.name.slice(0, 250) };
    }
    if (kind === 'audio') {
      const media = audio.find((item) => item.id === selected);
      if (media) block = { kind, id: media.id, title: media.name };
    }
    if (kind === 'reference' || kind === 'chart') {
      const doc = documents.find((item) => item.id === selected);
      if (!doc) return;
      try {
        block =
          kind === 'reference'
            ? { kind, documentId: doc.id, title: doc.title, version: doc.version }
            : { kind, chart: chartFromDocument(doc, chart) };
      } catch (error) {
        setError(errorMessage(error));
        return;
      }
    }
    if (block && onInsert(block)) {
      choose('');
      setNote('');
    }
  }
  const options =
    kind === 'image'
      ? assets.map((a) => ({ id: a.id, label: a.name }))
      : kind === 'audio'
        ? audio.map((a) => ({ id: a.id, label: a.name }))
        : documents.map((d) => ({ id: d.id, label: d.title }));
  return (
    <div className="office-insert">
      <label className="office-insert-choice">
        <Plus size={17} aria-hidden />
        <select
          aria-label={t('插入文档内容')}
          value={kind}
          onChange={(e) => choose(e.target.value as Kind | '')}
          disabled={busy}
        >
          <option value="">{t('插入')}</option>
          {(Object.keys(labels) as Kind[]).map((item) => (
            <option key={item} value={item}>
              {t(labels[item])}
            </option>
          ))}
        </select>
      </label>
      {kind && (
        <>
          {kind === 'note' ? (
            <input
              aria-label={t('笔记内容')}
              value={note}
              maxLength={2500}
              onChange={(e) => setNote(e.target.value)}
            />
          ) : (
            <select
              aria-label={t('选择项目内容')}
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">{t('选择项目内容')}</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          )}
          {kind === 'audio' && (
            <label className="office-upload">
              {t('上传音频')}
              <input
                type="file"
                aria-label={t('上传音频')}
                accept=".wav,.mp3,.ogg,.oga,audio/wav,audio/mpeg,audio/ogg"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void upload(file);
                }}
              />
            </label>
          )}
          {kind === 'chart' && (
            <select
              aria-label={t('图表类型')}
              value={chart}
              onChange={(e) => setChart(officeCharts[e.target.selectedIndex]!)}
            >
              {officeCharts.map((value) => (
                <option key={value} value={value}>
                  {t(chartNames[value])}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="text-button"
            disabled={busy || (kind === 'note' ? !note.trim() : !selected)}
            onClick={insert}
          >
            {t('插入到文档')}
          </button>
        </>
      )}
      {error && <p role="alert">{t(error)}</p>}
    </div>
  );
}
