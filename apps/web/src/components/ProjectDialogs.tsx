import { getOriginalPhoto } from '../editor/original-photo-source';
import { originalPhotoExportAvailable, originalPhotoExportSupported, exportOriginalPhoto } from '../editor/original-photo-export';
import { getOutputDimensions, getEditorOutputDimensions } from '@ai-xiutu/editor';
import { fitExportDimensions } from '../editor/export-size';
import { SquishSwitch } from './control-motion';
import { t } from '../i18n';
import { secureUuid } from '../lib/uuid';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Copy,
  DownloadSimple,
  LinkSimple,
  ShareNetwork,
  Plus,
  ShieldCheck,
  Trash,
  UsersThree,
  Check,
  ArrowRight,
} from '@phosphor-icons/react';
import { api, downloadBlob, errorMessage, filenameBase, formatDate, jsonRequest } from '../lib/api';
import { UploadSimple } from '@phosphor-icons/react';
import type { Project, Space } from '../lib/types';
import type { EditorState } from '../editor/useEditor';
import { createSourceLoadGuard, type SourceLoadCheckpoint } from '../editor/source-flow';
import { Busy, IconButton, InlineError, Modal } from './Ui';
import { ChoiceSelect } from './ChoiceSelect';
import { StatusMark } from './StatusMark';
import { ImagePreview } from './ImagePreview';
import { TeamInvitations } from './TeamInvitations';
import { TeamActivity } from '../resources/TeamActivity';
import { useConfirmation } from './ConfirmationDialog';
import { confirmStableScope } from '../lib/confirmation-scope';

export function NameDialog({
  kind,
  onSubmit,
  onClose,
  defaultName = '',
}: {
  kind: 'project' | 'team' | 'join';
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
  defaultName?: string;
}) {
  const [value, setValue] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  const titles = {
    project: '新建项目',
    team: '创建团队',
    join: '加入团队',
  };
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (locked.current || !value.trim()) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(value.trim());
      onClose();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t(titles[kind])}
      onClose={onClose}
      canClose={() => !locked.current}
      className="studio-dialog name-dialog"
    >
      <form className="stack-form" onSubmit={submit} aria-busy={busy}>
        <label>
          {kind === 'join' ? t('团队邀请码') : kind === 'team' ? t('团队名称') : t('项目名称')}
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={
              kind === 'join'
                ? t('粘贴邀请码')
                : kind === 'team'
                  ? t('例如：周末影像小组')
                  : t('例如：一场春日散步')
            }
            minLength={kind === 'join' ? 20 : 1}
            maxLength={kind === 'join' ? 100 : 120}
            autoComplete="off"
            disabled={busy}
            required
          />
        </label>
        <InlineError message={error} />
        <button
          type="submit"
          className="button button-primary button-full"
          disabled={busy || !value.trim()}
        >
          {busy ? (
            <Busy />
          ) : (
            <>
              {kind === 'join' ? t('加入团队') : t('创建')}
              <ArrowRight size={17} />
            </>
          )}
        </button>
      </form>
    </Modal>
  );
}

type PreparedImageExport = { url: string; name: string; bytes: number; blob: Blob };
export type ImageExportCheckpoint<Recipe> = SourceLoadCheckpoint<Recipe> & {
  live: boolean;
  sourcePending: boolean;
};

/** Encoding may finish after a different source, recipe or dialog owns the view. */
export async function prepareBoundImageExport<Recipe>(
  read: () => ImageExportCheckpoint<Recipe>,
  encode: () => Promise<Blob>,
  name: string,
  createUrl: (blob: Blob) => string = (blob) => URL.createObjectURL(blob),
): Promise<PreparedImageExport | null> {
  const guard = createSourceLoadGuard(read);
  const current = () => {
    const state = read();
    return state.live && !state.sourcePending && guard.isCurrent();
  };
  if (!current()) return null;
  let blob: Blob;
  try {
    blob = await encode();
  } catch (failure) {
    if (!current()) return null;
    throw failure;
  }
  // Do not even allocate an object URL for a result whose owner has changed.
  if (!current()) return null;
  return { url: createUrl(blob), name, bytes: blob.size, blob };
}

export function ExportDialog({
  editor,
  quickDownload,
  sourcePending,
  onClose,
  onSuccess,
  onRecipeImport,
}: {
  editor: EditorState;
  quickDownload?: () => boolean;
  sourcePending: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onRecipeImport?: () => void;
}) {
  const [format, setFormat] = useState<'png' | 'jpeg' | 'webp'>('png');
  const [quality, setQuality] = useState(0.94);
  const [size, setSize] = useState('best');
  const activeExport = useRef<AbortController | null>(null);
  const [originalProgress, setOriginalProgress] = useState<number | null>(null);
  const outputSize = useMemo(() => {
    if (!editor.dimensions || !editor.recipe) return null;
    try { return getEditorOutputDimensions(editor.dimensions, editor.recipe); }
    catch { return null; } // The worker returns the actionable geometry error on export.
  }, [editor.dimensions, editor.recipe]);
  const originalSize = useMemo(() => {
    if (format !== 'png' || !editor.originalPhotoExportable || !originalPhotoExportAvailable() || !editor.usingSourceProxy ||
        !editor.originalDimensions || !originalPhotoExportSupported(editor.recipe)) return null;
    try { return getOutputDimensions(editor.originalDimensions, editor.recipe.geometry); }
    catch { return null; }
  }, [format, editor.originalPhotoExportable, editor.usingSourceProxy, editor.originalDimensions, editor.recipe]);
  const longEdge = outputSize ? Math.max(outputSize.width, outputSize.height) : 0;
  const sizeChoices = [undefined, ...[3840, 2048, 1080].filter((edge) => edge < longEdge)]
    .map((edge) => {
      const value = edge === undefined ? 'full' : String(edge);
      const pixels = outputSize ? fitExportDimensions(outputSize, edge) : null;
      const resolution = pixels ? pixels.width + ' × ' + pixels.height : '';
      const label = edge === undefined ? t(editor.usingSourceProxy ? '编辑副本 · {size}' : '完整画面 · {size}', { size: resolution }) : resolution;
      return { value, label };
    });
  if (originalSize) sizeChoices.unshift({ value: 'original', label: t('原片编辑成品 · {size}', {
    size: originalSize.width + ' × ' + originalSize.height,
  }) });
  const selectedSize = sizeChoices.some((choice) => choice.value === size) ? size : sizeChoices[0]!.value;
  const renderOriginal = selectedSize === 'original';
  const maxLongEdge = selectedSize === 'full' || renderOriginal ? undefined : Number(selectedSize);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedImageExport | null>(null);
  const actionsDisabled = busy || sourcePending || editor.loading || !editor.file;
  const preparedRef = useRef<PreparedImageExport | null>(null);
  const preparedOwner = useRef<{ isCurrent: () => boolean } | null>(null);
  const live = useRef(true);
  const generation = useRef(0);
  const locked = useRef(false);
  const current = useRef({ editor, sourcePending, format, quality, maxLongEdge, renderOriginal });
  current.current = { editor, sourcePending, format, quality, maxLongEdge, renderOriginal };
  const exportName = `${filenameBase(editor.file?.name ?? '作品')}-编辑.${format === 'jpeg' ? 'jpg' : format}`;
  function releasePrepared() {
    const previous = preparedRef.current;
    preparedRef.current = null;
    preparedOwner.current = null;
    // A clicked download may still be reading this URL when its view closes.
    if (previous) window.setTimeout(() => URL.revokeObjectURL(previous.url), 30000);
  }
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      generation.current += 1;
      activeExport.current?.abort();
      releasePrepared();
    };
  }, []);
  useEffect(() => {
    releasePrepared();
    setPrepared(null);
    return () => activeExport.current?.abort();
  }, [format, quality, maxLongEdge, renderOriginal, editor.file, editor.recipe, sourcePending]);
  const offersFileShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function' &&
    navigator.canShare?.({ files: [new File([], exportName, { type: 'image/' + format })] });
  async function sharePrepared(result: PreparedImageExport) {
    if (!preparedOwner.current?.isCurrent() || current.current.sourcePending || current.current.editor.isLoading()) return;
    const file = new File([result.blob], result.name, { type: result.blob.type });
    if (!navigator.canShare?.({ files: [file] })) {
      setError(t('当前设备无法分享此文件，可直接下载。'));
      return;
    }
    try {
      await navigator.share({ files: [file] });
    } catch (failure) {
      if (!live.current || (failure instanceof Error && failure.name === 'AbortError')) return;
      setError(t('可再次点击分享，或直接下载图片。'));
    }
  }
  async function save(intent: 'download' | 'share', requestedOwner?: () => boolean) {
    if (locked.current || sourcePending || editor.loading || !editor.file) return;
    if (intent === 'share' && preparedRef.current && preparedOwner.current?.isCurrent()) {
      locked.current = true;
      setBusy(true);
      setError(null);
      try { await sharePrepared(preparedRef.current); }
      finally { locked.current = false; if (live.current) setBusy(false); }
      return;
    }
    locked.current = true;
    const request = ++generation.current;
    const read = () => ({
      context: generation.current,
      source: current.current.editor.getSourceIdentity(),
      recipe: current.current.editor.getRecipe(),
      live: live.current && (requestedOwner?.() ?? true),
      sourcePending: current.current.sourcePending || current.current.editor.loading,
    });
    const guard = createSourceLoadGuard(read);
    releasePrepared();
    setPrepared(null);
    setBusy(true);
    setError(null);
    const controller = renderOriginal ? new AbortController() : null;
    activeExport.current = controller;
    setOriginalProgress(controller ? 0 : null);
    try {
      const result = await prepareBoundImageExport(
        read,
        async () => {
          if (!controller || !editor.originalDimensions)
            return editor.exportImage(format, quality, false, undefined, maxLongEdge);
          const file = await getOriginalPhoto(editor.localOriginalFile, editor.originalAssetId,
            editor.file?.name ?? 'photo', controller.signal, editor.originalPhotoSha256);
          controller.signal.throwIfAborted();
          return exportOriginalPhoto(file, editor.recipe, editor.originalDimensions, controller.signal, (fraction) => {
            if (live.current && activeExport.current === controller && !controller.signal.aborted)
              setOriginalProgress(Math.round(fraction * 100));
          });
        },
        exportName,
      );
      if (!live.current || request !== generation.current || controller?.signal.aborted) {
        if (result) URL.revokeObjectURL(result.url);
        return;
      }
      if (!result || !guard.isCurrent() || !read().live || read().sourcePending) {
        if (result) URL.revokeObjectURL(result.url);
        setError('图片或调整在导出期间发生了变化，旧结果已丢弃。请为当前画面重新生成文件。');
        return;
      }
      preparedRef.current = result;
      preparedOwner.current = {
        isCurrent: () =>
          guard.isCurrent() &&
          current.current.format === format &&
          current.current.quality === quality && current.current.maxLongEdge === maxLongEdge &&
          current.current.renderOriginal === renderOriginal,
      };
      setPrepared(result);
      if (intent === 'share') {
        // Some devices require a fresh gesture when image encoding outlasts activation.
        if (navigator.userActivation?.isActive === false) onSuccess(t('文件已就绪，点击分享图片。'));
        else await sharePrepared(result);
        return;
      }
      // The explicit download action starts delivery after encoding. The same
      // prepared file remains available if the browser requires another gesture.
      const link = document.createElement('a');
      link.href = result.url;
      link.download = result.name;
      link.click();
      onSuccess(t('下载已发起，可在浏览器下载记录中查看。'));
    } catch (e) {
      if (live.current && request === generation.current && !controller?.signal.aborted) setError(errorMessage(e));
    } finally {
      if (activeExport.current === controller) activeExport.current = null;
      if (request === generation.current) {
        locked.current = false;
        if (live.current) setBusy(false);
      }
    }
  }
  const startQuickDownload = useRef<() => void>(() => {});
  startQuickDownload.current = () => {
    if (quickDownload && renderOriginal && quickDownload()) void save('download', quickDownload);
  };
  useEffect(() => {
    if (!quickDownload) return;
    // StrictMode may remount effects before the first paint. Only the surviving
    // dialog can dispatch, and a later recipe change cannot restart a cancelled export.
    let currentMount = true;
    queueMicrotask(() => { if (currentMount) startQuickDownload.current(); });
    return () => { currentMount = false; };
  }, [quickDownload]);
  const ready =
    prepared && preparedOwner.current?.isCurrent() && !sourcePending && !editor.loading
      ? prepared
      : null;
  return (
    <Modal
      title={t('导出图片')}
      onClose={onClose}
      canClose={() => !locked.current}
      className="studio-dialog export-dialog"
    >
      <div className="export-preview">
        <ImagePreview image={editor.rendered} label={t('当前编辑的预览图')} />
      </div>
      <div className="export-options" role="group" aria-label={t('导出图片格式')}>
        <button
          type="button"
          disabled={busy}
          aria-pressed={format === 'png'}
          className={format === 'png' ? 'selected' : ''}
          onClick={() => setFormat('png')}
        >
          <strong>PNG</strong>
          <span>{t('无损 · 透明')}</span>
          {format === 'png' && <Check size={19} />}
        </button>
        <button
          type="button"
          disabled={busy}
          aria-pressed={format === 'jpeg'}
          className={format === 'jpeg' ? 'selected' : ''}
          onClick={() => setFormat('jpeg')}
        >
          <strong>JPEG</strong>
          <span>{t('有损 · 白底')}</span>
          {format === 'jpeg' && <Check size={19} />}
        </button>
        <button
          type="button"
          disabled={busy}
          aria-pressed={format === 'webp'}
          className={format === 'webp' ? 'selected' : ''}
          onClick={() => setFormat('webp')}
        >
          <strong>WebP</strong>
          <span>{t('压缩 · 透明')}</span>
          {format === 'webp' && <Check size={19} />}
        </button>
      </div>
      {editor.usingSourceProxy && !renderOriginal && editor.originalDimensions && (
        <div className="export-summary">
          <span>{t('原件 {width} × {height} · 当前导出使用编辑副本', editor.originalDimensions)}</span>
        </div>
      )}
      {outputSize && (sizeChoices.length > 1 ? (
        <ChoiceSelect size="compact" label={t('输出尺寸')} value={selectedSize}
          options={sizeChoices} disabled={busy} onValueChange={setSize} />
      ) : (
        <div className="export-summary"><span>{t('输出尺寸')}</span>
          <strong>{outputSize.width} × {outputSize.height}</strong></div>
      ))}
      {format !== 'png' && (
        <label className="quality-control">
          {t('图片质量')}
          <strong>{Math.round(quality * 100)}%</strong>
          <input
            type="range"
            aria-label={t('导出图片质量')}
            aria-valuetext={`${Math.round(quality * 100)}%`}
            min="0.5"
            max="1"
            step="0.01"
            value={quality}
            disabled={busy}
            onChange={(e) => setQuality(Number(e.target.value))}
          />
        </label>
      )}
      <div className="export-summary">
        <span>{t('文件名')}</span>
        <strong>{ready?.name ?? exportName}</strong>
      </div>
      <InlineError message={error} />
      {ready && (
        <div className="stack-form" role="status">
          <StatusMark
            state="done"
            label={
              <>
                {t('文件已生成 ·')} {(ready.bytes / 1024 / 1024).toFixed(2)} MB
              </>
            }
          />
          <a
            className="button button-primary button-full"
            href={ready.url}
            download={ready.name}
            onClick={(event) => {
              if (
                !preparedOwner.current?.isCurrent() ||
                current.current.sourcePending ||
                current.current.editor.loading
              ) {
                event.preventDefault();
                releasePrepared();
                setPrepared(null);
                setError(t('当前画面已变化，请重新生成导出文件。'));
                return;
              }
              onSuccess(t('下载已发起，可在浏览器下载记录中查看。'));
            }}
          >
            <DownloadSimple size={18} />
            {t('再次下载')}
          </a>
        </div>
      )}
      <button
        className={`button ${ready ? 'button-quiet' : 'button-primary'} button-full`}
        disabled={actionsDisabled}
        onClick={() => void save('download')}
      >
        {busy ? (
          <Busy label={originalProgress === null ? t('正在计算与导出')
            : t('正在导出原片 · {value}%', { value: originalProgress })} />
        ) : (
          <>
            <DownloadSimple size={18} />
            {ready ? t('重新生成文件') : t('下载 {format}', { format: format.toUpperCase() })}
          </>
        )}
      </button>
      {busy && activeExport.current && <button type="button" className="text-button"
        onClick={() => activeExport.current?.abort()}>{t('取消导出')}</button>}
      <div className="export-recipe-actions">
        {editor.localOriginalFile && editor.usingSourceProxy ? (
          <button type="button" className="text-button" disabled={actionsDisabled} onClick={() => {
            if (editor.localOriginalFile) downloadBlob(editor.localOriginalFile, editor.localOriginalFile.name);
          }}><DownloadSimple size={16} />{t('下载原件')}</button>
        ) : editor.originalAssetId && !actionsDisabled ? (
          <a className="text-button" download href={'/v1/assets/' + encodeURIComponent(editor.originalAssetId) + '/media/original'}>
            <DownloadSimple size={16} />{t('下载原件')}
          </a>
        ) : null}
        {offersFileShare && <button type="button" className="text-button" disabled={actionsDisabled}
          onClick={() => void save('share')}>
          <ShareNetwork size={16} />{t('分享图片')}
        </button>}
        <button type="button" className="text-button" disabled={actionsDisabled} onClick={editor.exportRecipe}>
          <DownloadSimple size={16} />{t('保存编辑配方')}
        </button>
        {onRecipeImport && <button type="button" className="text-button" disabled={actionsDisabled} onClick={onRecipeImport}>
          <UploadSimple size={16} />{t('导入已有配方')}
        </button>}
      </div>
    </Modal>
  );
}

type Member = { userId: string; displayName: string; phoneMasked: string; role: string };
type SharingPolicy = {
  allowReference: boolean;
  allowCopy: boolean;
  maxActiveGrants: number;
  maxCopyAssets: number;
  allowDocumentLinks?: boolean;
};
export function TeamDialog({
  space,
  onClose,
  onMembershipChanged,
}: {
  space: Space;
  onClose: () => void;
  onMembershipChanged?: () => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [role, setRole] = useState('editor');
  const [issued, setIssued] = useState<{ id: string; code: string } | null>(null);
  const [inviteRefresh, setInviteRefresh] = useState(0);
  const code = issued?.code;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [policy, setPolicy] = useState<SharingPolicy | null>(null);
  const [policyLoading, setPolicyLoading] = useState(true);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const policyRequest = useRef(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const locked = useRef(false);
  const [tab, setTab] = useState<'members' | 'sharing' | 'activity'>('members');
  const [activityRefresh, setActivityRefresh] = useState(0);
  const canManage = space.role === 'owner' || space.role === 'admin';
  const confirmation = useConfirmation();
  const mounted = useRef(false);
  const identity = `${space.id}:${space.kind}:${space.role}`;
  const scope = useRef({ identity, generation: 0 });
  if (scope.current.identity !== identity)
    scope.current = { identity, generation: scope.current.generation + 1 };
  const latest = useRef({ space, members, busy, onClose, onMembershipChanged });
  latest.current = { space, members, busy, onClose, onMembershipChanged };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      scope.current.generation++;
    };
  }, []);
  useEffect(() => {
    confirmation.cancel();
  }, [identity, confirmation.cancel]);
  const readMember = (userId: string) => ({
    mounted: mounted.current,
    scope: scope.current.generation,
    spaceId: latest.current.space.id,
    kind: latest.current.space.kind,
    role: latest.current.space.role,
    member: latest.current.members.find((entry) => entry.userId === userId),
    owner: latest.current.members.find((entry) => entry.role === 'owner'),
    busy: latest.current.busy,
    locked: locked.current,
  });
  const load = async () => {
    const generation = scope.current.generation;
    const result = await api<{ members: Member[] }>(`/spaces/${space.id}/members`);
    if (mounted.current && generation === scope.current.generation) setMembers(result.members);
  };
  const loadPolicy = async () => {
    const generation = scope.current.generation;
    const request = ++policyRequest.current;
    const isCurrent = () =>
      mounted.current &&
      generation === scope.current.generation &&
      request === policyRequest.current;
    setPolicyLoading(true);
    setPolicyError(null);
    try {
      const result = await api<{ policy: SharingPolicy }>(`/spaces/${space.id}/sharing-policy`);
      if (isCurrent()) setPolicy(result.policy);
    } catch (failure) {
      if (isCurrent()) setPolicyError(errorMessage(failure));
    } finally {
      if (isCurrent()) setPolicyLoading(false);
    }
  };
  useEffect(() => {
    const generation = scope.current.generation;
    let active = true;
    const isCurrent = () => active && mounted.current && generation === scope.current.generation;
    setLoading(true);
    setMembers([]);
    setPolicy(null);
    setIssued(null);
    setRole('editor');
    locked.current = false;
    setBusy(false);
    setMessage('');
    setError(null);
    load()
      .catch((e) => {
        if (isCurrent()) setError(errorMessage(e));
      })
      .finally(() => {
        if (isCurrent()) setLoading(false);
      });
    void loadPolicy();
    return () => {
      active = false;
    };
  }, [identity]);
  async function invite() {
    if (locked.current || !canManage || space.kind !== 'team') return;
    const generation = scope.current.generation;
    const current = () => mounted.current && generation === scope.current.generation;
    locked.current = true;
    setBusy(true);
    setError(null);
    setMessage('');
    try {
      const result = await api<{ invitation: { id: string; code: string } }>(
        `/spaces/${space.id}/invitations`,
        jsonRequest('POST', { role, maxUses: 1, expiresInDays: 7 }),
      );
      if (current()) { setIssued(result.invitation); setInviteRefresh((n) => n + 1); }
    } catch (e) {
      if (current()) setError(errorMessage(e));
    } finally {
      if (current()) { locked.current = false; setBusy(false); }
    }
  }
  async function changeMember(member: Member, next: string) {
    if (locked.current || !canManage || (space.role !== 'owner' && member.role === 'admin')) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    setMessage('');
    try {
      await api(
        `/spaces/${space.id}/members/${member.userId}`,
        jsonRequest('PATCH', { role: next }),
      );
      await load();
      setActivityRefresh((n) => n + 1);
      onMembershipChanged?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function remove(member: Member) {
    const currentSpace = latest.current.space;
    const currentMember = latest.current.members.find((entry) => entry.userId === member.userId);
    if (
      !mounted.current ||
      locked.current ||
      latest.current.busy ||
      !currentMember ||
      currentMember.role === 'owner' ||
      currentSpace.kind !== 'team' ||
      !['owner', 'admin'].includes(currentSpace.role) ||
      (currentSpace.role !== 'owner' && currentMember.role === 'admin')
    )
      return;
    const outcome = await confirmStableScope(
      () => readMember(currentMember.userId),
      () =>
        confirmation.confirm({
          description: t('确定移除 {name}？后续将无法访问团队资料。', {
            name: currentMember.displayName,
          }),
          confirmLabel: '移除成员',
          tone: 'danger',
        }),
    );
    if (outcome !== 'confirmed') {
      if (outcome === 'changed' && mounted.current)
        setError('团队、成员或权限已经变化，请重新核对后操作。');
      return;
    }
    if (!mounted.current || locked.current || latest.current.busy) return;
    const generation = scope.current.generation;
    const isCurrent = () => mounted.current && generation === scope.current.generation;
    locked.current = true;
    setError(null);
    setMessage('');
    setBusy(true);
    try {
      await api(
        `/spaces/${currentSpace.id}/members/${currentMember.userId}`,
        jsonRequest('DELETE'),
      );
      if (!isCurrent()) return;
      await load();
      if (!isCurrent()) return;
      setActivityRefresh((n) => n + 1);
      latest.current.onMembershipChanged?.();
    } catch (e) {
      if (isCurrent()) setError(errorMessage(e));
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function transfer(member: Member) {
    const currentSpace = latest.current.space;
    const currentMember = latest.current.members.find((entry) => entry.userId === member.userId);
    const owner = latest.current.members.find((entry) => entry.role === 'owner');
    if (
      !mounted.current ||
      locked.current ||
      latest.current.busy ||
      currentSpace.role !== 'owner' ||
      currentSpace.kind !== 'team' ||
      !currentMember ||
      currentMember.role === 'owner' ||
      !owner
    )
      return;
    const outcome = await confirmStableScope(
      () => readMember(currentMember.userId),
      () =>
        confirmation.confirm({
          description: t('将团队所有权交给 {name}？你将变为管理员；团队作品和素材继续保留。', {
            name: currentMember.displayName,
          }),
          confirmLabel: '移交所有权',
          tone: 'danger',
        }),
    );
    if (outcome !== 'confirmed') {
      if (outcome === 'changed' && mounted.current)
        setError('团队所有权或成员状态已经变化，请重新核对。');
      return;
    }
    if (!mounted.current || locked.current || latest.current.busy) return;
    const generation = scope.current.generation;
    const isCurrent = () => mounted.current && generation === scope.current.generation;
    locked.current = true;
    setBusy(true);
    setError(null);
    setMessage('');
    try {
      await api(
        `/spaces/${currentSpace.id}/transfer-owner`,
        jsonRequest('POST', { targetUserId: currentMember.userId, expectedOwnerId: owner.userId }),
      );
      if (!isCurrent()) return;
      latest.current.onMembershipChanged?.();
      latest.current.onClose();
    } catch (e) {
      if (isCurrent()) setError(errorMessage(e));
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function savePolicy() {
    if (locked.current || !canManage || !policy) return;
    if (
      ![policy.maxActiveGrants, policy.maxCopyAssets].every(
        (value) => Number.isInteger(value) && value >= 0 && value <= 100,
      )
    ) {
      setError('授权上限与素材上限须为 0 至 100 的整数。');
      return;
    }
    locked.current = true;
    setBusy(true);
    setError(null);
    setMessage('');
    try {
      await api(`/spaces/${space.id}/sharing-policy`, jsonRequest('PUT', policy));
      setMessage('共享规则已保存。');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Modal
        title={space.name}
        onClose={onClose}
        canClose={() => !locked.current}
        className="studio-dialog team-dialog"
        wide
      >
        <div className="segmented" role="group" aria-label={t('团队管理视图')}>
          <button
            disabled={busy}
            aria-pressed={tab === 'members'}
            className={tab === 'members' ? 'selected' : ''}
            onClick={() => setTab('members')}
          >
            <UsersThree size={17} />
            {t('团队成员')}
          </button>
          <button
            disabled={busy}
            aria-pressed={tab === 'sharing'}
            className={tab === 'sharing' ? 'selected' : ''}
            onClick={() => setTab('sharing')}
          >
            <ShieldCheck size={17} />
            {t('共享规则')}
          </button>
          <button
            disabled={busy}
            aria-pressed={tab === 'activity'}
            className={tab === 'activity' ? 'selected' : ''}
            onClick={() => setTab('activity')}
          >
            {t('成员动态')}
          </button>
        </div>
        <InlineError message={error} />
        {message && (
          <p className="success-note" role="status">
            {t(message)}
          </p>
        )}
        {!canManage && (
          <p className="form-hint">
            {t('你可以查看团队信息；成员与共享规则由所有者或管理员管理。')}
          </p>
        )}
        {tab === 'members' ? (
          <>
            {loading && <Busy label={t('正在读取团队成员')} />}
            <div className="member-list" aria-busy={loading}>
              {members.map((member) => (
                <div className="member-row" key={member.userId}>
                  <div className="comment-avatar">{member.displayName.slice(0, 1)}</div>
                  <div>
                    <strong>{member.displayName}</strong>
                    <small>{member.phoneMasked}</small>
                  </div>
                  {canManage &&
                  member.role !== 'owner' &&
                  (space.role === 'owner' || member.role !== 'admin') ? (
                    <>
                      <ChoiceSelect
                        ariaLabel={t('{v0} 的角色', { v0: member.displayName })}
                        value={member.role}
                        disabled={busy}
                        size="compact"
                        onValueChange={(value) => changeMember(member, value)}
                        options={[
                          { value: 'editor', label: t('编辑成员') },
                          { value: 'reviewer', label: t('审阅者') },
                          { value: 'viewer', label: t('浏览成员') },
                          ...(space.role === 'owner'
                            ? [{ value: 'admin', label: t('管理员') }]
                            : []),
                        ]}
                      />
                      {space.role === 'owner' && (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => void transfer(member)}
                        >
                          {t('移交所有权')}
                        </button>
                      )}
                      <IconButton
                        label={t('移除{v0}', { v0: member.displayName })}
                        disabled={busy}
                        onClick={() => remove(member)}
                      >
                        <Trash size={17} />
                      </IconButton>
                    </>
                  ) : (
                    <span className="soft-tag">
                      {member.role === 'owner'
                        ? t('所有者')
                        : member.role === 'admin'
                          ? t('管理员')
                          : member.role === 'editor'
                            ? t('编辑成员')
                            : member.role === 'reviewer'
                              ? t('审阅者')
                              : t('浏览成员')}
                    </span>
                  )}
                </div>
              ))}
            </div>
            {canManage && space.kind === 'team' && (
              <div className="invite-block">
                <h3>{t('邀请一位队友')}</h3>
                <div className="invite-actions">
                  <ChoiceSelect
                    ariaLabel={t('被邀请者角色')}
                    value={role}
                    disabled={busy}
                    onValueChange={setRole}
                    options={[
                      { value: 'editor', label: t('可以编辑作品') },
                      { value: 'reviewer', label: t('可以审阅') },
                      { value: 'viewer', label: t('仅浏览') },
                      ...(space.role === 'owner'
                        ? [{ value: 'admin', label: t('团队管理员') }]
                        : []),
                    ]}
                  />
                  <button className="button button-secondary" disabled={busy} onClick={invite}>
                    {busy ? (
                      <Busy label={t('正在处理')} />
                    ) : (
                      <>
                        <Plus size={16} />
                        {t('生成邀请码')}
                      </>
                    )}
                  </button>
                </div>
                {code && (
                  <div className="generated-code">
                    <code>{code}</code>
                    <IconButton
                      label={t('复制团队邀请码')}
                      onClick={() =>
                        navigator.clipboard
                          ? navigator.clipboard
                              .writeText(code)
                              .catch(() => setError(t('无法自动复制，请手动选中邀请码。')))
                          : setError(t('当前环境不能自动复制，请手动选择邀请码。'))
                      }
                    >
                      <Copy size={18} />
                    </IconButton>
                  </div>
                )}
                <TeamInvitations key={identity} spaceId={space.id} refresh={inviteRefresh}
                  onRevoke={(id) => {
                    setIssued((prior) => prior?.id === id ? null : prior);
                    setMessage(t('已撤销团队邀请'));
                  }} />
              </div>
            )}
          </>
        ) : tab === 'activity' ? (
          <TeamActivity spaceId={space.id} refreshToken={activityRefresh} />
        ) : policy ? (
          <div className="stack-form">
            <SquishSwitch className="setting-switch" label={t('允许项目参考共享')}
disabled={!canManage || busy}
                checked={policy.allowReference}
                onCheckedChange={(checked) => setPolicy({ ...policy, allowReference: checked })}
              />
            <SquishSwitch className="setting-switch" label={t('允许接收者复制项目')}
disabled={!canManage || busy}
                checked={policy.allowCopy}
                onCheckedChange={(checked) => setPolicy({ ...policy, allowCopy: checked })}
              />
            <SquishSwitch className="setting-switch" label={t('允许文档只读链接')}
disabled={!canManage || busy}
                checked={policy.allowDocumentLinks === true}
                onCheckedChange={(checked) => setPolicy({ ...policy, allowDocumentLinks: checked })}
              />
            <p className="form-hint">
              {t('参考共享可以撤销后续访问。接收者已经明确复制的独立副本，无法远程收回。')}
            </p>
            <div className="field-grid">
              <label>
                {t('有效授权上限')}
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  disabled={!canManage || busy}
                  value={policy.maxActiveGrants}
                  onChange={(e) =>
                    setPolicy({ ...policy, maxActiveGrants: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                {t('每次复制素材上限')}
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  disabled={!canManage || busy}
                  value={policy.maxCopyAssets}
                  onChange={(e) => setPolicy({ ...policy, maxCopyAssets: Number(e.target.value) })}
                />
              </label>
            </div>
            {canManage && (
              <button className="button button-primary" disabled={busy} onClick={savePolicy}>
                {busy ? <Busy /> : t('保存共享规则')}
              </button>
            )}
          </div>
        ) : policyLoading ? (
          <Busy label={t('读取共享规则')} />
        ) : (
          <div className="stack-form">
            <InlineError message={policyError} />
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={() => void loadPolicy()}
            >
              {t('重新读取')}
            </button>
          </div>
        )}
      </Modal>
      {confirmation.dialog}
    </>
  );
}

type Grant = {
  id: string;
  mode: string;
  targetName?: string;
  phoneMasked?: string;
  expiresAt: string;
  revokedAt?: string | null;
};
export function CopyProjectDialog({
  project,
  spaces,
  onClose,
  onCopied,
}: {
  project: Project;
  spaces: Space[];
  onClose: () => void;
  onCopied: (project: Project) => void;
}) {
  const destinations = spaces.filter((space) => ['owner', 'admin', 'editor'].includes(space.role));
  const [target, setTarget] = useState(
    destinations.find((space) => space.kind === 'personal')?.id ?? destinations[0]?.id ?? '',
  );
  const [title, setTitle] = useState(
    `${project.title
      .slice(0, 115)
      .replace(/[\uD800-\uDBFF]$/, '')
      .trimEnd()} · 副本`,
  );
  const [key, setKey] = useState(() => secureUuid());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  async function copy(event: FormEvent) {
    event.preventDefault();
    if (locked.current || !target || !title.trim()) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ project: Project }>(
        `/projects/${project.id}/copy`,
        jsonRequest('POST', { targetSpaceId: target, title: title.trim(), idempotencyKey: key }),
      );
      onCopied(result.project);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t('把项目复制到另一个空间')}
      subtitle={project.title}
      onClose={onClose}
      canClose={() => !locked.current}
      className="studio-dialog copy-dialog"
    >
      <form className="stack-form" onSubmit={copy} aria-busy={busy}>
        <label>
          {t('副本名称')}
          <input
            value={title}
            maxLength={120}
            disabled={busy}
            onChange={(e) => {
              setTitle(e.target.value);
              setKey(secureUuid());
            }}
            required
          />
        </label>
        <label>
          {t('目标空间')}
          <ChoiceSelect
            ariaLabel={t('目标空间')}
            value={target}
            disabled={busy || !destinations.length}
            placeholder={t('没有可写入的目标空间')}
            onValueChange={(value) => {
              setTarget(value);
              setKey(secureUuid());
            }}
            options={destinations.map((space) => ({
              value: space.id,
              label: space.name,
              description: space.kind === 'personal' ? t('个人空间') : t('团队空间'),
            }))}
          />
        </label>
        {!destinations.length && (
          <p className="form-hint" role="status">
            {t('当前没有可保存副本的空间。请切换到有编辑权限的个人或团队空间。')}
          </p>
        )}
        <p className="form-hint">
          {t(
            '来源空间必须允许复制；外部共享还需要有效的复制授权。完成后撤销来源共享不会删除这个副本。',
          )}
        </p>
        <InlineError message={error} />
        <button className="button button-primary" disabled={busy || !target || !title.trim()}>
          {busy ? (
            <Busy label={t('正在复制')} />
          ) : (
            <>
              <Copy size={18} />
              {t('确认创建独立副本')}
            </>
          )}
        </button>
      </form>
    </Modal>
  );
}
export function ShareDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [grantsLoading, setGrantsLoading] = useState(true);
  const [grantsReady, setGrantsReady] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [mode, setMode] = useState<'reference' | 'copy'>('reference');
  const [days, setDays] = useState(7);
  const [policy, setPolicy] = useState<SharingPolicy | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const locked = useRef(false);
  const mounted = useRef(true);
  const readRequest = useRef(0);
  const readController = useRef<AbortController | null>(null);
  const currentProject = useRef(project.id);
  currentProject.current = project.id;
  const canManage = project.role === 'owner' || project.role === 'admin';
  const modeAllowed = mode === 'reference' ? policy?.allowReference : policy?.allowCopy;
  const load = async () => {
    if (!mounted.current || currentProject.current !== project.id) return;
    const request = ++readRequest.current;
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    const isCurrent = () =>
      mounted.current &&
      currentProject.current === project.id &&
      request === readRequest.current &&
      !controller.signal.aborted;
    setGrantsLoading(true);
    setReadError(null);
    try {
      const result = await api<{ grants: Grant[]; policy: SharingPolicy }>(`/projects/${project.id}/grants`, {
        signal: controller.signal,
      });
      if (isCurrent()) {
        setGrants(result.grants);
        setPolicy(result.policy);
        setMode((old) => old === 'copy' && result.policy.allowCopy || !result.policy.allowReference ? 'copy' : 'reference');
        setGrantsReady(true);
      }
    } catch (failure) {
      if (isCurrent()) setReadError(errorMessage(failure));
    } finally {
      if (isCurrent()) setGrantsLoading(false);
      if (readController.current === controller) readController.current = null;
    }
  };
  useEffect(() => {
    mounted.current = true;
    setGrants([]);
    setPhone('');
    setMode('reference');
    setDays(7);
    setPolicy(null);
    setGrantsReady(false);
    setMessage('');
    setError(null);
    if (canManage) void load();
    else setGrantsLoading(false);
    return () => {
      mounted.current = false;
      readRequest.current++;
      readController.current?.abort();
    };
  }, [project.id, canManage]);
  async function share(event: FormEvent) {
    event.preventDefault();
    if (locked.current || !canManage || !modeAllowed || !phone.trim()) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    setMessage('');
    try {
      await api(
        `/projects/${project.id}/grants`,
        jsonRequest('POST', { targetPhone: phone.trim(), mode, expiresInDays: days }),
      );
      if (!mounted.current || currentProject.current !== project.id) return;
      setPhone('');
      setMessage('项目已授权给接收者。请提醒对方在自己的账号中查看。');
      await load();
    } catch (e) {
      if (mounted.current && currentProject.current === project.id) setError(errorMessage(e));
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function revoke(grant: Grant) {
    if (locked.current || !canManage) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    setMessage('');
    try {
      await api(`/projects/${project.id}/grants/${grant.id}`, jsonRequest('DELETE'));
      if (!mounted.current || currentProject.current !== project.id) return;
      setMessage('已撤销该授权，后续访问将重新检查权限。');
      await load();
    } catch (e) {
      if (mounted.current && currentProject.current === project.id) setError(errorMessage(e));
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <Modal
      title={t('共享这个项目')}
      subtitle={project.title}
      onClose={onClose}
      canClose={() => !locked.current}
      className="studio-dialog share-dialog"
    >
      {!canManage && (
        <p className="form-hint">{t('只有项目所属空间的所有者或管理员可以管理外部授权。')}</p>
      )}
      {canManage && <form className="stack-form" onSubmit={share} aria-busy={busy}>
        <label>
          {t('接收者手机号')}
          <input
            type="tel"
            inputMode="tel"
            minLength={8}
            maxLength={24}
            disabled={busy || !canManage}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t('对方需要已注册账号')}
            required
          />
        </label>
        {policy && !policy.allowReference && !policy.allowCopy && <p role="status">{t('空间策略尚未允许此分享方式')}</p>}
        {modeAllowed && <details key={project.id} className="share-options">
          <summary>{t(mode === 'copy' ? '允许复制' : '参考共享')} · {t('{days} 天', { days })}</summary>
          <div className="field-grid">
          <label>
            {t('共享方式')}
            <ChoiceSelect
              ariaLabel={t('共享方式')}
              disabled={busy || !canManage}
              value={mode}
              onValueChange={setMode}
              options={[
                ...(policy?.allowReference ? [{ value: 'reference' as const, label: t('参考'), description: t('允许浏览与评论') }] : []),
                ...(policy?.allowCopy ? [{ value: 'copy' as const, label: t('允许复制'), description: t('可复制为独立项目') }] : []),
              ]}
            />
          </label>
          <label>
            {t('有效天数')}
            <input
              type="number"
              value={days}
              min="1"
              max="30"
              step="1"
              required
              disabled={busy || !canManage}
              onChange={(e) => setDays(Number(e.target.value))}
            />
          </label>
        </div>
        <p className="form-hint">
          {mode === 'copy'
            ? t('对方可以明确复制到有编辑权限的空间。已经完成的独立副本不会因撤销共享而消失。')
            : t('撤销授权后，对方将无法继续访问源项目；已经下载的资料无法远程收回。')}
        </p>
        </details>}
        <InlineError message={error} />
        {message && (
          <p className="success-note" role="status">
            {t(message)}
          </p>
        )}
        <button
          type="submit"
          className="button button-primary"
          disabled={busy || !modeAllowed || !phone.trim()}
        >
          {busy ? (
            <Busy />
          ) : (
            <>
              <LinkSimple size={18} />
              {t('确认共享')}
            </>
          )}
        </button>
      </form>}
      {canManage && <div className="grants-list" aria-busy={grantsLoading}>
        <h3>{t('项目授权')}</h3>
        {grantsLoading && <Busy label={t('正在读取')} />}
        <InlineError message={readError} />
        {readError && (
          <button
            type="button"
            className="text-button"
            disabled={busy || grantsLoading}
            onClick={() => void load()}
          >
            {t('重新读取')}
          </button>
        )}
        {grants
          .filter((g) => !g.revokedAt)
          .map((g) => (
            <div className="grant-row" key={g.id}>
              <div>
                <strong>{g.targetName ?? g.phoneMasked ?? t('已授权的接收者')}</strong>
                <small>
                  {Date.parse(g.expiresAt) <= Date.now() ? t('已过期 · ') : ''}
                  {g.mode === 'copy' ? t('允许复制') : t('参考共享')} {t('· 至')}
                  {formatDate(g.expiresAt)}
                </small>
              </div>
              <button
                type="button"
                className="text-button"
                disabled={busy || !canManage}
                aria-label={t('撤销对{v0}的{v1}授权', {
                  v0: g.targetName ?? g.phoneMasked ?? t('接收者'),
                  v1: g.mode === 'copy' ? t('复制') : t('参考'),
                })}
                onClick={() => revoke(g)}
              >
                {t('撤销')}
              </button>
            </div>
          ))}
        {grantsReady &&
          !grantsLoading &&
          !readError &&
          !grants.filter((g) => !g.revokedAt).length && (
            <p className="quiet-copy">{t('暂时没有未撤销的外部授权。')}</p>
          )}
      </div>}
    </Modal>
  );
}
