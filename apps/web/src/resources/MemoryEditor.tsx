import { LockKey, Trash } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { t, useLocale } from '../i18n';
import { api, errorMessage, jsonRequest } from '../lib/api';
import { confirmStableScope } from '../lib/confirmation-scope';
import { useConfirmation } from '../components/ConfirmationDialog';
import { Busy, InlineError, Modal } from '../components/Ui';
import { MotionDetails } from '../motion/Presence';
import { resourceExperienceCopy } from './experience-copy';
import type { ResourceItem } from './model';
import './resources.css';

export function MemoryEditor({
  item,
  onClose,
  onSaved,
}: {
  item: ResourceItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const c = resourceExperienceCopy(useLocale());
  const [title, setTitle] = useState(item.memory?.title ?? ''),
    [tags, setTags] = useState(item.memory?.tags.join('，') ?? ''),
    [note, setNote] = useState(item.memory?.note ?? '');
  const [remembered, setRemembered] = useState(item.memory?.remembered ?? true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const confirmation = useConfirmation();
  const mounted = useRef(false);
  const locked = useRef(false);
  const latest = useRef({ item, title, tags, note, remembered, busy, onClose, onSaved });
  latest.current = { item, title, tags, note, remembered, busy, onClose, onSaved };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const readMemory = () => ({
    mounted: mounted.current,
    item: latest.current.item,
    assetId: latest.current.item.asset.id,
    projectId: latest.current.item.asset.projectId,
    version: latest.current.item.memory?.version,
    title: latest.current.title,
    tags: latest.current.tags,
    note: latest.current.note,
    remembered: latest.current.remembered,
    busy: latest.current.busy,
    locked: locked.current,
  });
  async function canClose() {
    const current = latest.current;
    if (locked.current || current.busy) return false;
    const dirty =
      current.title !== (current.item.memory?.title ?? '') ||
      current.tags !== (current.item.memory?.tags.join('，') ?? '') ||
      current.note !== (current.item.memory?.note ?? '') ||
      current.remembered !== (current.item.memory?.remembered ?? true);
    if (!dirty) return true;
    const outcome = await confirmStableScope(readMemory, () =>
      confirmation.confirm({
        description: c.unsavedMemory,
        confirmLabel: c.discardMemory,
        tone: 'danger',
      }),
    );
    if (outcome === 'changed' && mounted.current) setError('素材或个人标注已经变化，请重新核对。');
    return outcome === 'confirmed';
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!mounted.current || locked.current || busy) return;
    locked.current = true;
    const savedItem = item;
    const isCurrent = () => mounted.current && latest.current.item === savedItem;
    setBusy(true);
    setError(null);
    try {
      const values = [
        ...new Set(
          tags
            .split(/[,，\n]/)
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      ];
      if (values.length > 30 || values.some((s) => s.length > 40))
        throw new Error('最多30个标签，每个不超过40字。');
      await api(
        `/assets/${item.asset.id}/memory`,
        jsonRequest('PUT', {
          expectedVersion: item.memory?.version ?? 0,
          remembered,
          title: title.trim() || null,
          tags: values,
          note: note.trim(),
        }),
      );
      if (isCurrent()) {
        latest.current.onSaved();
        latest.current.onClose();
      }
    } catch (e) {
      if (isCurrent()) setError(errorMessage(e));
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function remove() {
    if (!mounted.current || !latest.current.item.memory || latest.current.busy || locked.current)
      return;
    const outcome = await confirmStableScope(readMemory, () =>
      confirmation.confirm({
        description: t('删除这份个人长期标注？原图和团队素材仍然保留。'),
        confirmLabel: '删除个人标注',
        tone: 'danger',
      }),
    );
    if (outcome !== 'confirmed') {
      if (outcome === 'changed' && mounted.current)
        setError('素材或个人标注已经变化，请重新核对。');
      return;
    }
    if (!mounted.current || locked.current || latest.current.busy || !latest.current.item.memory)
      return;
    const deletedItem = latest.current.item;
    const expectedVersion = deletedItem.memory!.version;
    const isCurrent = () => mounted.current && latest.current.item === deletedItem;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      await api(
        `/assets/${deletedItem.asset.id}/memory`,
        jsonRequest('DELETE', { expectedVersion }),
      );
      if (isCurrent()) {
        latest.current.onSaved();
        latest.current.onClose();
      }
    } catch (e) {
      if (isCurrent()) setError(errorMessage(e));
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <>
      <Modal
        title={t('长期复用说明')}
        subtitle={item.asset.name}
        onClose={onClose}
        canClose={canClose}
      >
        <form className="stack-form" onSubmit={(e) => void save(e)} data-motion="resource-memory">
          <label className="switch-row">
            <span>{t('加入我的长期素材')}</span>
            <input
              type="checkbox"
              checked={remembered}
              disabled={busy}
              onChange={(e) => setRemembered(e.target.checked)}
            />
          </label>
          <label>
            {t('便于查找的名称')}
            <input
              value={title}
              maxLength={200}
              disabled={busy}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            {t('个人标签')}
            <input
              value={tags}
              maxLength={1230}
              disabled={busy}
              onChange={(e) => setTags(e.target.value)}
              placeholder={t('用逗号分隔')}
            />
          </label>
          <label>
            {t('复用时要记得的说明')}
            <textarea
              value={note}
              maxLength={2000}
              rows={4}
              disabled={busy}
              onChange={(e) => setNote(e.target.value)}
              placeholder={c.memoryPlaceholder}
            />
          </label>
          <p className="resource-private-note">
            <LockKey size={15} aria-hidden />
            {c.privateNote}
          </p>
          <MotionDetails className="resource-privacy-details">
            <summary>{c.privacy}</summary>
            <p className="form-hint">
              {t(
                '这些标注仅属于你的账号，不会修改团队素材信息或自动发给 AI；只有你明确选择引用时才带入共创。原项目权限撤销后，长期标注也不会恢复素材访问权。',
              )}
            </p>
          </MotionDetails>
          <InlineError message={error} />
          <div className="dialog-actions">
            {item.memory && (
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => void remove()}
              >
                <Trash size={16} />
                {t('删除个人标注')}
              </button>
            )}
            <button className="button button-primary" disabled={busy}>
              {busy ? <Busy label={t('保存中')} /> : t('保存个人说明')}
            </button>
          </div>
        </form>
      </Modal>
      {confirmation.dialog}
    </>
  );
}

