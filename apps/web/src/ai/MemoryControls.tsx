import { MotionDetails } from '../motion/Presence';
import { useEffect, useRef, useState } from 'react';
import type { AssistantMemory, MemorySuggestion } from '@ai-xiutu/contracts';
import { api, errorMessage, jsonRequest } from '../lib/api';
import { ChoiceSelect } from '../components/ChoiceSelect';

const scopes = {
  user: '仅我的偏好',
  team: '团队共同要求',
  project: '当前项目',
  artwork: '当前作品',
};
interface MemoryVersion {
  version: number;
  title: string;
  content: string;
  deleted: boolean;
  expiresAt: string | null;
  createdAt: string;
}
function localDate(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}
export function MemoryControls({
  projectId,
  artworkId,
  sourceTurnId,
  disabled,
  suggestions,
}: {
  projectId: string;
  artworkId?: string;
  sourceTurnId?: string;
  disabled: boolean;
  suggestions?: { items: MemorySuggestion[]; sourceTurnId?: string };
}) {
  const [items, setItems] = useState<AssistantMemory[]>([]),
    [epoch, setEpoch] = useState(0);
  const [editing, setEditing] = useState<AssistantMemory | null>(null),
    [scope, setScope] = useState<AssistantMemory['scope']>('project');
  const [category, setCategory] = useState<AssistantMemory['category']>('constraint');
  const [title, setTitle] = useState(''),
    [content, setContent] = useState('');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [expiresAt, setExpiresAt] = useState(''),
    [includeExpired, setIncludeExpired] = useState(false);
  const [page, setPage] = useState(0),
    [hasMore, setHasMore] = useState(false);
  const [history, setHistory] = useState<{
    id: string;
    title: string;
    versions: MemoryVersion[];
    hasMore: boolean;
  } | null>(null);
  const historyRequest = useRef<AbortController | null>(null);
  const saveLock = useRef(false);
  const [suggestionSource, setSuggestionSource] = useState<{
    key: string;
    sourceTurnId?: string;
  } | null>(null);
  const [dismissed, setDismissed] = useState(new Set<string>());
  const suggested = (suggestions?.items ?? [])
    .map((item, index) => ({
      item,
      key: `${suggestions?.sourceTurnId ?? 'voice'}:${index}:${item.title}`,
    }))
    .filter(
      ({ item, key }) =>
        !dismissed.has(key) &&
        !items.some(
          (saved) => saved.sourceTurnId === suggestions?.sourceTurnId && saved.title === item.title,
        ),
    );
  useEffect(() => () => historyRequest.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    const query = new URLSearchParams({
      page: String(page),
      includeExpired: String(includeExpired),
      ...(artworkId ? { artworkId } : {}),
    });
    void api<{ memories: AssistantMemory[]; hasMore: boolean }>(
      `/projects/${projectId}/assistant-memory?${query}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          setItems(result.memories);
          setHasMore(result.hasMore);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(errorMessage(err));
      });
    return () => controller.abort();
  }, [projectId, artworkId, epoch, includeExpired, page]);
  async function showHistory(item: { id: string; title: string }, beforeVersion?: number) {
    historyRequest.current?.abort();
    const controller = new AbortController();
    historyRequest.current = controller;
    setError('');
    if (!beforeVersion) setHistory(null);
    try {
      const result = await api<{ versions: MemoryVersion[]; hasMore: boolean }>(
        `/projects/${projectId}/assistant-memory/${item.id}/history${beforeVersion ? `?beforeVersion=${beforeVersion}` : ''}`,
        { signal: controller.signal },
      );
      if (!controller.signal.aborted)
        setHistory((old) => ({
          id: item.id,
          title: item.title,
          hasMore: result.hasMore,
          versions: [
            ...(beforeVersion && old?.id === item.id ? old.versions : []),
            ...result.versions,
          ],
        }));
    } catch (err) {
      if (!controller.signal.aborted) setError(errorMessage(err));
    }
  }
  async function save() {
    if (saveLock.current || busy || disabled || !title.trim() || !content.trim()) return;
    saveLock.current = true;
    setBusy(true);
    setError('');
    try {
      const path = `/projects/${projectId}/assistant-memory`;
      const source = suggestionSource ? suggestionSource.sourceTurnId : sourceTurnId;
      await api(
        editing ? `${path}/${editing.id}` : path,
        jsonRequest(
          editing ? 'PUT' : 'POST',
          editing
            ? {
                title,
                content,
                category,
                expectedVersion: editing.version,
                expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
              }
            : {
                title,
                content,
                category,
                scope,
                expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
                ...(scope === 'artwork' ? { artworkId } : {}),
                ...(source ? { sourceTurnId: source } : {}),
              },
        ),
      );
      setEditing(null);
      setTitle('');
      setContent('');
      setExpiresAt('');
      setPage(0);
      setHistory(null);
      setEpoch((value) => value + 1);
      if (suggestionSource) setDismissed((old) => new Set([...old, suggestionSource.key]));
      setSuggestionSource(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      saveLock.current = false;
      setBusy(false);
    }
  }
  async function forget(item: AssistantMemory) {
    if (busy || disabled) return;
    setBusy(true);
    setError('');
    try {
      await api(
        `/projects/${projectId}/assistant-memory/${item.id}`,
        jsonRequest('DELETE', { expectedVersion: item.version }),
      );
      setEpoch((value) => value + 1);
      setHistory(null);
      if (editing?.id === item.id) {
        setEditing(null);
        setTitle('');
        setContent('');
        setExpiresAt('');
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <MotionDetails className="assistant-context">
      <summary>
        偏好与要求 · {items.length} 条
        {suggested.length ? ` · ${suggested.length} 条待确认建议` : ''}
      </summary>
      <p>保存后可在共享范围中启用。更正会替换当前版本，忘记后不再召回；团队要求由管理员维护。</p>
      {suggested.map(({ item, key }) => (
        <article key={key} className="memory-suggestion">
          <strong>{item.title}</strong>
          <p>{item.content}</p>
          <blockquote>依据你说的：“{item.evidence}”</blockquote>
          <button
            type="button"
            disabled={disabled || busy || (item.scope === 'artwork' && !artworkId)}
            onClick={() => {
              setEditing(null);
              setTitle(item.title);
              setContent(item.content);
              setCategory(item.category);
              setScope(item.scope);
              setExpiresAt('');
              setSuggestionSource({ key, sourceTurnId: suggestions?.sourceTurnId });
            }}
          >
            检查内容与范围
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setDismissed((old) => new Set([...old, key]))}
          >
            暂不记住
          </button>
        </article>
      ))}
      <label className="memory-expiry-filter">
        <input
          type="checkbox"
          checked={includeExpired}
          onChange={(event) => {
            setIncludeExpired(event.target.checked);
            setPage(0);
          }}
        />
        显示已到期的要求
      </label>
      <div className="assistant-memory-list">
        {items.map((item) => (
          <article key={item.id}>
            <strong>{item.title}</strong>
            <small>
              {scopes[item.scope]} · v{item.version}
              {item.expiresAt
                ? ` · ${new Date(item.expiresAt).getTime() <= Date.now() ? '已到期' : '有效至'} ${new Date(item.expiresAt).toLocaleString()}`
                : ' · 长期有效'}
            </small>
            <p>{item.content}</p>
            {item.canEdit && (
              <div>
                <button
                  disabled={busy || disabled}
                  onClick={() => {
                    setEditing(item);
                    setSuggestionSource(null);
                    setTitle(item.title);
                    setContent(item.content);
                    setScope(item.scope);
                    setCategory(item.category);
                    setExpiresAt(localDate(item.expiresAt));
                  }}
                >
                  更正
                </button>
                <button disabled={busy || disabled} onClick={() => void forget(item)}>
                  忘记
                </button>
              </div>
            )}
            <button type="button" onClick={() => void showHistory(item)}>
              版本记录
            </button>
          </article>
        ))}
      </div>
      {(page > 0 || hasMore) && (
        <nav aria-label="记忆分页">
          <button disabled={page === 0} onClick={() => setPage((value) => value - 1)}>
            上一页
          </button>
          <span>第 {page + 1} 页</span>
          <button disabled={!hasMore} onClick={() => setPage((value) => value + 1)}>
            下一页
          </button>
        </nav>
      )}
      {history && (
        <section className="memory-version-history" aria-label="记忆版本记录">
          <h4>{history.title} · 版本记录</h4>
          {history.versions.map((item) => (
            <article key={item.version}>
              <strong>
                v{item.version} · {new Date(item.createdAt).toLocaleString()}
                {item.deleted ? ' · 已忘记' : ''}
              </strong>
              <p>{item.content}</p>
            </article>
          ))}
          {history.hasMore && (
            <button onClick={() => void showHistory(history, history.versions.at(-1)?.version)}>
              更早版本
            </button>
          )}
          <button
            onClick={() => {
              historyRequest.current?.abort();
              setHistory(null);
            }}
          >
            收起记录
          </button>
        </section>
      )}
      <fieldset className="creative-fields" disabled={disabled || busy}>
        <legend>{editing ? '更正要求' : '新增要求'}</legend>
        <div className="creative-pair">
          <ChoiceSelect
            label="生效范围"
            value={scope}
            disabled={disabled || busy || !!editing}
            onValueChange={(nextScope) => setScope(nextScope as AssistantMemory['scope'])}
            options={Object.entries(scopes)
              .filter(([key]) => key !== 'artwork' || artworkId)
              .map(([value, label]) => ({ value, label }))}
          />
          <ChoiceSelect
            label="类型"
            value={category}
            disabled={disabled || busy}
            onValueChange={(nextCategory) =>
              setCategory(nextCategory as AssistantMemory['category'])
            }
            options={[
              { value: 'constraint', label: '编辑要求' },
              { value: 'preference', label: '偏好' },
              { value: 'workflow', label: '工作习惯' },
              { value: 'correction', label: '更正理解' },
            ]}
          />
        </div>
        <label>
          名称
          <input maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          准确内容
          <textarea
            rows={3}
            maxLength={4000}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="例如：本系列只调整背景色调，人物五官、衣服与构图保持不变。"
          />
        </label>
        <label>
          有效至（留空则长期有效）
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={!title.trim() || !content.trim()}
          onClick={() => void save()}
        >
          {busy ? '正在保存…' : editing ? '保存更正' : '确认记住'}
        </button>
        {editing && (
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setTitle('');
              setContent('');
              setExpiresAt('');
            }}
          >
            取消更正
          </button>
        )}
      </fieldset>
      {error && (
        <p role="alert" className="assistant-error">
          {error}
        </p>
      )}
    </MotionDetails>
  );
}
