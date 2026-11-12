import { getLocale, t } from '../i18n';
import { ChoiceSelect } from './ChoiceSelect';
import { secureUuid } from '../lib/uuid';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import {
  ArrowLeft,
  ChartBar,
  UsersThree,
  GearSix,
  Stack,
  SlidersHorizontal,
  Receipt,
  Plus,
  Copy,
  MagnifyingGlass,
  ArrowClockwise,
  ChatCircleDots,
} from '@phosphor-icons/react';
import { api, ApiError, errorMessage, formatDate, jsonRequest } from '../lib/api';
import { Busy, IconButton, InlineError } from './Ui';
import { StatusMark } from './StatusMark';
import { CheckControl } from './CheckControl';
import { SquishSwitch } from './control-motion';
import { FeatureSkeleton } from './DeferredFeature';
import { OpsReadCoordinator } from './ops-read';
import type { Asset, Project, PublicConfig, User } from '../lib/types';
import { Disclosure, OptionChips, ValueSlider } from './Controls';
import type { ImageCapabilities } from '../ai/types';
import { QuotaManager } from './QuotaManager';
import { UsageDashboard } from '../usage/UsageDashboard';
import { AssistantOpsPanel } from './AssistantOpsPanel';
import { UnknownJobsPanel } from './UnknownJobsPanel';
import { opsModelFields, auditLabels } from './ops-model-fields';
import './ops-surface.css';

type OpsTab =
  | 'overview'
  | 'users'
  | 'config'
  | 'plans'
  | 'models'
  | 'assistant'
  | 'quota'
  | 'audit'
  | 'usage'
  | 'reconciliation';
type ModelConfig = {
  id: string;
  version: number;
  label: string;
  provider: 'qwen' | 'ark' | 'openai';
  operations: ('edit-plan' | 'generate-image' | 'generate-text' | 'transcribe')[];
  enabled: boolean;
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
  maxOutputs: number;
  unitCost: number;
  allowedQualities: string[];
  pointsPerPlan?: number;
  imageUnitCosts?: Record<string, number>;
  runtimeAvailable?: boolean;
  runtimeReason?: string | null;
  parameterCapabilities?: ImageCapabilities;
};
type ProviderCatalogItem = {
  id: string;
  label: string;
  provider: 'openai';
  providerReady: boolean;
  accountVerified: false;
  maxDimension: number;
  parameterCapabilities?: ImageCapabilities;
};
type Plan = {
  id: string;
  name: string;
  units: number;
  priceCents: number;
  expiresAfterDays: number | null;
  active: boolean;
  version?: number;
};
type Config = {
  brand: PublicConfig['brand'];
  registrationMode: 'open' | 'invite';
  quota: { freeUnits: number };
  sharingDefaults?: unknown;
};
type Audit = {
  detail?: { reason?: string };
  id: string;
  action?: string;
  type?: string;
  reason?: string;
  actorId?: string;
  targetType?: string;
  targetId?: string;
  createdAt: string;
  entityId?: string;
  details?: Record<string, unknown>;
};
type Overview = {
  counts: Record<string, number>;
  pointTotals: Record<string, number>;
  capabilities: Record<string, unknown>;
};
type OpsReadResult =
  | { tab: 'overview'; overview: Overview }
  | { tab: 'users'; users: User[] }
  | { tab: 'config'; config: Config; projects: Project[] }
  | { tab: 'plans'; plans: Plan[] }
  | { tab: 'models'; models: ModelConfig[]; catalog: ProviderCatalogItem[] }
  | { tab: 'audit'; entries: Audit[] }
  | { tab: 'independent' };
const tabs: { id: OpsTab; label: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: '运行概览', icon: <ChartBar size={19} /> },
  { id: 'users', label: '用户管理', icon: <UsersThree size={19} /> },
  { id: 'config', label: '站点与注册', icon: <GearSix size={19} /> },
  { id: 'plans', label: '权益套餐', icon: <Stack size={19} /> },
  { id: 'models', label: '模型能力', icon: <SlidersHorizontal size={19} /> },
  { id: 'assistant', label: '语音与协作模型', icon: <ChatCircleDots size={19} /> },
  { id: 'quota', label: '额度调整', icon: <Plus size={19} /> },
  { id: 'usage', label: '用量账本', icon: <ChartBar size={19} /> },
  { id: 'reconciliation', label: '生成任务核验', icon: <Receipt size={19} /> },
  { id: 'audit', label: '操作审计', icon: <Receipt size={19} /> },
];
export function OpsDashboard({
  onBack,
  onConfigChanged,
}: {
  onBack: () => void;
  onConfigChanged: () => void;
}) {
  const [tab, setTab] = useState<OpsTab>('overview');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [readReady, setReadReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [query, setQuery] = useState('');
  const [config, setConfig] = useState<Config | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [providerCatalog, setProviderCatalog] = useState<ProviderCatalogItem[]>([]);
  const [entries, setEntries] = useState<Audit[]>([]);
  const [reason, setReason] = useState('');
  const [invite, setInvite] = useState('');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [spaceId, setSpaceId] = useState('');
  const [units, setUnits] = useState(200);
  const [adjustKey, setAdjustKey] = useState(() => secureUuid());
  const [planDraft, setPlanDraft] = useState<Omit<Plan, 'id'>>({
    name: '',
    units: 1000,
    priceCents: 990,
    expiresAfterDays: null,
    active: false,
  });
  const [modelEdit, setModelEdit] = useState<(ModelConfig & { baseId?: string }) | null>(null);
  const modelFields = modelEdit
    ? opsModelFields(
        modelEdit,
        providerCatalog.find((model) => model.id === modelEdit.id)?.parameterCapabilities,
      )
    : null;
  const [managedProjects, setManagedProjects] = useState<Project[]>([]);
  const [logoProject, setLogoProject] = useState('');
  const [reader] = useState(() => new OpsReadCoordinator());
  const mounted = useRef(false);
  const actionPending = useRef(false);
  const logoUploadOwner = useRef(0);
  const currentTab = useRef(tab);
  const currentQuery = useRef(query);
  currentTab.current = tab;
  currentQuery.current = query;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      reader.cancel();
    };
  }, [reader]);
  const load = useCallback(
    async (search = currentQuery.current, successMessage?: string) => {
      if (!mounted.current || currentTab.current !== tab) return;
      setLoading(true);
      setReadReady(false);
      setError(null);
      await reader.run(
        { tab, query: search },
        async (scope, signal): Promise<OpsReadResult> => {
          if (scope.tab === 'overview')
            return { tab: 'overview', overview: await api<Overview>('/ops/overview', { signal }) };
          if (scope.tab === 'users')
            return {
              tab: 'users',
              users: (
                await api<{ users: User[] }>(
                  `/ops/users?query=${encodeURIComponent(scope.query)}`,
                  { signal },
                )
              ).users,
            };
          if (scope.tab === 'config') {
            const [nextConfig, projects] = await Promise.all([
              api<Config>('/ops/config', { signal }),
              api<{ projects: Project[] }>('/projects', { signal }),
            ]);
            return { tab: 'config', config: nextConfig, projects: projects.projects };
          }
          if (scope.tab === 'plans')
            return {
              tab: 'plans',
              plans: (await api<{ plans: Plan[] }>('/ops/plans', { signal })).plans,
            };
          if (scope.tab === 'models') {
            const result = await api<{
              models: ModelConfig[];
              providerModelCatalog?: ProviderCatalogItem[];
            }>('/ops/models', { signal });
            return {
              tab: 'models',
              models: result.models,
              catalog: result.providerModelCatalog ?? [],
            };
          }
          if (scope.tab === 'audit')
            return {
              tab: 'audit',
              entries: (await api<{ entries: Audit[] }>('/ops/audit', { signal })).entries,
            };
          return { tab: 'independent' };
        },
        {
          current: (scope) => mounted.current && currentTab.current === scope.tab,
          value(result) {
            setReadReady(true);
            if (result.tab === 'overview') setOverview(result.overview);
            else if (result.tab === 'users') setUsers(result.users);
            else if (result.tab === 'plans') setPlans(result.plans);
            else if (result.tab === 'audit') setEntries(result.entries);
            else if (result.tab === 'models') {
              setModels(result.models);
              setProviderCatalog(result.catalog);
            } else if (result.tab === 'config') {
              const managed = result.projects.filter((project) =>
                ['owner', 'admin'].includes(project.role),
              );
              setConfig(result.config);
              setManagedProjects(managed);
              setLogoProject((current) =>
                managed.some((project) => project.id === current)
                  ? current
                  : (managed[0]?.id ?? ''),
              );
            }
            if (successMessage) setSuccess(successMessage);
          },
          error: (failure) => setError(errorMessage(failure)),
          settled: () => setLoading(false),
        },
      );
    },
    [tab, reader],
  );
  useEffect(() => {
    void load();
    setReason('');
    setSuccess('');
    return () => reader.cancel();
  }, [load, reader]);
  async function action(work: () => Promise<unknown>, message: string, reload = true) {
    if (actionPending.current) return;
    actionPending.current = true;
    setBusy(true);
    setError(null);
    setSuccess('');
    try {
      await work();
      if (mounted.current && currentTab.current === tab) {
        setSuccess(message);
        if (reload) await load();
      }
    } catch (e) {
      if (mounted.current && currentTab.current === tab) setError(errorMessage(e));
    } finally {
      actionPending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const reasonField = (
    <label>
      {t('操作原因')}
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={t('写明调整依据，作为审计记录')}
        minLength={3}
        maxLength={500}
        required
      />
    </label>
  );
  const countLabels: Record<string, string> = {
    users: '注册用户',
    spaces: '创作空间',
    projects: '项目',
    assets: '素材',
    artworks: '作品',
    jobs: 'AI任务',
  };
  const counts = Object.entries(overview?.counts ?? {});
  const countScale = Math.max(1, ...counts.map(([, value]) => value));
  function selectTab(next: OpsTab) {
    if (next === tab) return;
    logoUploadOwner.current++;
    reader.cancel();
    setLoading(true);
    setTab(next);
  }
  return (
    <div className="ops-layout">
      <aside className="ops-sidebar" data-motion="ops-navigation">
        <button className="text-button" onClick={onBack}>
          <ArrowLeft size={18} />
          {t('返回创作')}
        </button>
        <nav aria-label={t('运营功能')}>
          {tabs.map((item) => (
            <button
              key={item.id}
              data-ops-nav={item.id}
              aria-current={tab === item.id ? 'page' : undefined}
              className={tab === item.id ? 'selected' : ''}
              onClick={() => selectTab(item.id)}
            >
              {item.icon}
              {t(item.label)}
            </button>
          ))}
        </nav>
        <ChoiceSelect
          className="ops-mobile-nav"
          ariaLabel={t('运营功能')}
          value={tab}
          size="compact"
          options={tabs.map((item) => ({ value: item.id, label: t(item.label) }))}
          onValueChange={selectTab}
        />
      </aside>
      <main
        className="ops-content"
        data-ops-tab={tab}
        data-read-state={loading ? 'loading' : readReady ? 'ready' : 'error'}
        aria-busy={loading}
      >
        <h1 className="sr-only">{t(tabs.find((item) => item.id === tab)?.label ?? '')}</h1>
        <div className="ops-content-actions">
          <IconButton label={t('刷新管理数据')} onClick={() => void load()}>
            <ArrowClockwise size={21} />
          </IconButton>
        </div>
        <InlineError message={error} />
        {success && (
          <div className="success-note" role="status">
            <StatusMark state="done" size="small" label={t(success)} />
          </div>
        )}
        {tab === 'users' && (
          <form
            className="search-form"
            onSubmit={(event) => {
              event.preventDefault();
              setSuccess('');
              void load(query, '已更新搜索结果');
            }}
          >
            <MagnifyingGlass size={19} />
            <input
              aria-label={t('查找用户')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('搜索手机号或昵称')}
            />
            <button className="button button-secondary" disabled={busy}>
              {t('查询')}
            </button>
          </form>
        )}
        {loading ? (
          <FeatureSkeleton
            profile={
              tab === 'overview'
                ? 'operations'
                : tab === 'config'
                  ? 'panel'
                  : tab === 'usage'
                    ? 'usage'
                    : 'table'
            }
            label={t('读取真实数据')}
            compact
          />
        ) : readReady ? (
          <>
            {tab === 'overview' && overview && (
              <>
                <dl
                  className="ops-counts"
                  style={{ '--ops-count-digits': countScale.toLocaleString(getLocale()).length } as CSSProperties}
                >
                  {counts.map(([key, value]) => (
                    <div className="ops-count-row" key={key}>
                      <dt>{t(countLabels[key] ?? key)}</dt>
                      <dd>
                        <meter min={0} max={countScale} value={value} aria-hidden="true" />
                        <strong>{value.toLocaleString(getLocale())}</strong>
                      </dd>
                    </div>
                  ))}
                </dl>
                <section className="surface ops-section">
                  <h2>{t('服务能力')}</h2>
                  <div className="capability-list">
                    {Object.entries(overview.capabilities)
                      .filter(([, value]) => typeof value === 'boolean')
                      .map(([key, value]) => (
                        <div key={key}>
                          <span>
                            {{
                              smsConfigured: t('短信验证码'),
                              providerConfigured: t('模型服务配置'),
                              moderationConfigured: t('内容审核配置'),
                              aiConfigured: t('AI执行'),
                              paymentConfigured: t('在线收款'),
                              imageGenerationConfigured: t('图像生成'),
                            }[key] ?? key}
                          </span>
                          <span className="ops-capability-state" data-enabled={value}>
                            {value ? t('已启用 / 已配置') : t('未启用')}
                          </span>
                        </div>
                      ))}
                  </div>
                </section>
              </>
            )}
            {tab === 'users' && (
              <>
                <div className="surface ops-section">
                  <h2>{t('用户列表')}</h2>
                  <div className="ops-user-list">
                    {users.map((user) => (
                      <div className="ops-user-row" key={user.id}>
                        <div className="comment-avatar">{user.displayName.slice(0, 1)}</div>
                        <div>
                          <strong>{user.displayName}</strong>
                          <small>
                            {user.phoneMasked} · {user.isOperator ? t('运营者') : t('用户')}
                          </small>
                        </div>
                        <span className="soft-tag">
                          {user.status === 'active'
                            ? t('正常')
                            : user.status === 'banned'
                              ? t('已限制')
                              : t('待短信验证')}
                        </span>
                        <button
                          className="text-button"
                          disabled={busy || reason.trim().length < 3}
                          onClick={() =>
                            void action(
                              () =>
                                api(
                                  `/ops/users/${user.id}`,
                                  jsonRequest('PATCH', {
                                    status: user.status === 'banned' ? 'active' : 'banned',
                                    reason,
                                  }),
                                ),
                              t('用户状态已更新'),
                            )
                          }
                        >
                          {user.status === 'banned' ? t('恢复') : t('限制账号')}
                        </button>
                      </div>
                    ))}
                  </div>
                  {!users.length && <p className="quiet-copy">{t('没有符合条件的用户。')}</p>}
                  {reasonField}
                  <p className="fine-print">
                    {t('限制账号会撤销现有会话；请先填写依据。不能限制当前运营账号自身。')}
                  </p>
                </div>
                <form
                  className="surface ops-section stack-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action(
                      () =>
                        api(
                          '/ops/users',
                          jsonRequest('POST', { phone, displayName: name, reason }),
                        ),
                      t('待验证用户已创建'),
                    );
                  }}
                >
                  <h2>{t('创建待验证用户')}</h2>
                  <div className="field-grid">
                    <label>
                      {t('手机号')}
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        required
                      />
                    </label>
                    <label>
                      {t('显示名称')}
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                        maxLength={40}
                      />
                    </label>
                  </div>

                  <button
                    className="button button-secondary"
                    disabled={busy || reason.trim().length < 3}
                  >
                    {t('创建邀请账号')}
                  </button>
                </form>
              </>
            )}
            {tab === 'config' && config && (
              <form
                className="surface ops-section stack-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void action(async () => {
                    await api(
                      '/ops/config',
                      jsonRequest('PATCH', {
                        brand: {
                          name: config.brand.name,
                          tagline: config.brand.tagline,
                          logoAssetId: config.brand.logoAssetId ?? null,
                        },
                        registrationMode: config.registrationMode,
                        quota: { freeUnits: config.quota.freeUnits },
                        reason,
                      }),
                    );
                    onConfigChanged();
                  }, t('配置已保存'));
                }}
              >
                <h2>{t('站点与周期权益')}</h2>
                <div className="field-grid">
                  <label>
                    {t('品牌名称')}
                    <input
                      value={config.brand.name}
                      onChange={(e) =>
                        setConfig({ ...config, brand: { ...config.brand, name: e.target.value } })
                      }
                      required
                      maxLength={24}
                    />
                  </label>
                  <label>
                    {t('注册方式')}
                    <ChoiceSelect
                      ariaLabel={t('注册方式')}
                      value={config.registrationMode}
                      onValueChange={(value) => setConfig({ ...config, registrationMode: value })}
                      options={[
                        { value: 'open', label: t('开放注册') },
                        { value: 'invite', label: t('仅限邀请码') },
                      ]}
                    />
                  </label>
                </div>
                <label>
                  {t('品牌说明')}
                  <input
                    value={config.brand.tagline}
                    onChange={(e) =>
                      setConfig({ ...config, brand: { ...config.brand, tagline: e.target.value } })
                    }
                    maxLength={120}
                  />
                </label>
                <div className="brand-logo-config">
                  <label>
                    {t('品牌图标（将公开显示）')}
                    {config.brand.logoUrl && (
                      <img
                        className="brand-logo-preview"
                        src={config.brand.logoUrl}
                        alt={t('待使用的品牌图标')}
                      />
                    )}
                    <ChoiceSelect
                      ariaLabel={t('品牌图标存放项目')}
                      value={logoProject}
                      onValueChange={setLogoProject}
                      placeholder={t('请先创建一个你管理的项目')}
                      disabled={!managedProjects.length}
                      options={managedProjects.map((project) => ({
                        value: project.id,
                        label: project.title,
                      }))}
                    />
                  </label>
                  <label className="logo-file-label">
                    {t('选择图标图片')}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      disabled={!logoProject || busy}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file || !logoProject) return;
                        const owner = ++logoUploadOwner.current;
                        const projectId = logoProject;
                        void action(
                          async () => {
                            const form = new FormData();
                            form.append('file', file);
                            const result = await api<{ asset: Asset }>(
                              `/projects/${projectId}/assets`,
                              { method: 'POST', body: form },
                            );
                            if (
                              !mounted.current ||
                              currentTab.current !== 'config' ||
                              owner !== logoUploadOwner.current
                            )
                              return;
                            setConfig((current) =>
                              current
                                ? {
                                    ...current,
                                    brand: {
                                      ...current.brand,
                                      logoAssetId: result.asset.id,
                                      logoUrl: result.asset.url,
                                    },
                                  }
                                : current,
                            );
                          },
                          t('图标已上传；点击保存配置后才公开显示。'),
                          false,
                        );
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="text-button"
                    disabled={!config.brand.logoAssetId}
                    onClick={() =>
                      setConfig({
                        ...config,
                        brand: { ...config.brand, logoAssetId: null, logoUrl: null },
                      })
                    }
                  >
                    {t('恢复默认图标')}
                  </button>
                  <p className="fine-print">
                    {t(
                      '图标将在登录页、导航和网站标签中公开。请使用你有权公开的标志，不要选择私人照片。',
                    )}
                  </p>
                </div>
                <label>
                  {t('每月免费服务点')}
                  <input
                    type="number"
                    min="0"
                    max="100000"
                    value={config.quota.freeUnits}
                    onChange={(e) =>
                      setConfig({ ...config, quota: { freeUnits: Number(e.target.value) } })
                    }
                    required
                  />
                </label>

                {reasonField}
                <button
                  className="button button-primary"
                  disabled={busy || reason.trim().length < 3}
                >
                  {busy ? <Busy /> : t('保存配置')}
                </button>
                <div className="sidebar-divider" />
                <h2>{t('注册邀请码')}</h2>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={busy || reason.trim().length < 3}
                  onClick={() =>
                    void action(
                      async () => {
                        const v = await api<{ invitation: { code: string } }>(
                          '/ops/registration-invites',
                          jsonRequest('POST', { maxUses: 1, expiresInDays: 7, reason }),
                        );
                        setInvite(v.invitation.code);
                      },
                      t('已生成一个注册邀请码'),
                      false,
                    )
                  }
                >
                  {t('生成 7 天单次邀请码')}
                </button>
                {invite && (
                  <div className="generated-code">
                    <code>{invite}</code>
                    <IconButton
                      label={t('复制注册邀请码')}
                      onClick={() =>
                        navigator.clipboard
                          ? navigator.clipboard
                              .writeText(invite)
                              .catch(() => setError(t('请手动复制邀请码。')))
                          : setError(t('当前环境不能自动复制，请手动选择邀请码。'))
                      }
                    >
                      <Copy size={18} />
                    </IconButton>
                  </div>
                )}
              </form>
            )}
            {tab === 'plans' && (
              <>
                <section className="surface ops-section">
                  <h2>{t('套餐目录')}</h2>

                  {plans.map((plan) => (
                    <div className="plan-row" key={plan.id}>
                      <div>
                        <strong>{plan.name}</strong>
                        <small>
                          {plan.units} {t('点 ·')}{' '}
                          {plan.expiresAfterDays
                            ? t('{v0} 天有效', { v0: plan.expiresAfterDays })
                            : t('无自动到期')}{' '}
                          · V{plan.version ?? 1}
                        </small>
                      </div>
                      <strong>¥{(plan.priceCents / 100).toFixed(2)}</strong>
                      <span className="soft-tag">
                        {plan.active ? t('可用目录项') : t('未上架')}
                      </span>
                      <button
                        className="text-button"
                        disabled={busy || reason.trim().length < 3}
                        onClick={() =>
                          void action(
                            () =>
                              api(
                                `/ops/plans/${plan.id}`,
                                jsonRequest('PATCH', {
                                  name: plan.name,
                                  units: plan.units,
                                  priceCents: plan.priceCents,
                                  expiresAfterDays: plan.expiresAfterDays,
                                  active: !plan.active,
                                  reason,
                                }),
                              ),
                            t('套餐新版本已保存'),
                          )
                        }
                      >
                        {plan.active ? t('停售') : t('启用目录')}
                      </button>
                    </div>
                  ))}
                  {!plans.length && (
                    <p className="quiet-copy">{t('还没有套餐，以下方表单创建第一项。')}</p>
                  )}
                </section>
                <form
                  className="surface ops-section stack-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action(
                      () => api('/ops/plans', jsonRequest('POST', { ...planDraft, reason })),
                      t('套餐目录已创建'),
                    );
                  }}
                >
                  <h2>{t('创建权益套餐')}</h2>
                  <label>
                    {t('套餐名称')}
                    <input
                      value={planDraft.name}
                      onChange={(e) => setPlanDraft({ ...planDraft, name: e.target.value })}
                      required
                      maxLength={100}
                    />
                  </label>
                  <div className="field-grid">
                    <label>
                      {t('点数')}
                      <input
                        type="number"
                        min="1"
                        value={planDraft.units}
                        onChange={(e) =>
                          setPlanDraft({ ...planDraft, units: Number(e.target.value) })
                        }
                        required
                      />
                    </label>
                    <label>
                      {t('价格（元）')}
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={planDraft.priceCents / 100}
                        onChange={(e) =>
                          setPlanDraft({
                            ...planDraft,
                            priceCents: Math.round(Number(e.target.value) * 100),
                          })
                        }
                        required
                      />
                    </label>
                    <label>
                      {t('有效天数（空为不自动到期）')}
                      <input
                        type="number"
                        min="1"
                        value={planDraft.expiresAfterDays ?? ''}
                        onChange={(e) =>
                          setPlanDraft({
                            ...planDraft,
                            expiresAfterDays: e.target.value ? Number(e.target.value) : null,
                          })
                        }
                      />
                    </label>
                  </div>
                  {reasonField}
                  <button
                    className="button button-primary"
                    disabled={busy || reason.trim().length < 3}
                  >
                    {t('创建未上架套餐')}
                  </button>
                </form>
              </>
            )}
            {tab === 'models' && (
              <>
                <div className="surface ops-section">
                  <div className="section-heading">
                    <h2>{t('模型能力目录')}</h2>
                    <button
                      className="button button-secondary"
                      onClick={() =>
                        setModelEdit({
                          id: '',
                          version: 0,
                          label: '',
                          provider: 'qwen',
                          operations: ['edit-plan'],
                          enabled: false,
                          minWidth: 64,
                          maxWidth: 4096,
                          minHeight: 64,
                          maxHeight: 4096,
                          maxOutputs: 1,
                          unitCost: 1,
                          allowedQualities: ['auto'],
                        })
                      }
                    >
                      <Plus size={17} />
                      {t('添加模型')}
                    </button>
                  </div>

                  {!!providerCatalog.length && (
                    <Disclosure
                      title={t('从已核验的模型档案添加')}
                      summary={providerCatalog.length + t(' 个供应商标识')}
                      role="ops-content"
                    >
                      <label>
                        {t('选择模型档案')}
                        <ChoiceSelect
                          ariaLabel={t('供应商模型档案')}
                          value=""
                          disabled={busy}
                          onValueChange={(value) => {
                            const item = providerCatalog.find((model) => model.id === value);
                            if (!item) return;
                            const existing = models.find((model) => model.id === item.id);
                            setModelEdit(
                              existing
                                ? { ...existing, baseId: existing.id }
                                : {
                                    id: item.id,
                                    version: 0,
                                    label: item.label,
                                    provider: item.provider,
                                    operations: ['generate-image'],
                                    enabled: false,
                                    minWidth: 64,
                                    maxWidth: item.maxDimension,
                                    minHeight: 64,
                                    maxHeight: item.maxDimension,
                                    maxOutputs: 1,
                                    unitCost: 1,
                                    allowedQualities: [
                                      ...(item.parameterCapabilities?.quality.values ?? ['auto']),
                                    ],
                                  },
                            );
                          }}
                          options={[
                            { value: '', label: t('选择后填写服务点和运营范围') },
                            ...providerCatalog.map((item) => ({
                              value: item.id,
                              label: item.label,
                              description: item.providerReady
                                ? t('执行环境已配置')
                                : t('执行环境未配置'),
                            })),
                          ]}
                        />
                      </label>
                    </Disclosure>
                  )}
                  {models.map((model) => (
                    <button
                      className="model-row"
                      data-motion="ops-row"
                      key={model.id}
                      onClick={() => setModelEdit({ ...model, baseId: model.id })}
                    >
                      <SlidersHorizontal size={23} />
                      <div>
                        <strong>{model.label}</strong>
                        <small>{model.id}</small>
                        <small>
                          {model.runtimeAvailable
                            ? t('当前操作可执行')
                            : (model.runtimeReason ?? t('执行环境未开放'))}
                        </small>
                      </div>
                      <span className="soft-tag">
                        {model.enabled ? t('目录已启用') : t('目录停用')}
                      </span>
                      <span>{t('编辑')}</span>
                    </button>
                  ))}
                  {!models.length && <p className="quiet-copy">{t('当前没有模型目录项。')}</p>}
                </div>
                {modelEdit && (
                  <form
                    className="surface ops-section stack-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const {
                        id,
                        label,
                        provider,
                        operations,
                        enabled,
                        minWidth,
                        maxWidth,
                        minHeight,
                        maxHeight,
                        maxOutputs,
                        unitCost,
                        allowedQualities,
                        imageUnitCosts,
                      } = modelEdit;
                      void action(async () => {
                        try {
                          const { model } = await api<{ model: ModelConfig }>(
                            `/ops/models/${encodeURIComponent(id)}`,
                            jsonRequest('PUT', {
                              expectedVersion: modelEdit.baseId === id ? modelEdit.version : 0,
                              label,
                              provider,
                              operations,
                              enabled,
                              minWidth,
                              maxWidth,
                              minHeight,
                              maxHeight,
                              maxOutputs,
                              unitCost,
                              allowedQualities,
                              ...(imageUnitCosts ? { imageUnitCosts } : {}),
                              reason,
                            }),
                          );
                          if (mounted.current && currentTab.current === tab)
                            setModelEdit((current) =>
                              current === modelEdit ? { ...model, baseId: model.id } : current,
                            );
                        } catch (error) {
                          if (error instanceof ApiError && error.code === 'MODEL_CONFIG_CHANGED')
                            await load();
                          throw error;
                        }
                      }, t('模型目录配置已更新'));
                    }}
                  >
                    <h2>{modelEdit.label || t('新模型目录项')}</h2>
                    <label>
                      {t('供应商模型 ID')}
                      <input
                        value={modelEdit.id}
                        onChange={(e) => setModelEdit({ ...modelEdit, id: e.target.value })}
                        pattern="[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}"
                        maxLength={120}
                        required
                      />
                    </label>
                    <label>
                      {t('供应商')}
                      <ChoiceSelect
                        ariaLabel={t('模型供应商')}
                        value={modelEdit.provider ?? 'qwen'}
                        onValueChange={(provider) => {
                          setModelEdit({
                            ...modelEdit,
                            provider,
                            operations: provider !== 'qwen' ? ['generate-image'] : ['edit-plan'],
                            imageUnitCosts: undefined,
                          });
                        }}
                        options={[
                          { value: 'qwen', label: t('阿里云 · Qwen') },
                          { value: 'ark', label: t('火山方舟 · Ark') },
                          { value: 'openai', label: t('OpenAI · 图片模型') },
                        ]}
                      />
                    </label>
                    <fieldset className="model-operations">
                      <legend>{t('用于哪些任务')}</legend>
                      {(modelEdit.provider !== 'qwen'
                        ? [['generate-image', t('图片生成')]]
                        : [
                            ['edit-plan', t('调整建议')],
                            ['generate-text', t('文字生成')],
                            ['transcribe', t('语音识别')],
                          ]
                      ).map(([operation, label]) => (
                        <CheckControl
                          key={operation}
                          label={label}
                          disabled={busy}
                          checked={(modelEdit.operations ?? ['edit-plan']).includes(
                            operation as ModelConfig['operations'][number],
                          )}
                          onChange={(e) => {
                            const nextOperation = operation as ModelConfig['operations'][number];
                            setModelEdit({
                              ...modelEdit,
                              operations: e.target.checked
                                ? [...(modelEdit.operations ?? []), nextOperation]
                                : (modelEdit.operations ?? []).filter(
                                    (value) => value !== nextOperation,
                                  ),
                            });
                          }}
                        />
                      ))}
                    </fieldset>
                    <label>
                      {t('显示名称')}
                      <input
                        value={modelEdit.label}
                        onChange={(e) => setModelEdit({ ...modelEdit, label: e.target.value })}
                        required
                      />
                    </label>
                    <div className="ops-model-fields">
                      {(
                        [
                          ['minWidth', t('最小宽度')],
                          ['maxWidth', t('最大宽度')],
                          ['minHeight', t('最小高度')],
                          ['maxHeight', t('最大高度')],
                          ['maxOutputs', t('最大输出数')],
                          [
                            'unitCost',
                            modelFields?.image ? t('默认每张服务点') : t('每次任务服务点'),
                          ],
                        ] as const
                      )
                        .filter(
                          ([key]) =>
                            key === 'unitCost' ||
                            (key === 'maxOutputs' ? modelFields?.outputs : modelFields?.sizes),
                        )
                        .map(([key, label]) => (
                          <label key={key}>
                            <span>{label}</span>
                            <input
                              type="number"
                              value={modelEdit[key]}
                              min={key === 'unitCost' || key === 'maxOutputs' ? 1 : 64}
                              max={
                                key === 'unitCost'
                                  ? 100000
                                  : key === 'maxOutputs'
                                    ? modelFields?.maxOutputs
                                    : modelFields?.maxDimension
                              }
                              step={1}
                              disabled={busy}
                              required
                              onChange={(event) =>
                                setModelEdit({ ...modelEdit, [key]: Number(event.target.value) })
                              }
                            />
                          </label>
                        ))}
                    </div>
                    {!!modelFields?.qualities.length && (
                      <div className="parameter-row">
                        <div className="parameter-label">{t('允许的质量选项')}</div>
                        <div className="option-chips" role="group" aria-label={t('模型允许质量')}>
                          {modelFields.qualities.map((quality) => (
                            <button
                              type="button"
                              key={quality}
                              aria-pressed={modelEdit.allowedQualities.includes(quality)}
                              disabled={busy}
                              onClick={() =>
                                setModelEdit({
                                  ...modelEdit,
                                  allowedQualities: modelEdit.allowedQualities.includes(quality)
                                    ? modelEdit.allowedQualities.filter(
                                        (value) => value !== quality,
                                      )
                                    : [...modelEdit.allowedQualities, quality],
                                })
                              }
                            >
                              {
                                (
                                  {
                                    auto: t('自动'),
                                    low: t('低'),
                                    medium: t('中'),
                                    high: t('高'),
                                    xhigh: t('超高'),
                                    max: t('最高'),
                                  } as Record<string, string>
                                )[quality]
                              }
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {modelFields?.image && (
                      <Disclosure
                        title={t('按质量设置每张服务点')}
                        summary={t('未设置则使用默认价格')}
                        role="ops-content"
                      >
                        {modelEdit.allowedQualities.map((quality) => (
                          <div className="quality-cost-row" key={quality}>
                            <SquishSwitch
                              className="ops-switch"
                              label={`${quality} ${t('独立价格')}`}
                              checked={modelEdit.imageUnitCosts?.[quality] !== undefined}
                              disabled={busy}
                              onCheckedChange={(checked) => {
                                const next = { ...modelEdit.imageUnitCosts };
                                if (checked) next[quality] = modelEdit.unitCost;
                                else delete next[quality];
                                setModelEdit({ ...modelEdit, imageUnitCosts: next });
                              }}
                            />
                            {modelEdit.imageUnitCosts?.[quality] !== undefined && (
                              <ValueSlider
                                label={quality + t(' 每张服务点')}
                                value={modelEdit.imageUnitCosts[quality]!}
                                min={1}
                                max={100000}
                                disabled={busy}
                                onChange={(value) =>
                                  setModelEdit({
                                    ...modelEdit,
                                    imageUnitCosts: {
                                      ...modelEdit.imageUnitCosts,
                                      [quality]: value,
                                    },
                                  })
                                }
                              />
                            )}
                          </div>
                        ))}
                      </Disclosure>
                    )}
                    <SquishSwitch
                      className="ops-switch"
                      label={t('启用目录项')}
                      checked={modelEdit.enabled}
                      disabled={busy}
                      onCheckedChange={(enabled) => setModelEdit({ ...modelEdit, enabled })}
                    />
                    {reasonField}
                    <button
                      className="button button-primary"
                      disabled={
                        busy ||
                        reason.trim().length < 3 ||
                        !modelEdit.id ||
                        !modelEdit.operations?.length ||
                        !modelEdit.allowedQualities.length
                      }
                    >
                      {t('保存模型范围')}
                    </button>
                  </form>
                )}
              </>
            )}
            {tab === 'quota' && <QuotaManager />}
            {tab === 'assistant' && <AssistantOpsPanel />}
            {tab === 'reconciliation' && <UnknownJobsPanel />}
            {tab === 'usage' && <UsageDashboard operator />}
            {tab === 'audit' && (
              <div className="surface ops-section">
                <h2>{t('最新操作记录')}</h2>

                {entries.length ? (
                  <div className="audit-list">
                    {entries.map((entry) => (
                      <article key={entry.id}>
                        <div>
                          <strong>
                            {t(auditLabels[entry.action ?? entry.type ?? ''] ?? '管理操作')}
                          </strong>
                          <time>{formatDate(entry.createdAt)}</time>
                        </div>
                        <p>
                          {entry.reason ??
                            entry.detail?.reason ??
                            t('此项为系统记录，无人工操作原因')}
                        </p>
                        <details className="ops-audit-detail">
                          <summary>{t('记录')}</summary>
                          <dl>
                            <div>
                              <dt>ID</dt>
                              <dd>{entry.id}</dd>
                            </div>
                            <div>
                              <dt>{t('操作')}</dt>
                              <dd>{entry.action ?? entry.type ?? '—'}</dd>
                            </div>
                            {(entry.targetId || entry.entityId) && (
                              <div>
                                <dt>{t('目标')}</dt>
                                <dd>
                                  {entry.targetType} {entry.targetId ?? entry.entityId}
                                </dd>
                              </div>
                            )}
                          </dl>
                        </details>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="quiet-copy">{t('尚无可显示的操作记录。')}</p>
                )}
              </div>
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}
