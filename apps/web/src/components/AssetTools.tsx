import { getLocale, t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import type {
  AnimationDescriptor,
  AssetRecognition,
  RecognitionRequest,
} from '@ai-xiutu/contracts';
import { api, errorMessage, jsonRequest } from '../lib/api';
import { secureUuid } from '../lib/uuid';
import type { Asset } from '../lib/types';
import { confirmStableScope } from '../lib/confirmation-scope';
import { MotionDetails, MotionSwitch } from '../motion/Presence';
import { ChoiceSelect } from './ChoiceSelect';
import { useConfirmation } from './ConfirmationDialog';
import { StudioGlyph } from './StudioGlyph';
import { Busy, InlineError, Modal } from './Ui';
import { CheckControl } from './CheckControl';
import { StatusMark } from './StatusMark';
import GradualBlur from './react-bits/GradualBlur';

type Capability = {
  recognition: { engine: string | null; languages: string[]; maxPixels: number };
  animation: {
    formats: string[];
    maxFrames: number;
    maxFramePixels: number;
    maxTotalPixels: number;
    maxBytes: number;
  };
};
const editableLabels = ['eng', 'chi_sim', 'eng+chi_sim'] as const;
const languageLabel = { eng: '英文', chi_sim: '简体中文', 'eng+chi_sim': '中英混合' };
const layoutLabel = { auto: '自动版面', block: '连续段落', sparse: '零散文字', table: '对齐表格' };

export function AssetRecognitionDialog({
  asset,
  editable,
  onClose,
  onChange,
}: {
  asset: Asset;
  editable: boolean;
  onClose(): void;
  onChange(): void;
}) {
  const [available, setAvailable] = useState<Capability | null>(null);
  const [items, setItems] = useState<AssetRecognition[]>([]);
  const [selected, setSelected] = useState('');
  const [language, setLanguage] = useState<RecognitionRequest['language']>('eng+chi_sim');
  const [layout, setLayout] = useState<RecognitionRequest['layout']>('auto');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const confirmation = useConfirmation();
  const mounted = useRef(true);
  const locked = useRef(false);
  const latest = useRef({ asset, editable, items, selected, language, layout, busy, onChange });
  latest.current = { asset, editable, items, selected, language, layout, busy, onChange };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const url = `/assets/${asset.id}/recognitions`;
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError('');
    setAvailable(null);
    setItems([]);
    setSelected('');
    void Promise.allSettled([
      api<Capability>('/asset-processing/capabilities', { signal: controller.signal }),
      api<{ recognitions: AssetRecognition[] }>(url, { signal: controller.signal }),
    ]).then(([caps, results]) => {
      if (controller.signal.aborted) return;
      if (caps.status === 'fulfilled') {
        setAvailable(caps.value);
        const supported = caps.value.recognition.languages;
        if (supported.length === 1) setLanguage(supported[0] === 'eng' ? 'eng' : 'chi_sim');
      }
      if (results.status === 'fulfilled') {
        setItems(results.value.recognitions);
        setSelected(results.value.recognitions[0]?.id ?? '');
      } else setError(errorMessage(results.reason));
      if (caps.status === 'rejected' && results.status === 'fulfilled')
        setError(errorMessage(caps.reason));
      setBusy(false);
    });
    return () => controller.abort();
  }, [url]);
  const current = items.find((item) => item.id === selected);
  const supported = available?.recognition.languages ?? [];
  const languageAvailable = language.split('+').every((value) => supported.includes(value));
  const pixelsAvailable =
    !!available && asset.width * asset.height <= available.recognition.maxPixels;
  const isCurrent = (source: Asset) =>
    mounted.current &&
    latest.current.asset.id === source.id &&
    latest.current.asset.projectId === source.projectId;
  async function recognize() {
    if (
      !mounted.current ||
      latest.current.busy ||
      locked.current ||
      !latest.current.editable ||
      !languageAvailable ||
      !pixelsAvailable
    )
      return;
    const source = latest.current.asset;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      const { recognition } = await api<{ recognition: AssetRecognition }>(
        url,
        jsonRequest('POST', { language, layout }),
      );
      if (!isCurrent(source)) return;
      setItems((old) => [recognition, ...old.filter((item) => item.id !== recognition.id)]);
      setSelected(recognition.id);
      latest.current.onChange();
    } catch (failure) {
      if (isCurrent(source)) setError(errorMessage(failure));
    } finally {
      locked.current = false;
      if (isCurrent(source)) setBusy(false);
    }
  }
  async function remove() {
    if (
      !mounted.current ||
      locked.current ||
      latest.current.busy ||
      !latest.current.editable ||
      !current
    )
      return;
    const result = await confirmStableScope(
      () => ({
        mounted: mounted.current,
        asset: latest.current.asset.id,
        project: latest.current.asset.projectId,
        editable: latest.current.editable,
        record: latest.current.items.find((item) => item.id === latest.current.selected),
        busy: latest.current.busy,
        locked: locked.current,
      }),
      () =>
        confirmation.confirm({
          title: '删除识别结果',
          description: t('删除这份识别结果及对应的搜索索引？原图会保留。'),
          confirmLabel: '删除识别结果',
          tone: 'danger',
        }),
    );
    if (result !== 'confirmed') {
      if (result === 'changed' && mounted.current)
        setError('素材、权限或识别记录已变化，请重新选择后确认。');
      return;
    }
    if (!mounted.current || locked.current || latest.current.busy || !latest.current.editable)
      return;
    const source = latest.current.asset;
    const record = latest.current.items.find((item) => item.id === latest.current.selected);
    if (!record) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      await api(`/assets/${source.id}/recognitions/${record.id}`, jsonRequest('DELETE'));
      if (!isCurrent(source)) return;
      setItems((old) => old.filter((item) => item.id !== record.id));
      setSelected(latest.current.items.find((item) => item.id !== record.id)?.id ?? '');
      latest.current.onChange();
    } catch (failure) {
      if (isCurrent(source)) setError(errorMessage(failure));
    } finally {
      locked.current = false;
      if (isCurrent(source)) setBusy(false);
    }
  }
  return (
    <>
      <Modal
        title={t('识别文字与表格')}
        subtitle={asset.name}
        className="studio-dialog asset-tools-dialog"
        onClose={onClose}
        canClose={() => !locked.current}
      >
        <div className="stack-form asset-tool-content">
          <InlineError message={error} />
          {editable && (
            <>
              <div className="asset-tool-fields">
                <ChoiceSelect
                  label={t('识别语言')}
                  ariaLabel={t('识别语言')}
                  value={language}
                  disabled={busy}
                  onValueChange={(value) => setLanguage(value as typeof language)}
                  options={editableLabels.map((value) => ({
                    value,
                    label: t(languageLabel[value]),
                    disabled: value.split('+').some((item) => !supported.includes(item)),
                  }))}
                />
                <ChoiceSelect
                  label={t('版面')}
                  ariaLabel={t('识别版面')}
                  value={layout}
                  disabled={busy}
                  onValueChange={(value) => setLayout(value as typeof layout)}
                  options={Object.entries(layoutLabel).map(([value, label]) => ({
                    value,
                    label: t(label),
                  }))}
                />
              </div>
              <button
                className="button button-primary"
                disabled={busy || !languageAvailable || !pixelsAvailable}
                onClick={() => void recognize()}
              >
                <StudioGlyph name="docs" />
                {t('识别并存入素材')}
              </button>
              {!busy && !supported.length && (
                <small>{t('当前服务未提供可用的 OCR 语言包。')}</small>
              )}
              {available && (
                <p className="control-note">
                  {t('当前文字识别最多支持')}
                  {available.recognition.maxPixels.toLocaleString(getLocale())} {t('像素。')}
                  {!pixelsAvailable && t('这份素材超过处理范围，可先导出较小副本后识别。')}
                </p>
              )}
            </>
          )}
          {!editable && (
            <p className="control-note">{t('当前项目为只读权限，可查看已有识别记录。')}</p>
          )}
          {busy && <Busy label={t('处理识别结果')} />}
          {!!items.length && (
            <ChoiceSelect
              label={t('识别记录')}
              ariaLabel={t('识别记录')}
              value={selected}
              disabled={busy}
              onValueChange={setSelected}
              options={items.map((item) => ({
                value: item.id,
                label: `${t(languageLabel[item.language])} · ${t(layoutLabel[item.layout])} · ${item.createdAt.slice(0, 10)}`,
              }))}
            />
          )}
          <MotionSwitch
            switchKey={current?.id ?? 'empty'}
            role="view-transition"
            className="asset-recognition-result stack-form"
          >
            {current && (
              <>
                <small>
                  {current.engine} · {current.width}×{current.height} · {current.words.length}{' '}
                  {t('项文字')}
                </small>
                <label>
                  {t('识别文字')}
                  <textarea rows={5} readOnly value={current.text || t('未识别到文字')} />
                </label>
                {current.table ? (
                  <div
                    className="asset-tool-table-scroll"
                    tabIndex={0}
                    role="region"
                    aria-label={t('识别出的表格')}
                  >
                    <table className="asset-tool-table">
                      <caption>{t('按文字坐标推断的表格')}</caption>
                      <tbody>
                        {current.table.rows.map((row, index) => (
                          <tr key={index}>
                            {row.map((cell, col) => (
                              <td key={col}>{cell ?? '—'}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  current.layout === 'table' && (
                    <small>{t('未找到一致的列结构，已保留识别文字与位置。')}</small>
                  )
                )}
                {editable && (
                  <button
                    className="text-button asset-tool-delete"
                    disabled={busy}
                    onClick={() => void remove()}
                  >
                    {t('删除这份识别结果')}
                  </button>
                )}
              </>
            )}
          </MotionSwitch>
        </div>
      </Modal>
      {confirmation.dialog}
    </>
  );
}

export function AnimationDialog({
  asset,
  editable,
  onClose,
  onChange,
}: {
  asset: Asset;
  editable: boolean;
  onClose(): void;
  onChange(): void;
}) {
  const [descriptor, setDescriptor] = useState<AnimationDescriptor | null>(null);
  const [order, setOrder] = useState('');
  const [loop, setLoop] = useState(0);
  const [uniformDelay, setUniformDelay] = useState('');
  const [recipe, setRecipe] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [output, setOutput] = useState<{ asset: Asset; animation: AnimationDescriptor } | null>(
    null,
  );
  const request = useRef<{ body: string; id: string } | null>(null);
  const mounted = useRef(true);
  const locked = useRef(false);
  const latest = useRef({ asset, editable, onChange });
  latest.current = { asset, editable, onChange };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const isCurrent = (source: Asset) =>
    mounted.current &&
    latest.current.asset.id === source.id &&
    latest.current.asset.projectId === source.projectId;
  const endpoint = `/assets/${asset.id}/animation`;
  useEffect(() => {
    const controller = new AbortController();
    setDescriptor(null);
    setOutput(null);
    setOrder('');
    setUniformDelay('');
    setRecipe(null);
    setError('');
    request.current = null;
    void api<{ animation: AnimationDescriptor }>(endpoint, { signal: controller.signal })
      .then(({ animation }) => {
        if (controller.signal.aborted) return;
        setDescriptor(animation);
        setLoop(animation.loop);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(errorMessage(failure));
      });
    return () => controller.abort();
  }, [endpoint]);
  async function save() {
    if (!mounted.current || busy || locked.current || !latest.current.editable || !descriptor)
      return;
    const source = latest.current.asset;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      const frames = order.trim()
        ? order
            .trim()
            .split(/[,，\s]+/)
            .map((item) => {
              if (!/^\d{1,3}$/.test(item)) throw new Error('请用逗号分隔有效帧编号。');
              return Number(item) - 1;
            })
        : undefined;
      if (
        frames &&
        (frames.length < 2 ||
          frames.length > 120 ||
          frames.some((frame) => frame < 0 || frame >= descriptor.frames))
      )
        throw new Error('请选择至少两帧，编号需在原动图范围内。');
      const delay = uniformDelay.trim()
        ? Array(frames?.length ?? descriptor.frames).fill(Number(uniformDelay))
        : undefined;
      if (
        delay &&
        (!Number.isInteger(delay[0]) || delay[0] < 20 || delay[0] > 60000 || delay[0] % 10)
      )
        throw new Error('帧时长需为 20 到 60000 毫秒内的 10 毫秒整数倍。');
      if (recipe && recipe.size > 1_000_000) throw new Error('配方文件上限 1MB。');
      if (!Number.isInteger(loop) || loop < 0 || loop > 65535)
        throw new Error('循环次数需为 0 到 65535 的整数。');
      const body = {
        name: `${asset.name.replace(/\.gif$/i, '').slice(0, 102)}-编辑.gif`,
        frames,
        delay,
        loop,
        ...(recipe ? { recipe: JSON.parse(await recipe.text()) } : {}),
      };
      if (!isCurrent(source) || !latest.current.editable) return;
      const bodyKey = JSON.stringify(body);
      if (request.current?.body !== bodyKey) request.current = { body: bodyKey, id: secureUuid() };
      const result = await api<{ asset: Asset; animation: AnimationDescriptor }>(
        `${endpoint}/edit`,
        jsonRequest('POST', { ...body, requestId: request.current.id }),
      );
      if (!isCurrent(source)) return;
      setOutput(result);
      latest.current.onChange();
    } catch (failure) {
      if (isCurrent(source)) setError(errorMessage(failure));
    } finally {
      locked.current = false;
      if (isCurrent(source)) setBusy(false);
    }
  }
  const visible = output?.animation ?? descriptor;
  return (
    <Modal
      title={t('GIF 帧编辑')}
      subtitle={asset.name}
      className="studio-dialog asset-tools-dialog"
      onClose={onClose}
      canClose={() => !busy && !locked.current}
    >
      <div className="stack-form asset-tool-content">
        <InlineError message={error} />
        {!descriptor && !error && <Busy label={t('读取 GIF')} />}
        {descriptor && visible && (
          <>
            <figure className="asset-animation-preview">
              <img
                src={`/v1/assets/${output?.asset.id ?? asset.id}/animation/file`}
                alt={t('GIF 预览')}
              />
              <figcaption>
                <p className="asset-tool-summary" role={output ? 'status' : undefined}>
                  {visible.width}×{visible.height} · {visible.frames} {t('帧 ·')}{' '}
                  {(visible.delay.reduce((sum, value) => sum + value, 0) / 1000).toFixed(2)}{' '}
                  {t('秒')}
                  {output && (
                    <span>
                      {t('已另存为')}
                      {output.asset.name}
                    </span>
                  )}
                </p>
                <a
                  className="text-button"
                  href={`/v1/assets/${output?.asset.id ?? asset.id}/animation/file`}
                  download={output?.asset.name ?? asset.name}
                >
                  <StudioGlyph name="export" />
                  {t('下载 GIF')}
                </a>
              </figcaption>
            </figure>
            {editable && (
              <>
                <label>
                  {t('帧顺序')}
                  <input
                    value={order}
                    maxLength={490}
                    disabled={busy}
                    onChange={(event) => setOrder(event.target.value)}
                    placeholder={t('例如 4, 3, 2, 1，留空使用全部原顺序')}
                  />
                </label>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    setOrder(
                      Array.from(
                        { length: descriptor.frames },
                        (_, index) => descriptor.frames - index,
                      ).join(', '),
                    )
                  }
                >
                  {t('反转帧顺序')}
                </button>
                <div className="asset-tool-fields">
                  <label>
                    {t('统一帧时长（毫秒）')}
                    <input
                      type="number"
                      min={20}
                      max={60000}
                      step={10}
                      value={uniformDelay}
                      disabled={busy}
                      onChange={(event) => setUniformDelay(event.target.value)}
                      placeholder={t('留空保留每帧时长')}
                    />
                  </label>
                  <label>
                    {t('循环次数（0 为持续循环）')}
                    <input
                      type="number"
                      min={0}
                      max={65535}
                      value={loop}
                      disabled={busy}
                      onChange={(event) => setLoop(Number(event.target.value))}
                    />
                  </label>
                </div>
                <label>
                  {t('逐帧应用编辑配方')}
                  <input
                    type="file"
                    accept=".json,application/json"
                    disabled={busy}
                    onChange={(event) => setRecipe(event.target.files?.[0] ?? null)}
                  />
                </label>
                <button
                  className="button button-primary"
                  disabled={busy || !Number.isInteger(loop) || loop < 0 || loop > 65535}
                  onClick={() => void save()}
                >
                  {busy ? <Busy label={t('正在编码')} /> : t('另存为项目动图')}
                </button>
              </>
            )}
            {!editable && (
              <p className="control-note">{t('当前项目为只读权限，可预览和下载动图。')}</p>
            )}
            {editable && (
              <p className="control-note">
                {t('帧编号从 1 开始，可重排或重复选帧。新动图另存到项目，原文件保留。')}
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

export function ProjectAssetTools({
  projectId,
  onClose,
  onCreated,
  onOpenCollage,
}: {
  projectId: string;
  onClose(): void;
  onCreated(asset: Asset): void;
  onOpenCollage(): void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [size, setSize] = useState({ width: 1600, height: 1200, columns: 2, gap: 12 });
  const [fit, setFit] = useState<'cover' | 'contain'>('cover');
  const [transparent, setTransparent] = useState(false);
  const [gif, setGif] = useState<File | null>(null);
  const [tab, setTab] = useState<'collage' | 'gif'>('collage');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [capability, setCapability] = useState<Capability | null>(null);
  const [capabilityError, setCapabilityError] = useState('');
  const [capabilityAttempt, setCapabilityAttempt] = useState(0);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [sourceQuery, setSourceQuery] = useState({ cursor: '', attempt: 0 });
  const [sourceError, setSourceError] = useState('');
  const [sourceLoading, setSourceLoading] = useState(true);
  const sourcesScroll = useRef<HTMLDivElement>(null);
  const id = useRef<{ key: string; id: string } | null>(null);
  const mounted = useRef(true);
  const locked = useRef(false);
  const latest = useRef({ projectId, assets, onCreated });
  latest.current = { projectId, assets, onCreated };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setCapabilityError('');
    void api<Capability>('/asset-processing/capabilities', { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setCapability(result);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setCapabilityError(errorMessage(failure));
      });
    return () => controller.abort();
  }, [capabilityAttempt]);
  useEffect(() => {
    if (tab !== 'collage') return;
    const controller = new AbortController();
    const query = new URLSearchParams({ limit: '50' });
    if (sourceQuery.cursor) query.set('cursor', sourceQuery.cursor);
    setSourceLoading(true);
    setSourceError('');
    void api<{ assets: Asset[]; nextCursor: string | null }>(
      `/projects/${projectId}/assets?${query}`,
      { signal: controller.signal },
    ).then((page) => {
      if (controller.signal.aborted) return;
      setAssets((previous) => sourceQuery.cursor ? [
        ...previous, ...page.assets.filter((asset) => !previous.some((existing) => existing.id === asset.id)),
      ] : page.assets);
      setNextCursor(page.nextCursor);
    }).catch((failure) => {
      if (!controller.signal.aborted) setSourceError(errorMessage(failure));
    }).finally(() => {
      if (!controller.signal.aborted) setSourceLoading(false);
    });
    return () => controller.abort();
  }, [projectId, sourceQuery, tab]);
  const gifLimits = capability?.animation;
  async function submit(kind: 'collage' | 'gif') {
    if (!mounted.current || busy || locked.current) return;
    const sourceProject = latest.current.projectId;
    const isCurrent = () => mounted.current && latest.current.projectId === sourceProject;
    locked.current = true;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      let path: string, init: RequestInit;
      const requestId = (key: string) => {
        if (id.current?.key !== key) id.current = { key, id: secureUuid() };
        return id.current.id;
      };
      if (kind === 'gif') {
        if (!gif) throw new Error('请先选择 GIF 文件。');
        if (!gifLimits?.formats.includes('gif'))
          throw new Error('请先读取当前服务的 GIF 导入能力。');
        if (gif.size > gifLimits.maxBytes)
          throw new Error(
            t('GIF 文件不能超过 {size} MiB。', {
              size: (gifLimits.maxBytes / 1024 / 1024).toFixed(0),
            }),
          );
        const form = new FormData();
        form.append('file', gif);
        path = `/projects/${sourceProject}/animations?requestId=${requestId(`${gif.name}:${gif.size}:${gif.lastModified}`)}`;
        init = { method: 'POST', body: form };
      } else {
        const { width, height, columns, gap } = size;
        if (
          selected.length < 2 ||
          selected.length > 12 ||
          selected.some(
            (id) =>
              !latest.current.assets.some(
                (asset) => asset.id === id && asset.projectId === sourceProject,
              ),
          ) ||
          ![width, height, columns, gap].every(Number.isInteger) ||
          width < 1 ||
          width > 8192 ||
          height < 1 ||
          height > 8192 ||
          width * height > 16_777_216 ||
          columns < 1 ||
          columns > 6 ||
          gap < 0
        )
          throw new Error(
            '请选择当前项目中的 2 到 12 张图。画布单边不能超过 8192 像素，总计不能超过 16,777,216 像素。',
          );
        const rows = Math.ceil(selected.length / columns);
        const cellWidth = Math.floor((width - (columns + 1) * gap) / columns);
        const cellHeight = Math.floor((height - (rows + 1) * gap) / rows);
        if (cellWidth < 1 || cellHeight < 1) throw new Error('间距超出画布，无法放置素材。');
        const body = {
          kind: 'collage',
          name: '拼图.png',
          width,
          height,
          background: [255, 255, 255, transparent ? 0 : 255],
          cells: selected.map((assetId, i) => ({
            assetId,
            left: gap + (i % columns) * (cellWidth + gap),
            top: gap + Math.floor(i / columns) * (cellHeight + gap),
            width: cellWidth,
            height: cellHeight,
            fit,
          })),
        };
        path = `/projects/${sourceProject}/derived-assets`;
        init = jsonRequest('POST', { ...body, requestId: requestId(JSON.stringify(body)) });
      }
      const { asset } = await api<{ asset: Asset }>(path, init);
      if (!isCurrent()) return;
      setStatus(t('{name} 已保存到项目素材。', { name: asset.name }));
      latest.current.onCreated(asset);
    } catch (failure) {
      if (isCurrent()) setError(errorMessage(failure));
    } finally {
      locked.current = false;
      if (isCurrent()) setBusy(false);
    }
  }
  return (
    <Modal
      title={t('拼图与 GIF')}
      hideTitle
      className="studio-dialog asset-tools-dialog project-asset-tools"
      onClose={onClose}
      canClose={() => !busy && !locked.current}
    >
      <div className="project-asset-switch" role="group" aria-label={t('素材操作')}>
        <button type="button" aria-pressed={tab === 'collage'} disabled={busy} onClick={() => { setTab('collage'); setError(''); setStatus(''); }}>
          <StudioGlyph name="collage" size={17} />{t('拼图')}
        </button>
        <button type="button" aria-pressed={tab === 'gif'} disabled={busy} onClick={() => { setTab('gif'); setError(''); setStatus(''); }}>
          <StudioGlyph name="import" size={17} />{t('导入 GIF')}
        </button>
      </div>
      <div className="stack-form asset-tool-content" data-operation={tab}>
        <InlineError message={error} />
        {status && (
          <p role="status">
            <StatusMark state="done" size="small" label={t(status)} />
          </p>
        )}
        {tab === 'gif' && <section className="asset-tool-section project-gif-section" aria-label={t('导入完整动图')}>
          <h3>
            <StudioGlyph name="import" />
            {t('导入完整动图')}
          </h3>
          <label>
            {t('导入 GIF')}
            <input
              type="file"
              accept=".gif,image/gif"
              disabled={busy}
              onChange={(event) => {
                setGif(event.target.files?.[0] ?? null);
                id.current = null;
              }}
            />
          </label>
          <button
            className="button button-secondary"
            disabled={!gif || busy || !gifLimits?.formats.includes('gif')}
            onClick={() => void submit('gif')}
          >
            {t('保留全部帧并导入')}
          </button>
          {gifLimits && (
            <p className="control-note">
              {t('当前服务支持 GIF：文件最多')}
              {(gifLimits.maxBytes / 1024 / 1024).toFixed(0)} MiB、
              {gifLimits.maxFrames} {t('帧，每帧最多')}
              {gifLimits.maxFramePixels.toLocaleString(getLocale())} {t('像素，全部帧合计最多')}
              {gifLimits.maxTotalPixels.toLocaleString(getLocale())} {t('像素。')}
            </p>
          )}
          {!gifLimits && !capabilityError && <Busy label={t('读取动图处理能力')} />}
          {capabilityError && (
            <>
              <InlineError message={capabilityError} />
              <button
                className="text-button"
                type="button"
                onClick={() => setCapabilityAttempt((value) => value + 1)}
              >
                {t('重新读取处理能力')}
              </button>
            </>
          )}
        </section>}
        {tab === 'collage' && <>
          <section className="asset-tool-section project-collage-sources" aria-label={t('选择拼图素材')}>
            <h3>{t('项目素材')} <small>{selected.length}/12</small></h3>
            <div className="project-collage-scroll">
            <div className="asset-tool-asset-list asset-source-options" ref={sourcesScroll}>
              {assets.map((asset) => (
                <CheckControl
                  key={asset.id}
                  className="asset-tool-asset-choice"
                  checked={selected.includes(asset.id)}
                  disabled={busy || (!selected.includes(asset.id) && selected.length >= 12)}
                  onChange={(event) =>
                    setSelected((old) =>
                      event.target.checked
                        ? [...old, asset.id]
                        : old.filter((id) => id !== asset.id),
                    )
                  }
                  label={
                    <span className="asset-choice-content">
                      <span className="asset-choice-preview" aria-hidden="true">
                        <StudioGlyph name="works" />
                        <img
                          src={asset.thumbnailUrl ?? `/v1/assets/${asset.id}/thumbnail`}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          onError={(event) => {
                            event.currentTarget.hidden = true;
                          }}
                        />
                      </span>
                      <span className="asset-choice-name">
                        {asset.annotations?.title ?? asset.name}
                        <small>
                          {asset.width}×{asset.height}
                        </small>
                      </span>
                      {selected.includes(asset.id) && (
                        <span
                          className="asset-tool-order"
                          aria-label={t('第 {v0} 张', { v0: selected.indexOf(asset.id) + 1 })}
                        >
                          {selected.indexOf(asset.id) + 1}
                        </span>
                      )}
                    </span>
                  }
                />
              ))}
              {sourceLoading && <Busy label={t('读取当前授权范围')} />}
              {sourceError && <div role="alert" className="control-note">
                {sourceError}
                <button className="text-button" type="button"
                  onClick={() => setSourceQuery((current) => ({ ...current, attempt: current.attempt + 1 }))}>
                  {t('重试')}
                </button>
              </div>}
              {!sourceLoading && !sourceError && nextCursor && (
                <button className="text-button" type="button" disabled={busy}
                  onClick={() => setSourceQuery({ cursor: nextCursor, attempt: 0 })}>
                  {t('载入更多素材')}
                </button>
              )}
              {!assets.length && !sourceLoading && !sourceError && (
                <p className="control-note">
                  {t('这里还没有素材')}
                </p>
              )}
            </div>
            <GradualBlur position="top" container={sourcesScroll} height={20} strength={1.6} autoHide />
            <GradualBlur position="bottom" container={sourcesScroll} height={20} strength={1.6} autoHide />
            </div>
          </section>
          <section className="asset-tool-section project-collage-config" aria-label={t('创建拼图')}>
          <h3>{t('拼图设置')}</h3>
          <div className="asset-tool-fields asset-size-fields">
            {(
              [
                ['width', t('画布宽')],
                ['height', t('画布高')],
                ['columns', t('列数')],
                ['gap', t('间距')],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  min={key === 'gap' ? 0 : 1}
                  max={key === 'columns' ? 6 : 8192}
                  disabled={busy}
                  value={size[key]}
                  onChange={(event) => setSize({ ...size, [key]: Number(event.target.value) })}
                />
              </label>
            ))}
          </div>
          <div className="project-collage-options">
          <div className="tonal-tabs" role="group" aria-label={t('拼图适应方式')}>
            {([['cover', '填满网格'], ['contain', '完整保留']] as const).map(([value, label]) => (
              <button key={value} type="button" disabled={busy} aria-pressed={fit === value}
                onClick={() => setFit(value)}>{t(label)}</button>
            ))}
          </div>
          <CheckControl
            className="asset-tool-checkbox"
            disabled={busy}
            checked={transparent}
            onChange={(event) => setTransparent(event.target.checked)}
            label={t('透明间距')}
          />
          </div>
          <div className="project-collage-actions">
          <button
            className="button button-primary"
            disabled={selected.length < 2 || busy}
            onClick={() => void submit('collage')}
          >
            {busy ? t('正在处理') : t('生成拼图素材')}
          </button>
          <button type="button" className="text-button" disabled={busy} onClick={onOpenCollage}>
            <StudioGlyph name="collage" size={16} />{t('打开拼图编辑器')}
          </button>
          </div>
          </section>
        </>}
      </div>
    </Modal>
  );
}
