import {
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  ArrowClockwise,
  ArrowRight,
  ChartBar,
  CheckCircle,
  Clock,
  CreditCard,
  DeviceMobile,
  DownloadSimple,
  FolderPlus,
  Info,
  LockKey,
  ShieldCheck,
  SignOut,
  SpinnerGap,
  Trash,
  UploadSimple,
  UserCircle,
  Wallet,
  WarningCircle,
} from '@phosphor-icons/react';
import { DialogMotionContext } from '../components/Ui';
import { AccountPageFrame } from './AccountPageFrame';
import { api, ApiError, errorMessage } from '../lib/api';
import type { PublicConfig, Session } from '../lib/types';
import { AccountDocumentDrafts } from './AccountDocumentDrafts';
import { t, useLocale } from '../i18n';
import {
  accountPhone,
  accountRole,
  accountScope,
  accountSpace,
  accountStatus,
  formatAccountPeriod,
  formatAccountUnits,
  nextAccountTab,
  readAccountEntitlements,
  type AccountEntitlements,
  type AccountTab,
} from './account-model';

export type AccountCenterProps = {
  session: Session;
  config: PublicConfig | null;
  spaceId: string | null;
  hasImage: boolean;
  hasUnsavedChanges: boolean;
  activity: { ai: boolean; voice: boolean };
  loggingOut: boolean;
  logoutError: string | null;
  initialTab?: AccountTab;
  onClose: () => void;
  onHome?: () => void;
  onSupport: () => void;
  onResetPassword: () => void;
  onUsage: () => void;
  onExport: () => void;
  onLogout: () => void | Promise<void>;
  onReturnToActivity: () => void;
  onStartProject?: () => void;
  onImport?: () => void;
  /** A current 401 asks the owner to re-check the session; a 403 is space-scoped. */
  onSessionExpired?: () => void;
};

const tabs = [
  { id: 'overview', label: '概览', icon: UserCircle },
  { id: 'security', label: '安全', icon: ShieldCheck },
  { id: 'billing', label: '额度', icon: Wallet },
  { id: 'data', label: '数据与退出', icon: SignOut },
] as const;

type EntitlementState =
  | { key: string | null; kind: 'loading' }
  | { key: string; kind: 'ready'; data: AccountEntitlements }
  | { key: string; kind: 'error'; message: string; expired: boolean };

function revealAccountTab(button: HTMLButtonElement, list: HTMLDivElement) {
  const left = button.offsetLeft - 4;
  const right = button.offsetLeft + button.offsetWidth + 4;
  if (left < list.scrollLeft) list.scrollLeft = left;
  else if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth;
}

function AccountFact({
  label,
  children,
  note,
}: {
  label: string;
  children: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="account-fact">
      <dt>{label}</dt>
      <dd>
        {children}
        {note && <span className="account-fact-note">{note}</span>}
      </dd>
    </div>
  );
}

export function AccountCenter({
  session,
  config,
  spaceId,
  hasImage,
  hasUnsavedChanges,
  activity,
  loggingOut,
  logoutError,
  initialTab = 'overview',
  onClose,
  onHome,
  onSupport,
  onResetPassword,
  onUsage,
  onExport,
  onLogout,
  onReturnToActivity,
  onStartProject,
  onImport,
  onSessionExpired,
}: AccountCenterProps) {
  const locale = useLocale();
  const id = useId();
  const user = session.user;
  const space = accountSpace(session, spaceId);
  const scope = accountScope(user?.id, space?.id);
  const spaceKey = space?.id;
  const [tab, setTab] = useState<AccountTab>(initialTab);
  const [direction, setDirection] = useState(1);
  const [retry, setRetry] = useState(0);
  const [entitlements, setEntitlements] = useState<EntitlementState>({
    key: null,
    kind: 'loading',
  });
  const [wide, setWide] = useState(() =>
    typeof window === 'undefined'
      ? false
      : window.matchMedia('(min-width: 760px) and (min-height: 500px)').matches,
  );
  const [indicator, setIndicator] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const tabList = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Partial<Record<AccountTab, HTMLButtonElement | null>>>({});
  const sequence = useRef(0);
  const latestScope = useRef(scope);
  const expiredCallback = useRef(onSessionExpired);
  const dialogContext = useContext(DialogMotionContext);
  const visible = dialogContext?.open ?? true;
  latestScope.current = visible ? scope : null;
  expiredCallback.current = onSessionExpired;

  useEffect(() => {
    const media = window.matchMedia('(min-width: 760px) and (min-height: 500px)');
    const update = () => setWide(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!scope || !spaceKey || !visible) return;
    const request = ++sequence.current;
    const controller = new AbortController();
    const current = () =>
      !controller.signal.aborted && request === sequence.current && latestScope.current === scope;
    setEntitlements({ key: scope, kind: 'loading' });
    void api<unknown>(`/me/entitlements?spaceId=${encodeURIComponent(spaceKey)}`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!current()) return;
        const data = readAccountEntitlements(response, spaceKey);
        setEntitlements({ key: scope, kind: 'ready', data });
      })
      .catch((error: unknown) => {
        if (!current()) return;
        const expired = error instanceof ApiError && error.status === 401;
        setEntitlements({
          key: scope,
          kind: 'error',
          expired,
          message: expired
            ? '登录状态需要重新确认，请稍后重试。'
            : error instanceof ApiError && error.status === 403
              ? '暂时无法查看这个空间的额度，请确认你的空间权限。'
              : errorMessage(error),
        });
        if (expired) expiredCallback.current?.();
      });
    return () => controller.abort();
  }, [scope, spaceKey, retry, visible]);

  useLayoutEffect(() => {
    const list = tabList.current;
    if (!list) return;
    let frame = 0;
    const measure = () => {
      const button = tabRefs.current[tab];
      if (!button || !list.isConnected) return;
      const next = {
        x: button.offsetLeft,
        y: button.offsetTop,
        width: button.offsetWidth,
        height: button.offsetHeight,
      };
      // Covers an initial data tab and viewport changes, before focus is restored.
      if (!wide) revealAccountTab(button, list);
      setIndicator((previous) =>
        Object.keys(next).every(
          (key) => previous[key as keyof typeof next] === next[key as keyof typeof next],
        )
          ? previous
          : next,
      );
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(list);
    for (const button of Object.values(tabRefs.current)) if (button) observer?.observe(button);
    return () => {
      observer?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [tab, wide, locale]);

  const selectTab = (next: AccountTab, focus = false) => {
    const nextIndex = tabs.findIndex((item) => item.id === next);
    const previousIndex = tabs.findIndex((item) => item.id === tab);
    if (next !== tab) {
      setDirection(nextIndex > previousIndex ? 1 : -1);
      setTab(next);
    }
    const button = tabRefs.current[next];
    const list = tabList.current;
    if (!button || !list) return;
    if (focus) button.focus({ preventScroll: true });
    // Scroll only the tab strip, never the photo workspace or its parent dialog.
    if (!wide) revealAccountTab(button, list);
  };

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
    const next = nextAccountTab(tab, event.key);
    if (!next) return;
    event.preventDefault();
    selectTab(next, true);
  };

  // This render-time gate hides a previous user's/space's receipt before effects run.
  const quota = scope && entitlements.key === scope ? entitlements : null;
  const account = accountStatus(user?.status ?? '');
  const personalCount = session.spaces.filter((item) => item.kind === 'personal').length;
  const teamCount = session.spaces.filter((item) => item.kind === 'team').length;
  const activeWork = activity.ai || activity.voice;
  const activityLabel =
    activity.ai && activity.voice
      ? 'AI 任务和语音正在进行'
      : activity.ai
        ? 'AI 任务正在进行'
        : activity.voice
          ? '语音正在使用'
          : null;

  if (!user) return null;

  return (
    <AccountPageFrame
      title={t('账号与使用')}
      config={config}
      onBack={onClose}
      onHome={onHome}
      busy={loggingOut}
      wide
      hideHeading
      className="account-page-center"
    >
      <div
        className="account-center"
        data-testid="account-center"
        data-account-layout={wide ? 'rail' : 'strip'}
      >
        <aside className="account-rail" aria-label={t('当前账号')}>
          <div className="account-identity">
            <span className="account-avatar" aria-hidden>
              {Array.from(user.displayName.trim())[0] || '·'}
            </span>
            <div className="account-identity-copy">
              <h3>{user.displayName || t('当前账号')}</h3>
            </div>
          </div>
          <div className="account-tabs-wrap">
            <div
              className="account-tabs"
              ref={tabList}
              role="tablist"
              aria-label={t('账号设置')}
              aria-orientation={wide ? 'vertical' : 'horizontal'}
            >
              <span
                className="account-tab-indicator"
                aria-hidden
                style={
                  {
                    width: indicator.width,
                    height: indicator.height,
                    transform: `translate3d(${indicator.x}px, ${indicator.y}px, 0)`,
                    visibility: indicator.width ? 'visible' : 'hidden',
                  } as CSSProperties
                }
              />
              {tabs.map((item) => {
                const Symbol = item.icon;
                return (
                  <button
                    key={item.id}
                    ref={(node) => {
                      tabRefs.current[item.id] = node;
                    }}
                    type="button"
                    role="tab"
                    id={`${id}-tab-${item.id}`}
                    aria-controls={`${id}-panel-${item.id}`}
                    aria-selected={tab === item.id}
                    tabIndex={tab === item.id ? 0 : -1}
                    data-testid={`account-tab-${item.id}`}
                    className="account-tab"
                    onClick={() => selectTab(item.id)}
                    onKeyDown={onTabKey}
                  >
                    <Symbol size={18} aria-hidden />
                    <span>{t(item.label)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        <div
          className="account-content"
          style={{ '--account-direction': direction } as CSSProperties}
        >
          {tabs
            .filter((item) => item.id !== tab)
            .map((item) => (
              <section
                key={item.id}
                id={`${id}-panel-${item.id}`}
                role="tabpanel"
                aria-labelledby={`${id}-tab-${item.id}`}
                hidden
              />
            ))}
          <section
            key={tab}
            id={`${id}-panel-${tab}`}
            role="tabpanel"
            aria-labelledby={`${id}-tab-${tab}`}
            className={`account-panel account-panel-${tab}`}
            tabIndex={0}
          >
            {tab === 'overview' && (
              <>
                <dl className="account-facts">
                  <AccountFact label={t('手机号')}>{t(accountPhone(user.phoneMasked))}</AccountFact>
                  <AccountFact label={t('账号状态')}>
                    <span className={`account-status account-status-${account.tone}`}>
                      {account.tone === 'success' ? (
                        <CheckCircle size={15} aria-hidden />
                      ) : (
                        <Info size={15} aria-hidden />
                      )}
                      {t(account.label)}
                    </span>
                    {user.isOperator && <span className="account-role-label">{t('运营权限')}</span>}
                  </AccountFact>
                  <AccountFact
                    label={t('当前空间')}
                    note={
                      space
                        ? `${t(space.kind === 'team' ? '团队空间' : '个人空间')} · ${t(accountRole(space.role))}`
                        : t('返回工作区选择可访问的空间。')
                    }
                  >
                    {space?.name ?? t('暂无可用空间')}
                  </AccountFact>
                  <AccountFact label={t('已加入空间')}>
                    {t('{count} 个个人空间', { count: personalCount })}
                    <span className="account-text-separator">·</span>
                    {t('{count} 个团队空间', { count: teamCount })}
                  </AccountFact>
                </dl>
                <div className="account-services">
                  <h4>{t('服务状态')}</h4>
                  <dl className="account-service-list">
                    <div>
                      <dt>{t('云端 AI')}</dt>
                      <dd
                        title={
                          config &&
                          !config.capabilities.aiConfigured &&
                          config.capabilities.aiUnavailableReason
                            ? t(config.capabilities.aiUnavailableReason)
                            : undefined
                        }
                        data-state={
                          !config
                            ? 'unknown'
                            : config.capabilities.aiConfigured
                              ? 'ready'
                              : 'unavailable'
                        }
                      >
                        {!config
                          ? t('待确认')
                          : config.capabilities.aiConfigured
                            ? t('已配置')
                            : t('暂不可用')}
                      </dd>
                    </div>
                    <div>
                      <dt>{t('短信验证')}</dt>
                      <dd
                        data-state={
                          !config
                            ? 'unknown'
                            : config.capabilities.smsConfigured
                              ? 'ready'
                              : 'unavailable'
                        }
                      >
                        {!config
                          ? t('待确认')
                          : config.capabilities.smsConfigured
                            ? t('已配置')
                            : t('暂不可用')}
                      </dd>
                    </div>
                  </dl>
                </div>
                {(onStartProject || onImport) && (
                  <div className="account-overview-actions">
                    {onImport && (
                      <button
                        type="button"
                        className="account-action account-action-primary"
                        disabled={loggingOut}
                        onClick={onImport}
                      >
                        <UploadSimple size={18} aria-hidden />
                        {t('导入照片')}
                      </button>
                    )}
                    {onStartProject && (
                      <button
                        type="button"
                        className="account-action"
                        disabled={loggingOut || !space}
                        onClick={onStartProject}
                      >
                        <FolderPlus size={18} aria-hidden />
                        {t('新建项目')}
                      </button>
                    )}
                    <button
                      type="button"
                      className="account-action"
                      disabled={loggingOut}
                      onClick={onSupport}
                    >
                      <Wallet size={18} aria-hidden />
                      {t('订阅与支持')}
                    </button>
                  </div>
                )}
              </>
            )}

            {tab === 'security' && (
              <>
                <div className="account-security-row">
                  <DeviceMobile size={22} aria-hidden />
                  <div>
                    <h4>{t('绑定手机号')}</h4>
                    <p className="account-phone">{t(accountPhone(user.phoneMasked))}</p>
                  </div>
                </div>
                <div className="account-security-row account-reset-row">
                  <LockKey size={22} aria-hidden />
                  <div>
                    <h4>{t('重置密码')}</h4>
                    <p>{t('重置后，该账号的所有设备都需要重新登录。')} </p>
                    <button
                      type="button"
                      className="account-action"
                      data-testid="account-reset-password"
                      disabled={loggingOut}
                      onClick={onResetPassword}
                    >
                      {t('重置密码')} <ArrowRight size={17} aria-hidden />
                    </button>
                  </div>
                </div>
                {config && !config.capabilities.smsConfigured && (
                  <div className="account-feedback account-feedback-warning" role="status">
                    <WarningCircle size={18} aria-hidden />
                    <p>{t('短信暂不可用，暂时无法重置密码。')}</p>
                  </div>
                )}
              </>
            )}

            {tab === 'billing' && (
              <>
                <header className="account-panel-heading account-billing-heading">
                  <div>
                    <span className="account-section-label">{t('当前空间额度')}</span>
                    <h3>{space?.name ?? t('请选择空间')}</h3>
                    <p>{space?.kind === 'team' ? t('团队共享的服务点') : t('个人空间的服务点')}</p>
                  </div>
                  <button
                    type="button"
                    className="account-refresh"
                    aria-label={t('刷新额度')}
                    title={t('刷新额度')}
                    disabled={!scope || loggingOut || quota?.kind === 'loading' || !quota}
                    onClick={() => setRetry((value) => value + 1)}
                  >
                    <ArrowClockwise size={18} aria-hidden />
                  </button>
                </header>
                <div
                  className="account-entitlements"
                  aria-busy={!!scope && (!quota || quota.kind === 'loading')}
                >
                  {!scope ? (
                    <div className="account-feedback">
                      <Info size={18} aria-hidden />
                      <p>{t('请先在工作区选择空间。')}</p>
                    </div>
                  ) : !quota || quota.kind === 'loading' ? (
                    <div className="account-quota-loading" role="status">
                      <span className="sr-only">{t('正在读取当前空间额度…')}</span>
                      <span className="account-quota-skeleton" aria-hidden>
                        <i />
                        <i />
                        <i />
                      </span>
                    </div>
                  ) : quota.kind === 'error' ? (
                    <div className="account-quota-error" role="alert">
                      <WarningCircle size={20} aria-hidden />
                      <p>{t(quota.message)}</p>
                      <button
                        type="button"
                        className="account-action"
                        disabled={loggingOut}
                        onClick={() => setRetry((value) => value + 1)}
                      >
                        <ArrowClockwise size={16} aria-hidden />
                        {t('重新读取')}
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="account-balance">
                        <span>{t('可用服务点')}</span>
                        <strong data-testid="account-available-units">
                          {formatAccountUnits(quota.data.available)}
                        </strong>
                      </div>
                      <dl className="account-quota-breakdown">
                        <div>
                          <dt>{t('免费与获赠')}</dt>
                          <dd>{formatAccountUnits(quota.data.freeAvailable)}</dd>
                        </div>
                        <div>
                          <dt>{t('已购可用')}</dt>
                          <dd>{formatAccountUnits(quota.data.purchasedAvailable)}</dd>
                        </div>
                        <div>
                          <dt>
                            <Clock size={14} aria-hidden />
                            {t('任务预占')}
                          </dt>
                          <dd>{formatAccountUnits(quota.data.held)}</dd>
                        </div>
                      </dl>
                      {quota.data.held > 0 && (
                        <p className="account-helper">{t('预占额度会在任务结束后结算或释放。')} </p>
                      )}
                      <p className="account-period">
                        {t('本周期至 {date}', { date: formatAccountPeriod(quota.data.periodEnd) })}
                        <span>{t('北京时间')}</span>
                      </p>
                    </>
                  )}
                </div>
                <button
                  type="button"
                  className="account-action account-usage-link"
                  disabled={!space || loggingOut}
                  onClick={onUsage}
                >
                  <ChartBar size={18} aria-hidden />
                  {t('查看用量与账本')} <ArrowRight size={16} aria-hidden />
                </button>
                <div className="account-payment" data-testid="account-payment-status">
                  <CreditCard size={21} aria-hidden />
                  <div>
                    <div className="account-capability-heading">
                      <h4>{t('购买与订阅')}</h4>
                      <span>{t('尚未开放')}</span>
                    </div>
                    <button
                      type="button"
                      className="account-action"
                      disabled={loggingOut}
                      onClick={onSupport}
                    >
                      {t('订阅与支持')} <ArrowRight size={16} aria-hidden />
                    </button>
                  </div>
                </div>
              </>
            )}

            {tab === 'data' && (
              <>
                <header className="account-panel-heading">
                  <h3>{t('带走你的作品')}</h3>
                </header>
                <div className="account-export-row">
                  <DownloadSimple size={23} aria-hidden />
                  <div>
                    <h4>{t('当前照片')}</h4>
                    <p>{!hasImage ? t('还没有打开照片。') : t('保存一份到当前设备。')}</p>
                    <button
                      type="button"
                      className="account-action"
                      disabled={!hasImage || loggingOut}
                      onClick={onExport}
                    >
                      <DownloadSimple size={18} aria-hidden />
                      {t('导出当前照片')}
                    </button>
                  </div>
                </div>
                {(activeWork || hasUnsavedChanges) && (
                  <div className="account-activity" role="status">
                    <span className="account-activity-dot" aria-hidden />
                    <div>
                      <h4>{activityLabel ? t(activityLabel) : t('工作区还有未保存内容')}</h4>
                      <p>
                        {hasUnsavedChanges
                          ? activeWork
                            ? t('还有未保存内容。返回工作区保存并确认任务状态，再决定是否退出。')
                            : t('返回工作区保存；照片也可以先导出到设备。')
                          : t('返回工作区查看当前状态，再决定是否退出。')}
                      </p>
                      <button
                        type="button"
                        className="account-text-action"
                        disabled={loggingOut}
                        onClick={onReturnToActivity}
                      >
                        {t('返回工作区')} <ArrowRight size={16} aria-hidden />
                      </button>
                    </div>
                  </div>
                )}
                <AccountDocumentDrafts
                  key={user.id}
                  actorId={user.status === 'active' ? user.id : null}
                  disabled={loggingOut}
                  visible={visible}
                />
                <div className="account-signout-row">
                  <div>
                    <h4>{t('退出当前登录')}</h4>
                    <p>{t('云端作品与当前照片会保留；本页文档草稿将清除。')} </p>
                  </div>
                  <button
                    type="button"
                    className="account-action account-signout-action"
                    data-testid="account-logout"
                    disabled={loggingOut}
                    aria-busy={loggingOut}
                    onClick={() => {
                      void onLogout();
                    }}
                  >
                    {loggingOut ? (
                      <SpinnerGap className="account-spinner" size={18} aria-hidden />
                    ) : (
                      <SignOut size={18} aria-hidden />
                    )}
                    {loggingOut ? t('正在退出…') : t('退出登录')}
                  </button>
                </div>
                {logoutError && (
                  <div className="account-feedback account-feedback-error" role="alert">
                    <WarningCircle size={18} aria-hidden />
                    <p>{t(logoutError)}</p>
                  </div>
                )}
                <div
                  className="account-deletion account-deletion-notice"
                  data-testid="account-deletion-status"
                >
                  <Trash size={17} aria-hidden />
                  <h4>{t('注销账号')}</h4>
                  <span>{t('暂不支持自助注销')}</span>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </AccountPageFrame>
  );
}
