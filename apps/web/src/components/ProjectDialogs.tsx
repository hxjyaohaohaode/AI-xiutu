import { secureUuid } from '../lib/uuid';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Copy,
  DownloadSimple,
  LinkSimple,
  Plus,
  ShieldCheck,
  Trash,
  UsersThree,
  Check,
  ArrowRight,
} from '@phosphor-icons/react';
import { api, downloadBlob, errorMessage, filenameBase, formatDate, jsonRequest } from '../lib/api';
import type { Project, Space } from '../lib/types';
import type { EditorState } from '../editor/useEditor';
import { createSourceLoadGuard, type SourceLoadCheckpoint } from '../editor/source-flow';
import { Busy, IconButton, InlineError, Modal } from './Ui';
import { TeamActivity } from '../resources/TeamActivity';

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
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titles = {
    project: '为新的灵感，建一个项目',
    team: '创建共同创作的空间',
    join: '加入一个团队',
  };
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(value.trim());
      onClose();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={titles[kind]}
      subtitle={
        kind === 'join'
          ? '填写队友发给你的团队邀请码。'
          : kind === 'team'
            ? '照片、讨论和项目，将在这个空间里共同整理。'
            : '一个项目，可以保存多张作品和每次编辑的版本。'
      }
      onClose={onClose}
    >
      <form className="stack-form" onSubmit={submit}>
        <label>
          {kind === 'join' ? '团队邀请码' : kind === 'team' ? '团队名称' : '项目名称'}
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={
              kind === 'join'
                ? '粘贴邀请码'
                : kind === 'team'
                  ? '例如：周末影像小组'
                  : '例如：一场春日散步'
            }
            maxLength={kind === 'join' ? 100 : 100}
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
              {kind === 'join' ? '加入团队' : '创建'}
              <ArrowRight size={17} />
            </>
          )}
        </button>
      </form>
    </Modal>
  );
}

type PreparedImageExport = { url: string; name: string; bytes: number };
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
  return { url: createUrl(blob), name, bytes: blob.size };
}

export function ExportDialog({
  editor,
  sourcePending,
  onClose,
  onSuccess,
}: {
  editor: EditorState;
  sourcePending: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const [format, setFormat] = useState<'png' | 'jpeg' | 'webp'>('png');
  const [quality, setQuality] = useState(0.94);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedImageExport | null>(null);
  const preparedRef = useRef<PreparedImageExport | null>(null);
  const preparedOwner = useRef<{ isCurrent: () => boolean } | null>(null);
  const live = useRef(true);
  const generation = useRef(0);
  const locked = useRef(false);
  const current = useRef({ editor, sourcePending, format, quality });
  current.current = { editor, sourcePending, format, quality };
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
      releasePrepared();
    };
  }, []);
  useEffect(() => {
    releasePrepared();
    setPrepared(null);
  }, [format, quality, editor.file, editor.recipe]);
  async function save() {
    if (locked.current || sourcePending || editor.loading || !editor.file) return;
    locked.current = true;
    const request = ++generation.current;
    const read = () => ({
      context: generation.current,
      source: current.current.editor.getSourceIdentity(),
      recipe: current.current.editor.getRecipe(),
      live: live.current,
      sourcePending: current.current.sourcePending || current.current.editor.loading,
    });
    const guard = createSourceLoadGuard(read);
    const name = `${filenameBase(editor.file.name)}-编辑.${format === 'jpeg' ? 'jpg' : format}`;
    releasePrepared();
    setPrepared(null);
    setBusy(true);
    setError(null);
    try {
      const result = await prepareBoundImageExport(
        read,
        () => editor.exportImage(format, quality),
        name,
      );
      if (!live.current || request !== generation.current) {
        if (result) URL.revokeObjectURL(result.url);
        return;
      }
      if (!result || !guard.isCurrent() || read().sourcePending) {
        if (result) URL.revokeObjectURL(result.url);
        setError('图片或调整在导出期间发生了变化，旧结果已丢弃。请为当前画面重新生成文件。');
        return;
      }
      preparedRef.current = result;
      preparedOwner.current = {
        isCurrent: () =>
          guard.isCurrent() &&
          current.current.format === format &&
          current.current.quality === quality,
      };
      setPrepared(result);
    } catch (e) {
      if (live.current && request === generation.current) setError(errorMessage(e));
    } finally {
      if (request === generation.current) {
        locked.current = false;
        if (live.current) setBusy(false);
      }
    }
  }
  const ready =
    prepared && preparedOwner.current?.isCurrent() && !sourcePending && !editor.loading
      ? prepared
      : null;
  return (
    <Modal
      title="把这张画面，带走"
      subtitle="从原始照片重新计算，保留当前的每一项调整。"
      onClose={onClose}
      canClose={() => !locked.current}
    >
      <div className="export-options">
        <button
          disabled={busy}
          className={format === 'png' ? 'selected' : ''}
          onClick={() => setFormat('png')}
        >
          <strong>PNG</strong>
          <span>无损图片 · 保留透明</span>
          {format === 'png' && <Check size={19} />}
        </button>
        <button
          disabled={busy}
          className={format === 'jpeg' ? 'selected' : ''}
          onClick={() => setFormat('jpeg')}
        >
          <strong>JPEG</strong>
          <span>轻巧分享 · 白色底图</span>
          {format === 'jpeg' && <Check size={19} />}
        </button>
        <button
          disabled={busy}
          className={format === 'webp' ? 'selected' : ''}
          onClick={() => setFormat('webp')}
        >
          <strong>WebP</strong>
          <span>较小体积 · 浏览器支持时</span>
          {format === 'webp' && <Check size={19} />}
        </button>
      </div>
      {format !== 'png' && (
        <label className="quality-control">
          图片质量 <strong>{Math.round(quality * 100)}%</strong>
          <input
            type="range"
            min="0.5"
            max="1"
            step="0.01"
            value={quality}
            disabled={busy}
            onChange={(e) => setQuality(Number(e.target.value))}
          />
          <small>
            {format === 'jpeg'
              ? 'JPEG 有损压缩会改变像素；透明区域填为白色。'
              : 'WebP 按所选质量编码；只有实际编码MIME一致时才提供下载。'}
          </small>
        </label>
      )}
      <div className="export-summary">
        <span>文件名</span>
        <strong>
          {filenameBase(editor.file?.name ?? '作品')}-编辑.{format === 'jpeg' ? 'jpg' : format}
        </strong>
        <span>照片处理</span>
        <strong>当前调色、构图和局部调整</strong>
      </div>
      <InlineError message={error} />
      {ready && (
        <div className="stack-form" role="status">
          <p>
            文件已生成 · {(ready.bytes / 1024 / 1024).toFixed(2)}{' '}
            MB。点击下载，未收到文件时可以再次点击，无需重新计算。
          </p>
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
                setError('当前画面已变化，请重新生成导出文件。');
                return;
              }
              onSuccess('已请求浏览器下载，请检查下载记录；工作台无法确认文件已写入相册。');
            }}
          >
            <DownloadSimple size={18} />
            下载图片
          </a>
        </div>
      )}
      <button
        className={`button ${ready ? 'button-quiet' : 'button-primary'} button-full`}
        disabled={busy || sourcePending || editor.loading || !editor.file}
        onClick={save}
      >
        {busy ? (
          <Busy label="正在计算与导出" />
        ) : (
          <>
            <DownloadSimple size={18} />
            {ready ? '重新生成文件' : '生成导出文件'}
          </>
        )}
      </button>
      <p className="fine-print">照片仍留在你的设备上。浏览器下载完成，不等于已写入系统相册。</p>
    </Modal>
  );
}

type Member = { userId: string; displayName: string; phoneMasked: string; role: string };
type SharingPolicy = {
  allowReference: boolean;
  allowCopy: boolean;
  maxActiveGrants: number;
  maxCopyAssets: number;
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
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [policy, setPolicy] = useState<SharingPolicy | null>(null);
  const [tab, setTab] = useState<'members' | 'sharing' | 'activity'>('members');
  const [activityRefresh, setActivityRefresh] = useState(0);
  const canManage = space.role === 'owner' || space.role === 'admin';
  const load = async () => {
    const result = await api<{ members: Member[] }>(`/spaces/${space.id}/members`);
    setMembers(result.members);
  };
  useEffect(() => {
    load().catch((e) => setError(errorMessage(e)));
    api<{ policy: SharingPolicy }>(`/spaces/${space.id}/sharing-policy`)
      .then((v) => setPolicy(v.policy))
      .catch((e) => setError(errorMessage(e)));
  }, [space.id]);
  async function invite() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ invitation: { code: string } }>(
        `/spaces/${space.id}/invitations`,
        jsonRequest('POST', { role, maxUses: 1, expiresInDays: 7 }),
      );
      setCode(result.invitation.code);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function changeMember(member: Member, next: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
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
      setBusy(false);
    }
  }
  async function remove(member: Member) {
    if (busy) return;
    if (!window.confirm(`确定移除 ${member.displayName}？后续将无法访问团队资料。`)) return;
    setError(null);
    setBusy(true);
    try {
      await api(`/spaces/${space.id}/members/${member.userId}`, jsonRequest('DELETE'));
      await load();
      setActivityRefresh((n) => n + 1);
      onMembershipChanged?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function transfer(member: Member) {
    if (busy || space.role !== 'owner') return;
    const owner = members.find((m) => m.role === 'owner');
    if (
      !owner ||
      !window.confirm(
        `将团队所有权交给 ${member.displayName}？你将变为管理员；团队作品和素材继续保留。`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await api(
        `/spaces/${space.id}/transfer-owner`,
        jsonRequest('POST', { targetUserId: member.userId, expectedOwnerId: owner.userId }),
      );
      onMembershipChanged?.();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function savePolicy() {
    if (!policy) return;
    setBusy(true);
    try {
      await api(`/spaces/${space.id}/sharing-policy`, jsonRequest('PUT', policy));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={space.name} subtitle="共同创作，也清楚知道谁能访问。" onClose={onClose} wide>
      <div className="segmented">
        <button className={tab === 'members' ? 'selected' : ''} onClick={() => setTab('members')}>
          <UsersThree size={17} />
          团队成员
        </button>
        <button className={tab === 'sharing' ? 'selected' : ''} onClick={() => setTab('sharing')}>
          <ShieldCheck size={17} />
          共享规则
        </button>
        <button className={tab === 'activity' ? 'selected' : ''} onClick={() => setTab('activity')}>
          成员动态
        </button>
      </div>
      <InlineError message={error} />
      {tab === 'members' ? (
        <>
          <div className="member-list">
            {members.map((member) => (
              <div className="member-row" key={member.userId}>
                <div className="comment-avatar">{member.displayName.slice(0, 1)}</div>
                <div>
                  <strong>{member.displayName}</strong>
                  <small>{member.phoneMasked}</small>
                </div>
                {canManage && member.role !== 'owner' ? (
                  <>
                    <select
                      aria-label={`${member.displayName} 的角色`}
                      value={member.role}
                      disabled={busy}
                      onChange={(e) => changeMember(member, e.target.value)}
                    >
                      <option value="editor">编辑成员</option>
                      <option value="reviewer">审阅者</option>
                      <option value="viewer">浏览成员</option>
                      {space.role === 'owner' && <option value="admin">管理员</option>}
                    </select>
                    {space.role === 'owner' && (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => void transfer(member)}
                      >
                        移交所有权
                      </button>
                    )}
                    <IconButton
                      label={`移除${member.displayName}`}
                      disabled={busy}
                      onClick={() => remove(member)}
                    >
                      <Trash size={17} />
                    </IconButton>
                  </>
                ) : (
                  <span className="soft-tag">
                    {member.role === 'owner'
                      ? '所有者'
                      : member.role === 'admin'
                        ? '管理员'
                        : member.role === 'editor'
                          ? '编辑成员'
                          : member.role === 'reviewer'
                            ? '审阅者'
                            : '浏览成员'}
                  </span>
                )}
              </div>
            ))}
          </div>
          {canManage && space.kind === 'team' && (
            <div className="invite-block">
              <h3>邀请一位队友</h3>
              <div className="invite-actions">
                <select
                  aria-label="被邀请者角色"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                >
                  <option value="editor">可以编辑作品</option>
                  <option value="reviewer">可以审阅</option>
                  <option value="viewer">仅浏览</option>
                  {space.role === 'owner' && <option value="admin">团队管理员</option>}
                </select>
                <button className="button button-secondary" disabled={busy} onClick={invite}>
                  <Plus size={16} />
                  生成邀请码
                </button>
              </div>
              {code && (
                <div className="generated-code">
                  <code>{code}</code>
                  <IconButton
                    label="复制团队邀请码"
                    onClick={() =>
                      navigator.clipboard
                        ? navigator.clipboard
                            .writeText(code)
                            .catch(() => setError('无法自动复制，请手动选中邀请码。'))
                        : setError('当前环境不能自动复制，请手动选择邀请码。')
                    }
                  >
                    <Copy size={18} />
                  </IconButton>
                </div>
              )}
              <p className="fine-print">
                邀请码有效 7 天，可使用一次。请只发送给你希望邀请的成员。
              </p>
            </div>
          )}
        </>
      ) : tab === 'activity' ? (
        <TeamActivity spaceId={space.id} refreshToken={activityRefresh} />
      ) : policy ? (
        <div className="stack-form">
          <label className="switch-row">
            <span>允许项目参考共享</span>
            <input
              type="checkbox"
              disabled={!canManage}
              checked={policy.allowReference}
              onChange={(e) => setPolicy({ ...policy, allowReference: e.target.checked })}
            />
          </label>
          <label className="switch-row">
            <span>允许接收者复制项目</span>
            <input
              type="checkbox"
              disabled={!canManage}
              checked={policy.allowCopy}
              onChange={(e) => setPolicy({ ...policy, allowCopy: e.target.checked })}
            />
          </label>
          <p className="form-hint">
            参考共享可以撤销后续访问。接收者已经明确复制的独立副本，无法远程收回。
          </p>
          <div className="field-grid">
            <label>
              有效授权上限
              <input
                type="number"
                min="0"
                max="100"
                disabled={!canManage}
                value={policy.maxActiveGrants}
                onChange={(e) => setPolicy({ ...policy, maxActiveGrants: Number(e.target.value) })}
              />
            </label>
            <label>
              每次复制素材上限
              <input
                type="number"
                min="0"
                max="100"
                disabled={!canManage}
                value={policy.maxCopyAssets}
                onChange={(e) => setPolicy({ ...policy, maxCopyAssets: Number(e.target.value) })}
              />
            </label>
          </div>
          {canManage && (
            <button className="button button-primary" disabled={busy} onClick={savePolicy}>
              {busy ? <Busy /> : '保存共享规则'}
            </button>
          )}
        </div>
      ) : (
        <Busy label="读取共享规则" />
      )}
    </Modal>
  );
}

type Grant = {
  id: string;
  mode: string;
  targetName?: string;
  targetPhoneMasked?: string;
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
  const [title, setTitle] = useState(`${project.title} · 副本`);
  const [key, setKey] = useState(() => secureUuid());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function copy(event: FormEvent) {
    event.preventDefault();
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
      setBusy(false);
    }
  }
  return (
    <Modal
      title="把项目复制到另一个空间"
      subtitle="副本包含允许复制的素材和作品版本，与来源项目独立保存。"
      onClose={onClose}
      canClose={() => !busy}
    >
      <form className="stack-form" onSubmit={copy}>
        <label>
          副本名称
          <input
            value={title}
            maxLength={160}
            onChange={(e) => {
              setTitle(e.target.value);
              setKey(secureUuid());
            }}
            required
          />
        </label>
        <label>
          目标空间
          <select
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              setKey(secureUuid());
            }}
          >
            {destinations.map((space) => (
              <option key={space.id} value={space.id}>
                {space.name}
                {space.kind === 'personal' ? '（个人）' : '（团队）'}
              </option>
            ))}
          </select>
        </label>
        <p className="form-hint">
          来源空间必须允许复制；外部共享还需要有效的复制授权。完成后撤销来源共享不会删除这个副本。
        </p>
        <InlineError message={error} />
        <button className="button button-primary" disabled={busy || !target || !title.trim()}>
          {busy ? (
            <Busy label="正在复制" />
          ) : (
            <>
              <Copy size={18} />
              确认创建独立副本
            </>
          )}
        </button>
      </form>
    </Modal>
  );
}
export function ShareDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [phone, setPhone] = useState('');
  const [mode, setMode] = useState<'reference' | 'copy'>('reference');
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const load = async () => {
    const result = await api<{ grants: Grant[] }>(`/projects/${project.id}/grants`);
    setGrants(result.grants);
  };
  useEffect(() => {
    load().catch((e) => setError(errorMessage(e)));
  }, [project.id]);
  async function share(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(
        `/projects/${project.id}/grants`,
        jsonRequest('POST', { targetPhone: phone.trim(), mode, expiresInDays: days }),
      );
      setPhone('');
      setMessage('项目已授权给接收者。请提醒对方在自己的账号中查看。');
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function revoke(grant: Grant) {
    setError(null);
    try {
      await api(`/projects/${project.id}/grants/${grant.id}`, jsonRequest('DELETE'));
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <Modal
      title="共享这个项目"
      subtitle={`${project.title} · 仅向明确的接收者授权`}
      onClose={onClose}
    >
      <form className="stack-form" onSubmit={share}>
        <label>
          接收者手机号
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="对方需要已注册账号"
            required
          />
        </label>
        <div className="field-grid">
          <label>
            共享方式
            <select value={mode} onChange={(e) => setMode(e.target.value as 'reference' | 'copy')}>
              <option value="reference">参考：浏览与评论</option>
              <option value="copy">允许复制独立项目</option>
            </select>
          </label>
          <label>
            有效天数
            <input
              type="number"
              value={days}
              min="1"
              max="30"
              onChange={(e) => setDays(Number(e.target.value))}
            />
          </label>
        </div>
        <p className="form-hint">
          {mode === 'copy'
            ? '对方可以明确复制到个人空间。已经完成的独立副本不会因撤销共享而消失。'
            : '撤销授权后，对方将无法继续访问源项目；已经下载的资料无法远程收回。'}
        </p>
        <InlineError message={error} />
        {message && (
          <p className="success-note" role="status">
            {message}
          </p>
        )}
        <button className="button button-primary" disabled={busy}>
          {busy ? (
            <Busy />
          ) : (
            <>
              <LinkSimple size={18} />
              确认共享
            </>
          )}
        </button>
      </form>
      <div className="grants-list">
        <h3>项目授权</h3>
        {grants
          .filter((g) => !g.revokedAt)
          .map((g) => (
            <div className="grant-row" key={g.id}>
              <div>
                <strong>{g.targetName ?? g.targetPhoneMasked ?? '已授权的接收者'}</strong>
                <small>
                  {g.mode === 'copy' ? '允许复制' : '参考共享'} · 至 {formatDate(g.expiresAt)}
                </small>
              </div>
              <button className="text-button" onClick={() => revoke(g)}>
                撤销
              </button>
            </div>
          ))}
        {!grants.filter((g) => !g.revokedAt).length && (
          <p className="quiet-copy">暂时没有有效的外部授权。</p>
        )}
      </div>
    </Modal>
  );
}
