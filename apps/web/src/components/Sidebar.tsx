import { useRef } from 'react';
import { t } from '../i18n';
import {
  FolderOpen,
  GearSix,
  House,
  Plus,
  SignIn,
  SignOut,
  UsersThree,
  UserCircle,
  LinkSimple,
} from '@phosphor-icons/react';
import type { Project, Session, Space } from '../lib/types';
import { BrandMark } from './BrandMark';
import { IconButton, Modal } from './Ui';
import { useNavigationProximity } from '../workspace/useNavigationProximity';
import '../workspace/navigation.css';

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
  onAccount,
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
  onAccount?: () => void;
  onLogout: () => void;
  onOps: () => void;
}) {
  const main = useRef<HTMLDivElement>(null);
  const initialFocus = useRef<HTMLButtonElement>(null);
  const personal = session.spaces.find((space) => space.kind === 'personal');
  const teams = session.spaces.filter((space) => space.kind === 'team');
  const selectedSpace = session.spaces.find((space) => space.id === spaceId);
  const personalSelected = !selectedSpace || selectedSpace.kind === 'personal';
  const rowsKey = [...session.spaces, ...projects, ...sharedProjects]
    .map((item) => item.id)
    .join(':');
  useNavigationProximity(main, open, rowsKey);

  return (
    <Modal
      title={
        <span className="sidebar-brand-title">
          <BrandMark logoUrl={logoUrl} />
          <span>{brand}</span>
        </span>
      }
      className="sidebar-navigation-modal"
      profile="navigation"
      open={open}
      keepMounted
      initialFocusRef={initialFocus}
      onClose={onClose}
    >
      <div ref={main} className="sidebar-main" aria-label={t('空间与项目')}>
        <section className="sidebar-section">
          <h3 className="nav-section-label">{t('我的空间')}</h3>
          <button
            ref={!selectedProject ? initialFocus : undefined}
            type="button"
            data-nav-row
            className={`space-row ${personalSelected ? 'selected' : ''}`}
            aria-current={personalSelected ? 'true' : undefined}
            onClick={() => onSpace(personal ?? null)}
          >
            <span className="sidebar-row-marker" aria-hidden="true" />
            <House size={19} />
            <span className="sidebar-row-name">{personal?.name ?? t('个人创作')}</span>
          </button>
        </section>
        <section className="sidebar-section">
          <div className="nav-section-heading">
            <h3 className="nav-section-label">{t('共同创作')}</h3>
            {!!teams.length && (
              <IconButton label={t('创建团队空间')} onClick={session.user ? onNewTeam : onAuth}>
                <Plus size={17} />
              </IconButton>
            )}
          </div>
          {teams.map((space) => (
            <button
              type="button"
              key={space.id}
              data-nav-row
              className={`space-row ${spaceId === space.id ? 'selected' : ''}`}
              aria-current={spaceId === space.id ? 'true' : undefined}
              onClick={() => onSpace(space)}
            >
              <span className="sidebar-row-marker" aria-hidden="true" />
              <UsersThree size={19} />
              <span className="sidebar-row-name">
                {space.name}
                <small>
                  {space.role === 'owner'
                    ? t('团队所有者')
                    : space.role === 'admin'
                      ? t('管理员')
                      : space.role === 'reviewer'
                        ? t('审阅者')
                        : space.role === 'viewer'
                          ? t('浏览成员')
                          : t('共同创作者')}
                </small>
              </span>
            </button>
          ))}
          {!teams.length && (
            <button
              className="sidebar-text-action"
              type="button"
              onClick={session.user ? onNewTeam : onAuth}
            >
              <Plus size={17} />
              {t('创建团队')}
            </button>
          )}
          <button
            className="sidebar-text-action"
            type="button"
            onClick={session.user ? onJoinTeam : onAuth}
          >
            <LinkSimple size={17} />
            {t('使用团队邀请码')}
          </button>
        </section>
        <section className="sidebar-section">
          <div className="nav-section-heading">
            <h3 className="nav-section-label">{t('项目')}</h3>
            {!!projects.length && (
              <IconButton label={t('新建项目')} onClick={session.user ? onNewProject : onAuth}>
                <Plus size={17} />
              </IconButton>
            )}
          </div>
          {projects.length ? (
            <nav className="project-list" aria-label={t('项目')}>
              {projects.map((project) => (
                <button
                  ref={selectedProject?.id === project.id ? initialFocus : undefined}
                  type="button"
                  data-nav-row
                  className={selectedProject?.id === project.id ? 'selected' : ''}
                  aria-current={selectedProject?.id === project.id ? 'page' : undefined}
                  key={project.id}
                  onClick={() => onProject(project)}
                >
                  <span className="sidebar-row-marker" aria-hidden="true" />
                  <FolderOpen size={19} />
                  <span className="sidebar-row-name">{project.title}</span>
                </button>
              ))}
            </nav>
          ) : (
            <button
              className="sidebar-text-action"
              type="button"
              onClick={session.user ? onNewProject : onAuth}
            >
              <Plus size={17} />
              {t('新建项目')}
            </button>
          )}
        </section>
        {sharedProjects.length > 0 && (
          <section className="sidebar-section">
            <h3 className="nav-section-label">{t('共享给我')}</h3>
            <nav className="project-list" aria-label={t('共享给我的项目')}>
              {sharedProjects.map((project) => (
                <button
                  ref={selectedProject?.id === project.id ? initialFocus : undefined}
                  type="button"
                  data-nav-row
                  className={selectedProject?.id === project.id ? 'selected' : ''}
                  aria-current={selectedProject?.id === project.id ? 'page' : undefined}
                  key={project.id}
                  onClick={() => onProject(project)}
                >
                  <span className="sidebar-row-marker" aria-hidden="true" />
                  <LinkSimple size={19} />
                  <span className="sidebar-row-name">{project.title}</span>
                </button>
              ))}
            </nav>
          </section>
        )}
        {selectedSpace && (
          <button
            className="sidebar-text-action sidebar-rules"
            type="button"
            onClick={onTeamSettings}
          >
            <GearSix size={18} />
            {selectedSpace.kind === 'team' ? t('团队成员与共享') : t('空间共享规则')}
          </button>
        )}
      </div>
      <div className="sidebar-bottom">
        {session.user?.isOperator && (
          <button className="sidebar-text-action" type="button" onClick={onOps}>
            <GearSix size={18} />
            {t('运营管理')}
          </button>
        )}
        {session.user ? (
          <div className="account-row">
            <button
              type="button"
              className="sidebar-account-details"
              onClick={onAccount}
              aria-label={t('账号与使用：{v0}', { v0: session.user.displayName })}
            >
              <span className="user-avatar" aria-hidden="true">
                {session.user.displayName.slice(0, 1)}
              </span>
              <span>
                <strong>{session.user.displayName}</strong>
                <span>{session.user.phoneMasked}</span>
              </span>
            </button>
            <IconButton label={t('退出登录选项')} onClick={onLogout}>
              <SignOut size={18} />
            </IconButton>
          </div>
        ) : (
          <button className="account-login" type="button" onClick={onAuth}>
            <UserCircle size={23} />
            <strong>{t('登录工作空间')}</strong>
            <SignIn size={18} />
          </button>
        )}
      </div>
    </Modal>
  );
}
