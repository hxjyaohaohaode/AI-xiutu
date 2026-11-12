import { useEffect, useRef, useState } from 'react';
import { t, useLocale } from '../i18n';
import { api, errorMessage, filenameBase, jsonRequest } from '../lib/api';
import { secureUuid } from '../lib/uuid';
import type { Asset, Session } from '../lib/types';
import { Busy, InlineError, Modal } from '../components/Ui';
import { StudioGlyph } from '../components/StudioGlyph';
import { CheckControl } from '../components/CheckControl';
import { StatusMark } from '../components/StatusMark';
import {
  buildRestorationRequest,
  executeRestoration,
  initialRestorationDraft,
  readRestorationCapability,
  readRestorationQuote,
  RestorationError,
  RestorationLedger,
  restorationDraftFromRequest,
  type RestorationCapability,
  type RestorationDraft,
  type RestorationOperation,
  type RestorationQuote,
  type RestorationRequest,
  type RestorationScope,
  type RestorationSnapshot,
} from './restoration-model';
import './restoration.css';

const ledger = new RestorationLedger(() => window.sessionStorage);

function failureMessage(error: unknown) {
  if (!(error instanceof RestorationError)) return errorMessage(error);
  switch (error.code) {
    case 'CAPABILITY_UNAVAILABLE':
      return t('当前服务未开放照片修复。');
    case 'INVALID_SETTINGS':
      return t('请检查修复参数，并至少启用一项调整。');
    case 'SOURCE_CHANGED':
    case 'INVALID_SOURCE':
      return t('原图或来源摘要已变化，请重新打开素材。');
    case 'SCOPE_CHANGED':
      return t('账号、素材或编辑权限已变化，请重新打开素材。');
    case 'QUOTE_UNAVAILABLE':
      return t('当前参数超出处理预算，请减少运动长度或迭代次数。');
    case 'JOURNAL_UNAVAILABLE':
      return t('无法保留操作凭证，请允许浏览器会话存储后重试。');
    case 'JOURNAL_INVALID':
      return t('上次操作凭证无法读取，请保留当前页面并联系管理员。');
    case 'REQUEST_BUSY':
      return t('这张原图已有待确认的修复操作。');
    case 'INVALID_RECEIPT':
      return t('处理回执尚未确认，请恢复同一操作。');
    default:
      return t('修复未完成，请稍后重试。');
  }
}
function budgetMessage(quote: RestorationQuote) {
  if (quote.cost.pixels > quote.cost.maxPixels)
    return t('原图超过 {pixels} MP，请先导入较小的副本。', {
      pixels: (quote.cost.maxPixels / 1_000_000).toFixed(1),
    });
  if (quote.limits.includes('ENCODED_INPUT_BUDGET')) return t('原图文件超过处理上限。');
  if (!quote.available) return t('超出处理预算，请减少运动长度或迭代次数。');
  return t('预算检查通过 · {pixels} MP', {
    pixels: (quote.cost.pixels / 1_000_000).toFixed(1),
  });
}

function RestorationImage({ asset, label }: { asset: Asset; label: string }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return (
    <figure className="restoration-image">
      <div style={{ aspectRatio: asset.width + ' / ' + asset.height }}>
        {failed ? (
          <button
            className="text-button"
            type="button"
            onClick={() => {
              setFailed(false);
              setAttempt((value) => value + 1);
            }}
          >
            {t('重载预览')}
          </button>
        ) : (
          <img
            key={attempt}
            src={
              asset.url +
              (attempt ? (asset.url.includes('?') ? '&' : '?') + 'preview=' + attempt : '')
            }
            alt={asset.name}
            decoding="async"
            onError={() => setFailed(true)}
          />
        )}
      </div>
      <figcaption>{label}</figcaption>
    </figure>
  );
}
function Amount({
  label,
  value,
  min = 0,
  max,
  step = 1,
  suffix,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max: number;
  step?: number;
  suffix?: string;
  disabled: boolean;
  onChange(value: number): void;
}) {
  return (
    <label className="restoration-amount">
      <span>{label}</span>
      <span className="restoration-number">
        <input
          type="number"
          value={Number.isFinite(value) ? value : ''}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          aria-label={label}
          onChange={(event) =>
            onChange(event.target.value === '' ? Number.NaN : Number(event.target.value))
          }
        />
        {suffix && <small>{suffix}</small>}
      </span>
      <input
        type="range"
        value={Number.isFinite(value) ? value : min}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function RestorationDialog({
  asset,
  editable,
  onClose,
  onCreated,
  onOpen,
}: {
  asset: Asset;
  editable: boolean;
  onClose(): void;
  onCreated(asset: Asset): void;
  onOpen?(asset: Asset): void;
}) {
  useLocale();
  const [draft, setDraft] = useState<RestorationDraft>({ ...initialRestorationDraft });
  const [capability, setCapability] = useState<RestorationCapability | null>(null);
  const [actorId, setActorId] = useState<string | null>(null);
  const [operation, setOperation] = useState<RestorationOperation | null>(null);
  const [journalReady, setJournalReady] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [estimating, setEstimating] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [quoted, setQuoted] = useState<{
    key: string;
    snapshot: RestorationSnapshot;
    quote: RestorationQuote;
  } | null>(null);
  const quoteRef = useRef(quoted);
  const mounted = useRef(false),
    locked = useRef(false);
  const notified = useRef('');
  const identity = [
    asset.projectId,
    asset.id,
    asset.width,
    asset.height,
    asset.bytes,
    asset.mime,
  ].join(':');
  const suffix = t('修复');
  const outputName = filenameBase(asset.name).slice(0, 115 - suffix.length) + '-' + suffix + '.png';
  const draftKey = JSON.stringify({ identity, actorId, draft, outputName, capability });
  const latest = useRef({
    asset,
    editable,
    actorId,
    identity,
    draftKey,
    onCreated,
    onOpen,
    onClose,
  });
  latest.current = { asset, editable, actorId, identity, draftKey, onCreated, onOpen, onClose };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setInitializing(true);
    setError('');
    setCapability(null);
    setActorId(null);
    void Promise.all([
      api<unknown>('/asset-processing/capabilities', { signal: controller.signal }),
      api<Session>('/session', { signal: controller.signal }),
    ])
      .then(([caps, session]) => {
        if (controller.signal.aborted) return;
        const current = readRestorationCapability(caps);
        setCapability(current);
        setActorId(session.user?.id ?? null);
        if (!session.user) setError(t('请先登录后修复素材。'));
        else if (!current) setError(t('当前服务未开放照片修复。'));
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failureMessage(failure));
      })
      .finally(() => {
        if (!controller.signal.aborted) setInitializing(false);
      });
    return () => controller.abort();
  }, [identity, attempt]);

  useEffect(() => {
    setOperation(null);
    setJournalReady(false);
    if (!actorId) return;
    const scope: RestorationScope = { actorId, projectId: asset.projectId, assetId: asset.id };
    let current = true,
      restored = '';
    const update = () => {
      if (!current) return;
      try {
        const entry = ledger.read(scope);
        setJournalReady(true);
        setOperation(entry);
        if (entry && restored !== entry.snapshot.request.requestId) {
          restored = entry.snapshot.request.requestId;
          setDraft(restorationDraftFromRequest(entry.snapshot.request));
        }
      } catch (failure) {
        setJournalReady(false);
        setError(failureMessage(failure));
      }
    };
    update();
    const unsubscribe = ledger.subscribe(update);
    return () => {
      current = false;
      unsubscribe();
    };
  }, [actorId, identity]);

  useEffect(() => {
    quoteRef.current = null;
    setQuoted(null);
    setEstimating(false);
    if (!actorId || !capability || !editable || !journalReady || operation || initializing) return;
    const controller = new AbortController();
    setEstimating(true);
    // Quotes only check bounds and source identity. They reserve no quota and do not render.
    const timer = window.setTimeout(() => {
      let request: RestorationRequest;
      try {
        request = buildRestorationRequest(asset.id, secureUuid(), outputName, draft, capability);
      } catch (failure) {
        setEstimating(false);
        setError(failureMessage(failure));
        return;
      }
      const capturedKey = draftKey;
      void api<unknown>('/projects/' + asset.projectId + '/derived-assets/quote', {
        ...jsonRequest('POST', request),
        signal: controller.signal,
      })
        .then((value) => {
          if (controller.signal.aborted || latest.current.draftKey !== capturedKey) return;
          const quote = readRestorationQuote(value, asset);
          const result = {
            key: capturedKey,
            quote,
            snapshot: {
              scope: { actorId, projectId: asset.projectId, assetId: asset.id },
              source: quote.sources[0]!,
              request,
            },
          };
          quoteRef.current = result;
          setQuoted(result);
        })
        .catch((failure) => {
          if (!controller.signal.aborted && latest.current.draftKey === capturedKey)
            setError(failureMessage(failure));
        })
        .finally(() => {
          if (!controller.signal.aborted && latest.current.draftKey === capturedKey)
            setEstimating(false);
        });
    }, 900);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [draftKey, operation, editable, journalReady, initializing, attempt]);

  useEffect(() => {
    if (
      operation?.state !== 'done' ||
      !operation.asset ||
      !editable ||
      operation.snapshot.scope.actorId !== actorId ||
      operation.snapshot.scope.projectId !== asset.projectId ||
      operation.snapshot.scope.assetId !== asset.id ||
      notified.current === operation.snapshot.request.requestId
    )
      return;
    notified.current = operation.snapshot.request.requestId;
    // Keep a successful mutation separate from list refresh / navigation callbacks.
    latest.current.onCreated(operation.asset);
  }, [operation, editable, actorId, identity]);

  const busy = executing || operation?.state === 'pending';
  const frozen = busy || operation?.state === 'unknown' || operation?.state === 'done';
  const ready = quoted?.key === draftKey && quoted.quote.available;
  const completed = editable && operation?.state === 'done' ? operation.asset : null;
  const change = <K extends keyof RestorationDraft>(key: K, value: RestorationDraft[K]) => {
    if (locked.current || frozen) return;
    quoteRef.current = null;
    setQuoted(null);
    setError('');
    setDraft((old) => ({ ...old, [key]: value }));
  };
  async function submit() {
    if (
      !mounted.current ||
      locked.current ||
      !editable ||
      !actorId ||
      !journalReady ||
      busy ||
      completed
    )
      return;
    const recovery = operation?.state === 'unknown';
    const quote = quoteRef.current;
    if (!recovery && (!quote || quote.key !== latest.current.draftKey || !quote.quote.available))
      return;
    const snapshot = recovery ? operation!.snapshot : quote!.snapshot;
    const owner = latest.current.identity;
    const isCurrent = () =>
      mounted.current &&
      latest.current.identity === owner &&
      latest.current.actorId === snapshot.scope.actorId &&
      latest.current.editable;
    locked.current = true;
    setExecuting(true);
    setError('');
    try {
      await executeRestoration({
        snapshot,
        recover: recovery,
        ledger,
        isCurrent,
        authorize: async () => {
          const [session, caps] = await Promise.all([
            api<Session>('/session'),
            api<unknown>('/asset-processing/capabilities'),
          ]);
          return { actorId: session.user?.id ?? null, capability: readRestorationCapability(caps) };
        },
        quote: (request) =>
          api<unknown>(
            '/projects/' + snapshot.scope.projectId + '/derived-assets/quote',
            jsonRequest('POST', request),
          ),
        publish: (request) =>
          api<unknown>(
            '/projects/' + snapshot.scope.projectId + '/derived-assets',
            jsonRequest('POST', request),
          ),
      });
    } catch (failure) {
      if (isCurrent()) setError(failureMessage(failure));
    } finally {
      locked.current = false;
      if (mounted.current) setExecuting(false);
    }
  }
  function close() {
    if (locked.current || operation?.state === 'pending') return;
    if (actorId) {
      try {
        ledger.forgetCompleted({ actorId, projectId: asset.projectId, assetId: asset.id });
      } catch {}
    }
    latest.current.onClose();
  }
  return (
    <Modal
      title={t('照片修复')}
      subtitle={asset.name}
      className="restoration-dialog"
      wide
      onClose={close}
      canClose={() => !locked.current && !busy}
    >
      <div className="restoration-layout">
        <div className={'restoration-images' + (completed ? ' is-complete' : '')}>
          <RestorationImage key={asset.id} asset={asset} label={t('原图 · 整图')} />
          {completed && (
            <RestorationImage key={completed.id} asset={completed} label={t('修复副本')} />
          )}
        </div>
        <div className="restoration-controls">
          <div className="restoration-modes" role="group" aria-label={t('修复模式')}>
            {(['denoise', 'motion'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={draft.mode === mode}
                disabled={frozen || initializing || !editable}
                onClick={() => change('mode', mode)}
              >
                {mode === 'denoise' ? t('降噪') : t('运动模糊')}
              </button>
            ))}
          </div>
          {draft.mode === 'motion' && (
            <>
              <Amount
                label={t('运动长度')}
                value={draft.length}
                min={0}
                max={capability?.maxMotionLength ?? 31}
                step={0.5}
                suffix={t('源像素')}
                disabled={frozen || !editable}
                onChange={(value) => change('length', value)}
              />
              <Amount
                label={t('运动角度')}
                value={draft.angle}
                min={-180}
                max={180}
                suffix="°"
                disabled={frozen || !editable}
                onChange={(value) => change('angle', value)}
              />
              <Amount
                label={t('修复强度')}
                value={draft.strength}
                max={100}
                suffix="%"
                disabled={frozen || !editable}
                onChange={(value) => change('strength', value)}
              />
              <p className="restoration-hint">{t('按已知运动方向调整，不自动推测模糊方向。')}</p>
              <details className="restoration-extra">
                <summary>{t('更多参数')}</summary>
                <label className="restoration-iterations">
                  {t('迭代次数')}
                  <input
                    type="number"
                    value={Number.isFinite(draft.iterations) ? draft.iterations : ''}
                    min={1}
                    max={capability?.maxIterations ?? 12}
                    step={1}
                    disabled={frozen || !editable}
                    onChange={(event) =>
                      change(
                        'iterations',
                        event.target.value === '' ? Number.NaN : Number(event.target.value),
                      )
                    }
                  />
                </label>
                <CheckControl
                  className="restoration-check"
                  checked={draft.denoiseWithMotion}
                  disabled={frozen || !editable}
                  label={t('同时降噪')}
                  onChange={(event) => change('denoiseWithMotion', event.target.checked)}
                />
              </details>
            </>
          )}
          {(draft.mode === 'denoise' || draft.denoiseWithMotion) && (
            <>
              <Amount
                label={t('亮度降噪')}
                value={draft.luminance}
                max={100}
                suffix="%"
                disabled={frozen || !editable}
                onChange={(value) => change('luminance', value)}
              />
              <Amount
                label={t('色彩降噪')}
                value={draft.chroma}
                max={100}
                suffix="%"
                disabled={frozen || !editable}
                onChange={(value) => change('chroma', value)}
              />
            </>
          )}
        </div>
      </div>
      <footer className="restoration-footer">
        <div className="restoration-status" aria-live="polite">
          {!editable ? (
            <InlineError message={t('需要项目编辑权限才能修复素材。')} />
          ) : (
            <>
              {initializing && <Busy label={t('读取处理能力')} />}
              {!initializing && estimating && !operation && <Busy label={t('检查处理预算')} />}
              {quoted && !operation && (
                <p className={quoted.quote.available ? '' : 'restoration-limit'}>
                  {budgetMessage(quoted.quote)}
                </p>
              )}
              {busy && <Busy label={t('正在处理原图')} />}
              {operation?.state === 'unknown' && (
                <StatusMark
                  state="unknown"
                  size="small"
                  label={t('结果待确认。恢复会沿用同一操作凭证。')}
                />
              )}
              {completed && (
                <StatusMark state="done" size="small" label={t('修复副本已保存到项目素材。')} />
              )}
              <InlineError message={error} />
            </>
          )}
          {!completed && <small>{t('生成新素材，保留原图。估算不占额度。')}</small>}
        </div>
        <div className="restoration-actions">
          {completed ? (
            <button
              className="button button-primary"
              type="button"
              onClick={() => {
                if (latest.current.onOpen) latest.current.onOpen(completed);
                close();
              }}
            >
              {onOpen ? t('打开修复副本') : t('完成')}
            </button>
          ) : (
            <button
              className="button button-primary"
              type="button"
              disabled={
                !editable ||
                !journalReady ||
                busy ||
                initializing ||
                !actorId ||
                (!ready && operation?.state !== 'unknown')
              }
              onClick={() => void submit()}
            >
              <StudioGlyph name="repair" size={18} />
              {busy
                ? t('正在处理')
                : operation?.state === 'unknown'
                  ? t('恢复上次处理')
                  : t('创建修复副本')}
            </button>
          )}
          {!busy && !initializing && error && !operation && (
            <button
              className="text-button"
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
            >
              {t('重新检查')}
            </button>
          )}
        </div>
      </footer>
    </Modal>
  );
}
