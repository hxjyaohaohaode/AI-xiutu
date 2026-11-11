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
  CaretDown,
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
  UsersThree,
  Wallet,
  WarningCircle,
} from '@phosphor-icons/react';
import { DialogMotionContext, Modal } from '../components/Ui';
import { api, ApiError, errorMessage } from '../lib/api';
import type { PublicConfig, Session } from '../lib/types';
import { MotionDetails, MotionDisclosure } from '../motion/Presence';
import { AccountDocumentDrafts } from './AccountDocumentDrafts';
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
  { id: 'billing', label: '额度与付费', icon: Wallet },
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

function AccountFaq({ question, children }: { question: string; children: ReactNode }) {
  return (
    <MotionDetails className="account-faq">
      <summary>
        <span>{question}</span>
        <CaretDown size={16} aria-hidden />
      </summary>
      <p>{children}</p>
    </MotionDetails>
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
  onResetPassword,
  onUsage,
  onExport,
  onLogout,
  onReturnToActivity,
  onStartProject,
  onImport,
  onSessionExpired,
}: AccountCenterProps) {
  const id = useId();
  const user = session.user;
  const space = accountSpace(session, spaceId);
  const scope = accountScope(user?.id, space?.id);
  const spaceKey = space?.id;
  const [tab, setTab] = useState<AccountTab>(initialTab);
  const [direction, setDirection] = useState(1);
  const [deletionOpen, setDeletionOpen] = useState(false);
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
  const initialFocus = useRef<HTMLButtonElement | null>(null);
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
  }, [tab, wide]);

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
    <Modal
      title="账号与使用"
      profile="account"
      className="studio-dialog account-dialog"
      onClose={onClose}
      canClose={() => !loggingOut}
      initialFocusRef={initialFocus}
    >
      <div
        className="account-center"
        data-testid="account-center"
        data-account-layout={wide ? 'rail' : 'strip'}
      >
        <aside className="account-rail" aria-label="当前账号">
          <div className="account-identity">
            <span className="account-avatar" aria-hidden>
              <UserCircle size={26} weight="light" />
            </span>
            <div className="account-identity-copy">
              <h3>{user.displayName || '当前账号'}</h3>
              <p className="account-phone">{accountPhone(user.phoneMasked)}</p>
            </div>
          </div>
          <div className="account-tabs-wrap">
            <div
              className="account-tabs"
              ref={tabList}
              role="tablist"
              aria-label="账号设置"
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
                      if (item.id === initialTab) initialFocus.current = node;
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
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <p className="account-rail-context">
            {space?.kind === 'team' ? (
              <UsersThree size={16} aria-hidden />
            ) : (
              <LockKey size={16} aria-hidden />
            )}
            <span>
              {space
                ? space.kind === 'team'
                  ? '当前为团队空间'
                  : '当前为个人空间'
                : '尚未选择空间'}
            </span>
          </p>
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
                <header className="account-panel-heading">
                  <span className="account-section-label">账号概览</span>
                  <h3>你的账号</h3>
                  <p>身份、空间与当前可用的服务。</p>
                </header>
                <dl className="account-facts">
                  <AccountFact label="手机号">{accountPhone(user.phoneMasked)}</AccountFact>
                  <AccountFact label="账号状态">
                    <span className={`account-status account-status-${account.tone}`}>
                      {account.tone === 'success' ? (
                        <CheckCircle size={15} aria-hidden />
                      ) : (
                        <Info size={15} aria-hidden />
                      )}
                      {account.label}
                    </span>
                    {user.isOperator && <span className="account-role-label">运营权限</span>}
                  </AccountFact>
                  <AccountFact
                    label="当前空间"
                    note={
                      space
                        ? `${space.kind === 'team' ? '团队空间' : '个人空间'} · ${accountRole(space.role)}`
                        : '返回工作区选择可访问的空间。'
                    }
                  >
                    {space?.name ?? '暂无可用空间'}
                  </AccountFact>
                  <AccountFact label="已加入空间">
                    {personalCount} 个个人空间<span className="account-text-separator">·</span>
                    {teamCount} 个团队空间
                  </AccountFact>
                </dl>
                <div className="account-space-note">
                  {space?.kind === 'team' ? (
                    <UsersThree size={18} aria-hidden />
                  ) : (
                    <LockKey size={18} aria-hidden />
                  )}
                  <p>
                    {space?.kind === 'team'
                      ? '团队的作品与额度按当前空间管理。个人额度不会与这里合并显示。'
                      : '个人与团队空间分别管理作品和额度。切换空间后，以对应空间的权限为准。'}
                  </p>
                </div>
                <div className="account-services">
                  <h4>服务状态</h4>
                  <dl className="account-service-list">
                    <div>
                      <dt>云端 AI</dt>
                      <dd
                        data-state={
                          !config
                            ? 'unknown'
                            : config.capabilities.aiConfigured
                              ? 'ready'
                              : 'unavailable'
                        }
                      >
                        {!config
                          ? '待确认'
                          : config.capabilities.aiConfigured
                            ? '已配置'
                            : '暂不可用'}
                      </dd>
                    </div>
                    <div>
                      <dt>短信验证</dt>
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
                          ? '待确认'
                          : config.capabilities.smsConfigured
                            ? '已配置'
                            : '暂不可用'}
                      </dd>
                    </div>
                  </dl>
                  {config &&
                    !config.capabilities.aiConfigured &&
                    config.capabilities.aiUnavailableReason && (
                      <p className="account-helper">{config.capabilities.aiUnavailableReason}</p>
                    )}
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
                        导入照片
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
                        新建项目
                      </button>
                    )}
                  </div>
                )}
              </>
            )}

            {tab === 'security' && (
              <>
                <header className="account-panel-heading">
                  <span className="account-section-label">登录与安全</span>
                  <h3>保护账号访问</h3>
                  <p>使用绑定的手机号验证身份。</p>
                </header>
                <div className="account-security-row">
                  <DeviceMobile size={22} aria-hidden />
                  <div>
                    <h4>绑定手机号</h4>
                    <p className="account-phone">{accountPhone(user.phoneMasked)}</p>
                    <p className="account-helper">登录和重置密码时使用。</p>
                  </div>
                </div>
                <div className="account-security-row account-reset-row">
                  <LockKey size={22} aria-hidden />
                  <div>
                    <h4>重置密码</h4>
                    <p>
                      重置成功后，该手机号对应账号在所有设备上的旧登录会话都会失效，需要用新密码重新登录。
                    </p>
                    <button
                      type="button"
                      className="account-action"
                      data-testid="account-reset-password"
                      disabled={loggingOut}
                      onClick={onResetPassword}
                    >
                      重置密码
                      <ArrowRight size={17} aria-hidden />
                    </button>
                  </div>
                </div>
                {config && !config.capabilities.smsConfigured && (
                  <div className="account-feedback account-feedback-warning" role="status">
                    <WarningCircle size={18} aria-hidden />
                    <p>短信服务暂未开通，目前无法接收重置密码所需的验证码。</p>
                  </div>
                )}
                <AccountFaq question="已有账号，还能用同一手机号注册吗？">
                  已注册的手机号请直接登录；忘记密码可通过短信重置。退出登录不会释放手机号，也不会创建新账号。
                </AccountFaq>
              </>
            )}

            {tab === 'billing' && (
              <>
                <header className="account-panel-heading account-billing-heading">
                  <div>
                    <span className="account-section-label">当前空间额度</span>
                    <h3>{space?.name ?? '请选择空间'}</h3>
                    <p>{space?.kind === 'team' ? '团队共享的服务点' : '个人空间的服务点'}</p>
                  </div>
                  <button
                    type="button"
                    className="account-refresh"
                    aria-label="刷新额度"
                    title="刷新额度"
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
                      <p>当前没有可查询的空间。请返回工作区，选择你可以访问的空间。</p>
                    </div>
                  ) : !quota || quota.kind === 'loading' ? (
                    <div className="account-quota-loading" role="status">
                      <SpinnerGap className="account-spinner" size={20} aria-hidden />
                      <span>正在读取当前空间额度…</span>
                    </div>
                  ) : quota.kind === 'error' ? (
                    <div className="account-quota-error" role="alert">
                      <WarningCircle size={20} aria-hidden />
                      <p>{quota.message}</p>
                      <button
                        type="button"
                        className="account-action"
                        disabled={loggingOut}
                        onClick={() => setRetry((value) => value + 1)}
                      >
                        <ArrowClockwise size={16} aria-hidden />
                        重新读取
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="account-balance">
                        <span>可用服务点</span>
                        <strong data-testid="account-available-units">
                          {formatAccountUnits(quota.data.available)}
                        </strong>
                        <p>服务点用于结算云端任务，具体消耗以任务与账本记录为准。</p>
                      </div>
                      <dl className="account-quota-breakdown">
                        <div>
                          <dt>免费与获赠</dt>
                          <dd>{formatAccountUnits(quota.data.freeAvailable)}</dd>
                        </div>
                        <div>
                          <dt>已购可用</dt>
                          <dd>{formatAccountUnits(quota.data.purchasedAvailable)}</dd>
                        </div>
                        <div>
                          <dt>
                            <Clock size={14} aria-hidden />
                            任务预占
                          </dt>
                          <dd>{formatAccountUnits(quota.data.held)}</dd>
                        </div>
                      </dl>
                      {quota.data.held > 0 && (
                        <p className="account-helper">
                          预占额度暂不能使用，任务结算后由服务端扣除或释放。
                        </p>
                      )}
                      <p className="account-period">
                        当前周期至 {formatAccountPeriod(quota.data.periodEnd)}
                        <span>北京时间 · 各笔权益有效期以账本为准</span>
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
                  查看用量与账本
                  <ArrowRight size={16} aria-hidden />
                </button>
                <div className="account-payment" data-testid="account-payment-status">
                  <CreditCard size={21} aria-hidden />
                  <div>
                    <h4>在线购买暂未开放</h4>
                    <p>
                      {!config
                        ? '暂时无法确认支付服务状态，当前没有可使用的购买入口。'
                        : config.capabilities.paymentConfigured
                          ? '购买流程尚未开放。当前无法购买套餐或开通订阅。'
                          : '支付服务尚未开通，当前无法购买套餐或开通订阅。'}
                    </p>
                    <p className="account-helper">已有额度仍以当前空间账本为准。</p>
                  </div>
                </div>
                <AccountFaq question="服务点等于付款金额吗？">
                  不等于。服务点是云端任务的计量额度，不是现金。这里展示当前空间的可用与预占数量；每笔任务的消耗和模型用量请查看账本。
                </AccountFaq>
              </>
            )}

            {tab === 'data' && (
              <>
                <header className="account-panel-heading">
                  <span className="account-section-label">数据与退出</span>
                  <h3>离开前确认作品</h3>
                  <p>导出照片与保留的文档草稿，再决定是否退出。</p>
                </header>
                <div className="account-export-row">
                  <DownloadSimple size={23} aria-hidden />
                  <div>
                    <h4>当前照片</h4>
                    <p>{!hasImage ? '工作区中还没有照片。' : '可以将当前照片导出到设备。'}</p>
                    <button
                      type="button"
                      className="account-action"
                      disabled={!hasImage || loggingOut}
                      onClick={onExport}
                    >
                      <DownloadSimple size={18} aria-hidden />
                      导出当前照片
                    </button>
                  </div>
                </div>
                {(activeWork || hasUnsavedChanges) && (
                  <div className="account-activity" role="status">
                    <span className="account-activity-dot" aria-hidden />
                    <div>
                      <h4>{activityLabel ?? '工作区还有未保存内容'}</h4>
                      <p>
                        {hasUnsavedChanges
                          ? activeWork
                            ? '还有未保存内容。返回工作区保存并确认任务状态，再决定是否退出。'
                            : '返回工作区保存；照片也可以先导出到设备。'
                          : '返回工作区查看当前状态，再决定是否退出。'}
                      </p>
                      <button
                        type="button"
                        className="account-text-action"
                        disabled={loggingOut}
                        onClick={onReturnToActivity}
                      >
                        返回工作区
                        <ArrowRight size={16} aria-hidden />
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
                    <h4>退出当前登录</h4>
                    <p>
                      账号、云端作品和当前工作区的照片会保留。本页的未保存文档草稿会清除，请先导出。
                    </p>
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
                    {loggingOut ? '正在退出…' : '退出登录'}
                  </button>
                </div>
                {logoutError && (
                  <div className="account-feedback account-feedback-error" role="alert">
                    <WarningCircle size={18} aria-hidden />
                    <p>{logoutError}</p>
                  </div>
                )}
                <AccountFaq question="退出登录后，还能使用原来的账号吗？">
                  可以。退出只结束当前登录会话，账号、空间和已有云端内容会保留。下次请使用原来的手机号登录，不需要重新注册。
                </AccountFaq>
                <div className="account-deletion">
                  <button
                    type="button"
                    className="account-text-action account-deletion-trigger"
                    aria-expanded={deletionOpen}
                    aria-controls={`${id}-deletion-status`}
                    disabled={loggingOut}
                    onClick={() => setDeletionOpen((value) => !value)}
                  >
                    <Trash size={17} aria-hidden />
                    <span>注销账号</span>
                    <CaretDown size={15} aria-hidden />
                  </button>
                  <MotionDisclosure
                    open={deletionOpen}
                    className="account-deletion-disclosure"
                    id={`${id}-deletion-status`}
                  >
                    <div className="account-deletion-notice" data-testid="account-deletion-status">
                      <h4>暂不支持自助注销</h4>
                      <p>
                        服务暂未开放账号注销。你可以导出当前照片或退出登录；这些操作不会删除账号、云端作品，也不会释放手机号。
                      </p>
                      <p>当前不提供注销后重新注册的流程。</p>
                    </div>
                  </MotionDisclosure>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </Modal>
  );
}
