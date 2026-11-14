
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Plus, QrCode, Trash, UploadSimple } from '@phosphor-icons/react';
import { formatNumber, t, useLocale } from '../i18n';
import { api, ApiError, errorMessage, jsonRequest } from '../lib/api';
import type { SupportSettings, SupportTier } from '../lib/types';
import { InlineError } from './Ui';
import './support-ops.css';

type Draft = { id: number; amount: string; points: string };
function yuanToCents(value: string) {
  const match = /^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return 0;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

export function SupportOps({ onGrant }: { onGrant: () => void }) {
  useLocale();
  const inputId = useId();
  const [settings, setSettings] = useState<SupportSettings | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [rows, setRows] = useState<Draft[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [candidate, setCandidate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const alive = useRef(false);
  const lock = useRef(false);
  const nextId = useRef(0);
  const uploadField = useRef<HTMLInputElement>(null);

  function apply(value: SupportSettings) {
    setSettings(value);
    setEnabled(value.enabled);
    setRows(value.tiers.map(({ cents, points }) => ({
      id: nextId.current++, amount: (cents / 100).toFixed(2), points: String(points),
    })));
    setConflict(false);
  }
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void api<SupportSettings>('/ops/support', { signal: controller.signal }).then(
      (result) => { if (!controller.signal.aborted) apply(result); },
      (failure) => { if (!controller.signal.aborted) setError(errorMessage(failure)); },
    );
    return () => { alive.current = false; controller.abort(); };
  }, []);
  useEffect(() => {
    if (!file) { setCandidate(null); return; }
    const url = URL.createObjectURL(file);
    setCandidate(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function action(work: () => Promise<void>) {
    if (!alive.current || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      await work();
    } catch (failure) {
      if (!alive.current) return;
      if (failure instanceof ApiError && failure.code === 'SUPPORT_CONFIG_CHANGED') setConflict(true);
      setError(errorMessage(failure));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function upload(event: FormEvent) {
    event.preventDefault();
    if (!settings || !file || conflict) return;
    void action(async () => {
      const data = new FormData();
      data.set('file', file);
      const value = await api<SupportSettings>(
        '/ops/support/qr?expectedVersion=' + settings.version, { method: 'PUT', body: data },
      );
      if (!alive.current) return;
      setSettings(value); // Keep unsaved tier input when only the picture changes.
      setFile(null);
      if (uploadField.current) uploadField.current.value = '';
      setNotice(t('赞赏码已更新'));
    });
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (!settings || conflict) return;
    const tiers: SupportTier[] = rows.map((row) => ({
      cents: yuanToCents(row.amount), points: Number(row.points),
    }));
    if (!tiers.length || tiers.some(({ cents, points }) =>
      cents < 1 || cents > 10_000_000 || !Number.isInteger(points) || points < 1 || points > 100_000,
    ) || new Set(tiers.map((row) => row.cents)).size !== tiers.length) {
      setError(t('请填写有效金额和整数点数；每个金额只保留一个档位。'));
      return;
    }
    void action(async () => {
      const value = await api<SupportSettings>('/ops/support',
        jsonRequest('PATCH', { enabled, tiers, expectedVersion: settings.version }));
      if (!alive.current) return;
      apply(value);
      setNotice(t('赞赏与兑换设置已保存'));
    });
  }

  return (
    <div className="support-ops">
      <header className="surface ops-section support-ops-heading">
        <div><h2>{t('赞赏与兑换')}</h2>
          <p>{t('管理个人中心显示的微信赞赏码、金额和对应服务点。')}</p></div>
        <button type="button" className="button button-secondary" onClick={onGrant} disabled={busy}>
          {t('核对后发放')} <ArrowRight size={16} />
        </button>
      </header>
      <InlineError message={error && t(error)} />
      {notice && <p className="support-ops-notice" role="status">{notice}</p>}
      {(!settings || conflict) && (
        <button type="button" className="button button-secondary" disabled={busy}
          onClick={() => void action(async () => {
            const value = await api<SupportSettings>('/ops/support');
            if (alive.current) apply(value);
          })}>
          {t(conflict ? '读取当前版本（放弃未保存的档位修改）' : '读取赞赏设置')}
        </button>
      )}
      {settings && <div className="support-ops-grid">
        <form className="surface ops-section support-ops-form" onSubmit={upload}>
          <h3><QrCode size={19} /> {t('微信赞赏码')}</h3>
          <div className="support-ops-code">
            {candidate || settings.previewUrl ? (
              <img key={candidate ?? settings.previewUrl} src={candidate ?? settings.previewUrl!}
                alt={t(candidate ? '待上传的赞赏码' : '当前赞赏码')} />
            ) : <p>{t('尚未设置赞赏码')}</p>}
          </div>
          <p>{t(candidate ? '预览 · 上传后生效' : settings.qrSource === 'deployment'
            ? '当前使用部署时提供的赞赏码' : settings.qrSource ? '当前使用运营上传的赞赏码' : '请选择一张收款方正确的赞赏码。')}</p>
          <label htmlFor={inputId}>{t('选择赞赏码图片')}</label>
          <input id={inputId} ref={uploadField} type="file" accept="image/png,image/jpeg,image/webp"
            disabled={busy || conflict} onChange={(event) => {
              const next = event.target.files?.[0] ?? null;
              setNotice('');
              setError(null);
              if (next && (next.size > 2 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(next.type))) {
                setError(t('请选择 2 MB 以内的 PNG、JPEG 或 WebP 图片。'));
                setFile(null);
                event.target.value = '';
                return;
              }
              setFile(next);
            }} />
          <button className="button button-primary" disabled={!file || busy || conflict}>
            <UploadSimple size={17} /> {t('上传并更新赞赏码')}
          </button>
        </form>
        <form className="surface ops-section support-ops-form" onSubmit={save}>
          <h3>{t('金额与兑换点数')}</h3>
          <label className="support-ops-enable check-control">
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)}
              disabled={busy || conflict} /> {t('个人中心显示微信赞赏')}
          </label>
          <p>{t('已发放的点数不会因改价变动。微信到账后，由运营核对并发放。')}</p>
          <div className="support-ops-tiers">
            <div className="support-ops-tier-labels" aria-hidden>
              <span>{t('金额（元）')}</span><span>{t('服务点')}</span><span />
            </div>
            {rows.map((row, index) => (
              <div className="support-ops-tier" key={row.id}>
                <input inputMode="decimal" required aria-label={t('金额（元）') + ' ' + (index + 1)}
                  value={row.amount} disabled={busy || conflict}
                  onChange={(event) => setRows((items) => items.map((item) =>
                    item.id === row.id ? { ...item, amount: event.target.value } : item))} />
                <input type="number" inputMode="numeric" min={1} max={100000} required
                  aria-label={t('服务点') + ' ' + (index + 1)} value={row.points} disabled={busy || conflict}
                  onChange={(event) => setRows((items) => items.map((item) =>
                    item.id === row.id ? { ...item, points: event.target.value } : item))} />
                <button type="button" className="icon-button" aria-label={t('删除档位') + ' ' + (index + 1)}
                  disabled={busy || conflict || rows.length < 2}
                  onClick={() => setRows((items) => items.filter((item) => item.id !== row.id))}>
                  <Trash size={17} />
                </button>
              </div>
            ))}
          </div>
          <div className="support-ops-actions">
            <button type="button" className="button button-secondary" disabled={busy || conflict || rows.length >= 24}
              onClick={() => setRows([...rows, { id: nextId.current++, amount: '', points: '' }])}>
              <Plus size={17} /> {t('添加档位')}
            </button>
            <button className="button button-primary" disabled={busy || conflict}>
              {t('保存赞赏设置')}
            </button>
          </div>
          <small>{t('配置版本')} {formatNumber(settings.version)}</small>
        </form>
      </div>}
    </div>
  );
}
