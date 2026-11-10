import { usePresence } from '../motion/usePresence';
import {
  ArrowRight,
  CaretDown,
  FolderOpen,
  GearSix,
  House,
  Plus,
  SignIn,
  SignOut,
  UsersThree,
  X,
  UserCircle,
  LinkSimple,
} from '@phosphor-icons/react';
import type { Project, Session, Space } from '../lib/types';
import { Brand, IconButton } from './Ui';

export function Sidebar({
  brand,
  logoUrl,
  session,
  spaceId,
  projects,
  sharedProjects,
  selectedProject,
  open,
  onClose,
  onSpace,
  onProject,
  onNewProject,
  onNewTeam,
  onJoinTeam,
  onTeamSettings,
  onAuth,
  onLogout,
  onOps,
}: {
  brand: string;
  logoUrl?: string | null;
  session: Session;
  spaceId: string | null;
  projects: Project[];
  sharedProjects: Project[];
  selectedProject: Project | null;
  open: boolean;
  onClose: () => void;
  onSpace: (space: Space | null) => void;
  onProject: (project: Project) => void;
  onNewProject: () => void;
  onNewTeam: () => void;
  onJoinTeam: () => void;
  onTeamSettings: () => void;
  onAuth: () => void;
  onLogout: () => void;
  onOps: () => void;
}) {
  const presence = usePresence(open, 'navigation');
  const personal = session.spaces.find((s) => s.kind === 'personal');
  const teams = session.spaces.filter((s) => s.kind === 'team');
  const selectedSpace = session.spaces.find((s) => s.id === spaceId);
  return (
    <>
      <button
        className={`sidebar-scrim ${open ? 'open' : ''}`}
        aria-label="关闭空间导航"
        aria-hidden={!open}
        inert={!open}
        disabled={!open}
        onClick={onClose}
      />
      <aside
        className={`sidebar ${open ? 'open' : ''}`}
        aria-label="空间与项目"
        data-motion="navigation"
        data-motion-state={presence.phase}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="sidebar-brand">
          <Brand name={brand} logoUrl={logoUrl} />
          <IconButton className="sidebar-close" label="关闭导航" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>
        <div className="sidebar-main">
          <div className="nav-section-label">我的空间</div>
          <button
            data-motion="space-row"
            className={`space-row ${!selectedSpace || selectedSpace.kind === 'personal' ? 'selected' : ''}`}
            onClick={() => onSpace(personal ?? null)}
          >
            <span className="space-avatar personal">
              <House
                size={19}
                weight={!selectedSpace || selectedSpace.kind === 'personal' ? 'fill' : 'regular'}
              />
            </span>
            <span>
              {personal?.name ?? '个人创作'}
              <small>{session.user ? '个人项目与素材' : '本地编辑工作台'}</small>
            </span>
            {(!selectedSpace || selectedSpace.kind === 'personal') && (
              <i className="selection-dot" />
            )}
          </button>
          <div className="nav-section-label section-spaced">
            共同创作
            <IconButton label="创建团队空间" onClick={session.user ? onNewTeam : onAuth}>
              <Plus size={16} />
            </IconButton>
          </div>
          {teams.map((space) => (
            <button
              key={space.id}
              data-motion="space-row"
              className={`space-row ${spaceId === space.id ? 'selected' : ''}`}
              onClick={() => onSpace(space)}
            >
              <span className="space-avatar team">
                <UsersThree size={20} />
              </span>
              <span>
                {space.name}
                <small>
                  {space.role === 'owner'
                    ? '团队所有者'
                    : space.role === 'admin'
                      ? '管理员'
                      : space.role === 'reviewer'
                        ? '审阅者'
                        : space.role === 'viewer'
                          ? '浏览成员'
                          : '共同创作者'}
                </small>
              </span>
              {spaceId === space.id && <i className="selection-dot" />}
            </button>
          ))}
          {!teams.length && (
            <div className="team-empty">
              <span>创建团队，共享项目与素材。</span>
              <button onClick={session.user ? onNewTeam : onAuth}>
                创建团队
                <ArrowRight size={13} />
              </button>
            </div>
          )}
          <button className="sidebar-text-action" onClick={session.user ? onJoinTeam : onAuth}>
            <LinkSimple size={16} />
            使用团队邀请码
          </button>
          <div className="sidebar-divider" />
          <div className="nav-section-label">
            当前空间的项目
            <IconButton label="新建项目" onClick={session.user ? onNewProject : onAuth}>
              <Plus size={16} />
            </IconButton>
          </div>
          {projects.length ? (
            <nav className="project-list" aria-label="项目">
              {projects.map((project) => (
                <button
                  data-motion="project-row"
                  className={selectedProject?.id === project.id ? 'selected' : ''}
                  key={project.id}
                  onClick={() => onProject(project)}
                >
                  <FolderOpen size={17} />
                  <span>{project.title}</span>
                </button>
              ))}
            </nav>
          ) : (
            <p className="sidebar-empty-copy">
              {session.user
                ? '尚无项目。创建后可保存作品与版本。'
                : '登录后，可以保存项目和历史版本。'}
            </p>
          )}
          {sharedProjects.length > 0 && (
            <>
              <div className="sidebar-divider" />
              <div className="nav-section-label">共享给我</div>
              <nav className="project-list" aria-label="共享给我的项目">
                {sharedProjects.map((project) => (
                  <button
                    data-motion="project-row"
                    className={selectedProject?.id === project.id ? 'selected' : ''}
                    key={project.id}
                    onClick={() => onProject(project)}
                  >
                    <LinkSimple size={17} />
                    <span>{project.title}</span>
                  </button>
                ))}
              </nav>
            </>
          )}
          {selectedSpace && (
            <button className="sidebar-text-action" onClick={onTeamSettings}>
              <GearSix size={16} />
              {selectedSpace.kind === 'team' ? '团队成员与共享' : '空间共享规则'}
            </button>
          )}
        </div>
        <div className="sidebar-bottom">
          {session.user?.isOperator && (
            <button className="sidebar-text-action" onClick={onOps}>
              <GearSix size={17} />
              运营管理
            </button>
          )}
          {session.user ? (
            <div className="account-row">
              <div className="user-avatar">{session.user.displayName.slice(0, 1)}</div>
              <div>
                <strong>{session.user.displayName}</strong>
                <span>{session.user.phoneMasked}</span>
              </div>
              <IconButton label="退出登录" onClick={onLogout}>
                <SignOut size={18} />
              </IconButton>
            </div>
          ) : (
            <button className="account-login" onClick={onAuth}>
              <UserCircle size={29} weight="light" />
              <span>
                <strong>登录工作空间</strong>
                <small>保存、同步，与团队协作</small>
              </span>
              <SignIn size={18} />
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
