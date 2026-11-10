import { useEffect, useRef, useState } from 'react';
import type {
  AnimationDescriptor,
  AssetRecognition,
  RecognitionRequest,
} from '@ai-xiutu/contracts';
import { api, errorMessage, jsonRequest } from '../lib/api';
import { secureUuid } from '../lib/uuid';
import type { Asset } from '../lib/types';
import { Busy, InlineError, Modal } from './Ui';

type Capability = { recognition: { engine: string | null; languages: string[] } };
const editableLabels = ['eng', 'chi_sim', 'eng+chi_sim'] as const;
const languageLabel = { eng: '英文', chi_sim: '简体中文', 'eng+chi_sim': '中英混合' };

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
  const url = `/assets/${asset.id}/recognitions`;
  useEffect(() => {
    const controller = new AbortController();
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
      setBusy(false);
    });
    return () => controller.abort();
  }, [url]);
  const current = items.find((item) => item.id === selected);
  const supported = available?.recognition.languages ?? [];
  async function recognize() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const { recognition } = await api<{ recognition: AssetRecognition }>(
        url,
        jsonRequest('POST', { language, layout }),
      );
      setItems((old) => [recognition, ...old.filter((item) => item.id !== recognition.id)]);
      setSelected(recognition.id);
      onChange();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (busy || !current || !window.confirm('删除这份识别结果及对应的搜索索引？')) return;
    setBusy(true);
    setError('');
    try {
      await api(`${url}/${current.id}`, jsonRequest('DELETE'));
      setItems((old) => old.filter((item) => item.id !== current.id));
      setSelected(items.find((item) => item.id !== current.id)?.id ?? '');
      onChange();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="识别文字与表格" subtitle={asset.name} onClose={onClose} canClose={() => !busy}>
      <div className="form-stack">
        <InlineError message={error} />
        {editable && (
          <>
            <label>
              识别语言
              <select
                value={language}
                disabled={busy}
                onChange={(event) => setLanguage(event.target.value as typeof language)}
              >
                {editableLabels.map((value) => (
                  <option
                    key={value}
                    value={value}
                    disabled={value.split('+').some((item) => !supported.includes(item))}
                  >
                    {languageLabel[value]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              版面
              <select
                value={layout}
                disabled={busy}
                onChange={(event) => setLayout(event.target.value as typeof layout)}
              >
                <option value="auto">自动版面</option>
                <option value="block">连续段落</option>
                <option value="sparse">零散文字</option>
                <option value="table">对齐表格</option>
              </select>
            </label>
            <button
              className="button button-primary"
              disabled={busy || !supported.length}
              onClick={() => void recognize()}
            >
              识别并存入素材
            </button>
            {!busy && !supported.length && <small>当前服务未提供可用的 OCR 语言包。</small>}
          </>
        )}
        {busy && <Busy label="处理识别结果" />}
        {!!items.length && (
          <label>
            识别记录
            <select value={selected} onChange={(event) => setSelected(event.target.value)}>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {languageLabel[item.language]} · {item.layout} · {item.createdAt.slice(0, 10)}
                </option>
              ))}
            </select>
          </label>
        )}
        {current && (
          <>
            <small>
              {current.engine} · {current.width}×{current.height} · {current.words.length} 项文字
            </small>
            <label>
              识别文字
              <textarea rows={5} readOnly value={current.text || '未识别到文字'} />
            </label>
            {current.table ? (
              <div
                className="usage-table-scroll"
                tabIndex={0}
                role="region"
                aria-label="识别出的表格"
              >
                <table className="usage-table">
                  <caption>按文字坐标推断的表格</caption>
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
                <small>未找到一致的列结构，已保留识别文字与位置。</small>
              )
            )}
            {editable && (
              <button className="text-button" disabled={busy} onClick={() => void remove()}>
                删除这份识别结果
              </button>
            )}
          </>
        )}
      </div>
    </Modal>
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
  const endpoint = `/assets/${asset.id}/animation`;
  useEffect(() => {
    const controller = new AbortController();
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
    if (busy || !descriptor) return;
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
      const body = {
        name: `${asset.name.replace(/\.gif$/i, '').slice(0, 102)}-编辑.gif`,
        frames,
        delay,
        loop,
        ...(recipe ? { recipe: JSON.parse(await recipe.text()) } : {}),
      };
      const bodyKey = JSON.stringify(body);
      if (request.current?.body !== bodyKey) request.current = { body: bodyKey, id: secureUuid() };
      const result = await api<{ asset: Asset; animation: AnimationDescriptor }>(
        `${endpoint}/edit`,
        jsonRequest('POST', { ...body, requestId: request.current.id }),
      );
      setOutput(result);
      onChange();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  const visible = output?.animation ?? descriptor;
  return (
    <Modal title="GIF 帧编辑" subtitle={asset.name} onClose={onClose} canClose={() => !busy}>
      <div className="form-stack">
        <InlineError message={error} />
        {!descriptor && !error && <Busy label="读取 GIF" />}
        {descriptor && visible && (
          <>
            <img
              className="asset-animation-preview"
              src={`/v1/assets/${output?.asset.id ?? asset.id}/animation/file`}
              alt="GIF 预览"
            />
            <small>
              {visible.width}×{visible.height} · {visible.frames} 帧 ·{' '}
              {visible.delay.reduce((sum, value) => sum + value, 0)}ms
            </small>
            <a
              className="text-button"
              href={`/v1/assets/${output?.asset.id ?? asset.id}/animation/file`}
              download={output?.asset.name ?? asset.name}
            >
              下载 GIF
            </a>
            {editable && (
              <>
                <label>
                  帧顺序
                  <input
                    value={order}
                    maxLength={490}
                    disabled={busy}
                    onChange={(event) => setOrder(event.target.value)}
                    placeholder="例如 4, 3, 2, 1，留空使用全部原顺序"
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
                  反转帧顺序
                </button>
                <label>
                  统一帧时长（毫秒）
                  <input
                    type="number"
                    min={20}
                    max={60000}
                    step={10}
                    value={uniformDelay}
                    disabled={busy}
                    onChange={(event) => setUniformDelay(event.target.value)}
                    placeholder="留空保留每帧时长"
                  />
                </label>
                <label>
                  循环次数（0 为持续循环）
                  <input
                    type="number"
                    min={0}
                    max={65535}
                    value={loop}
                    disabled={busy}
                    onChange={(event) => setLoop(Number(event.target.value))}
                  />
                </label>
                <label>
                  逐帧应用编辑配方
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
                  {busy ? '正在编码' : '另存为项目动图'}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

export function ProjectAssetTools({
  projectId,
  assets,
  onClose,
  onCreated,
}: {
  projectId: string;
  assets: Asset[];
  onClose(): void;
  onCreated(asset: Asset): void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [size, setSize] = useState({ width: 1600, height: 1200, columns: 2, gap: 12 });
  const [fit, setFit] = useState<'cover' | 'contain'>('cover');
  const [transparent, setTransparent] = useState(false);
  const [gif, setGif] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const id = useRef<{ key: string; id: string } | null>(null);
  async function submit(kind: 'collage' | 'gif') {
    if (busy) return;
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
        const form = new FormData();
        form.append('file', gif);
        path = `/projects/${projectId}/animations?requestId=${requestId(`${gif.name}:${gif.size}:${gif.lastModified}`)}`;
        init = { method: 'POST', body: form };
      } else {
        const { width, height, columns, gap } = size;
        if (
          selected.length < 2 ||
          ![width, height, columns, gap].every(Number.isInteger) ||
          width < 1 ||
          height < 1 ||
          columns < 1 ||
          columns > 6 ||
          gap < 0
        )
          throw new Error('至少选择两张图，并填写有效的画布、列数与间距。');
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
        path = `/projects/${projectId}/derived-assets`;
        init = jsonRequest('POST', { ...body, requestId: requestId(JSON.stringify(body)) });
      }
      const { asset } = await api<{ asset: Asset }>(path, init);
      setStatus(`${asset.name} 已保存到项目素材。`);
      onCreated(asset);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="拼图与 GIF" onClose={onClose} canClose={() => !busy}>
      <div className="form-stack">
        <InlineError message={error} />
        {status && <p role="status">{status}</p>}
        <label>
          导入 GIF
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
          disabled={!gif || busy}
          onClick={() => void submit('gif')}
        >
          保留全部帧并导入
        </button>
        <details>
          <summary>选择拼图素材（已选 {selected.length}）</summary>
          <div className="form-stack">
            {assets.map((asset) => (
              <label key={asset.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(asset.id)}
                  disabled={busy || (!selected.includes(asset.id) && selected.length >= 12)}
                  onChange={(event) =>
                    setSelected((old) =>
                      event.target.checked
                        ? [...old, asset.id]
                        : old.filter((id) => id !== asset.id),
                    )
                  }
                />
                {asset.annotations?.title ?? asset.name}
              </label>
            ))}
          </div>
        </details>
        {(
          [
            ['width', '画布宽'],
            ['height', '画布高'],
            ['columns', '列数'],
            ['gap', '间距'],
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
        <label>
          适应方式
          <select
            value={fit}
            disabled={busy}
            onChange={(event) => setFit(event.target.value === 'contain' ? 'contain' : 'cover')}
          >
            <option value="cover">填满网格</option>
            <option value="contain">完整保留</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            disabled={busy}
            checked={transparent}
            onChange={(event) => setTransparent(event.target.checked)}
          />
          透明间距
        </label>
        <button
          className="button button-primary"
          disabled={selected.length < 2 || busy}
          onClick={() => void submit('collage')}
        >
          {busy ? '正在处理' : '生成拼图素材'}
        </button>
      </div>
    </Modal>
  );
}
