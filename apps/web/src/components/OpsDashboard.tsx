import { secureUuid } from '../lib/uuid';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ChartBar,
  UsersThree,
  GearSix,
  Stack,
  SlidersHorizontal,
  Receipt,
  Plus,
  Check,
  Copy,
  MagnifyingGlass,
  ArrowClockwise,
} from '@phosphor-icons/react';
import { api, errorMessage, formatDate, jsonRequest } from '../lib/api';
import { Busy, IconButton, InlineError } from './Ui';
import type { Asset, Project, PublicConfig, User } from '../lib/types';
import { QuotaManager } from './QuotaManager';

type OpsTab = 'overview' | 'users' | 'config' | 'plans' | 'models' | 'quota' | 'audit';
type ModelConfig = {
  id: string;
  label: string;
  provider: 'qwen' | 'ark';
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
  createdAt: string;
  entityId?: string;
  details?: Record<string, unknown>;
};
const tabs: { id: OpsTab; label: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: '运行概览', icon: <ChartBar size={19} /> },
  { id: 'users', label: '用户管理', icon: <UsersThree size={19} /> },
  { id: 'config', label: '站点与注册', icon: <GearSix size={19} /> },
  { id: 'plans', label: '权益套餐', icon: <Stack size={19} /> },
  { id: 'models', label: '模型能力', icon: <SlidersHorizontal size={19} /> },
  { id: 'quota', label: '额度调整', icon: <Plus size={19} /> },
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
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [overview, setOverview] = useState<{
    counts: Record<string, number>;
    pointTotals: Record<string, number>;
    capabilities: Record<string, unknown>;
  } | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [query, setQuery] = useState('');
  const [config, setConfig] = useState<Config | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [models, setModels] = useState<ModelConfig[]>([]);
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
  const [modelEdit, setModelEdit] = useState<ModelConfig | null>(null);
  const [managedProjects, setManagedProjects] = useState<Project[]>([]);
  const [logoProject, setLogoProject] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === 'overview') setOverview(await api('/ops/overview'));
      else if (tab === 'users')
        setUsers(
          (await api<{ users: User[] }>(`/ops/users?query=${encodeURIComponent(query)}`)).users,
        );
      else if (tab === 'config') {
        setConfig(await api('/ops/config'));
        const list = await api<{ projects: Project[] }>('/projects');
        const managed = list.projects.filter((project) =>
          ['owner', 'admin'].includes(project.role),
        );
        setManagedProjects(managed);
        if (!logoProject) setLogoProject(managed[0]?.id ?? '');
      } else if (tab === 'plans') setPlans((await api<{ plans: Plan[] }>('/ops/plans')).plans);
      else if (tab === 'models')
        setModels((await api<{ models: ModelConfig[] }>('/ops/models')).models);
      else if (tab === 'audit') setEntries((await api<{ entries: Audit[] }>('/ops/audit')).entries);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [tab]);
  useEffect(() => {
    void load();
    setReason('');
    setSuccess('');
  }, [load]);
  async function action(work: () => Promise<unknown>, message: string, reload = true) {
    setBusy(true);
    setError(null);
    setSuccess('');
    try {
      await work();
      setSuccess(message);
      if (reload) await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const reasonField = (
    <label>
      操作原因
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="写明调整依据，作为审计记录"
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
  return (
    <div className="ops-layout">
      <aside className="ops-sidebar">
        <button className="text-button" onClick={onBack}>
          <ArrowLeft size={18} />
          返回创作
        </button>
        <div className="ops-title">
          <GearSix size={25} />
          <h1>运营管理</h1>
          <p>真实数据，有据可查。</p>
        </div>
        <nav aria-label="运营功能">
          {tabs.map((item) => (
            <button
              key={item.id}
              className={tab === item.id ? 'selected' : ''}
              onClick={() => setTab(item.id)}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="ops-content">
        <div className="view-heading">
          <div>
            <span className="eyebrow">WORKSPACE OPERATIONS</span>
            <h1>{tabs.find((t) => t.id === tab)?.label}</h1>
            <p>所有管理变更都会保留审计记录。运营权限不自动授予私人素材访问权。</p>
          </div>
          <IconButton label="刷新管理数据" onClick={() => void load()}>
            <ArrowClockwise size={21} />
          </IconButton>
        </div>
        <InlineError message={error} />
        {success && (
          <div className="success-note" role="status">
            <Check size={17} />
            {success}
          </div>
        )}
        {loading ? (
          <Busy label="读取真实数据" />
        ) : (
          <>
            {tab === 'overview' && overview && (
              <>
                <div className="ops-counts">
                  {Object.entries(overview.counts).map(([key, value]) => (
                    <div className="surface metric" key={key}>
                      <span>{countLabels[key] ?? key}</span>
                      <strong>{value.toLocaleString('zh-CN')}</strong>
                    </div>
                  ))}
                </div>
                <section className="surface ops-section">
                  <h2>服务能力</h2>
                  <div className="capability-list">
                    {Object.entries(overview.capabilities)
                      .filter(([, value]) => typeof value === 'boolean')
                      .map(([key, value]) => (
                        <div key={key}>
                          <span>
                            {{
                              smsConfigured: '短信验证码',
                              providerConfigured: '模型服务配置',
                              moderationConfigured: '内容审核配置',
                              aiConfigured: 'AI执行',
                              paymentConfigured: '在线收款',
                              imageGenerationConfigured: '图像生成',
                            }[key] ?? key}
                          </span>
                          <span className={`status-pill ${value ? 'positive' : ''}`}>
                            {value ? '已启用 / 已配置' : '未启用'}
                          </span>
                        </div>
                      ))}
                  </div>
                  <p className="form-hint">
                    已配置外部服务不等于所有场景均已验证，具体执行仍受服务门禁控制。
                  </p>
                </section>
              </>
            )}
            {tab === 'users' && (
              <>
                <form
                  className="search-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action(
                      async () =>
                        setUsers(
                          (
                            await api<{ users: User[] }>(
                              `/ops/users?query=${encodeURIComponent(query)}`,
                            )
                          ).users,
                        ),
                      '已更新搜索结果',
                      false,
                    );
                  }}
                >
                  <MagnifyingGlass size={19} />
                  <input
                    aria-label="查找用户"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="搜索手机号或昵称"
                  />
                  <button className="button button-secondary">查询</button>
                </form>
                <div className="surface ops-section">
                  <h2>用户列表</h2>
                  <div className="ops-user-list">
                    {users.map((user) => (
                      <div className="ops-user-row" key={user.id}>
                        <div className="comment-avatar">{user.displayName.slice(0, 1)}</div>
                        <div>
                          <strong>{user.displayName}</strong>
                          <small>
                            {user.phoneMasked} · {user.isOperator ? '运营者' : '用户'}
                          </small>
                        </div>
                        <span className="soft-tag">
                          {user.status === 'active'
                            ? '正常'
                            : user.status === 'banned'
                              ? '已限制'
                              : '待短信验证'}
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
                              '用户状态已更新',
                            )
                          }
                        >
                          {user.status === 'banned' ? '恢复' : '限制账号'}
                        </button>
                      </div>
                    ))}
                  </div>
                  {!users.length && <p className="quiet-copy">没有符合条件的用户。</p>}
                  {reasonField}
                  <p className="fine-print">
                    限制账号会撤销现有会话；请先填写依据。不能限制当前运营账号自身。
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
                      '待验证用户已创建',
                    );
                  }}
                >
                  <h2>创建待验证用户</h2>
                  <div className="field-grid">
                    <label>
                      手机号
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        required
                      />
                    </label>
                    <label>
                      显示名称
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                        maxLength={40}
                      />
                    </label>
                  </div>
                  <p className="form-hint">不会设置默认密码。用户需要自行通过短信验证完成激活。</p>
                  <button
                    className="button button-secondary"
                    disabled={busy || reason.trim().length < 3}
                  >
                    创建邀请账号
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
                  }, '配置已保存');
                }}
              >
                <h2>站点与周期权益</h2>
                <div className="field-grid">
                  <label>
                    品牌名称
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
                    注册方式
                    <select
                      value={config.registrationMode}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          registrationMode: e.target.value as 'open' | 'invite',
                        })
                      }
                    >
                      <option value="open">开放注册</option>
                      <option value="invite">仅限邀请码</option>
                    </select>
                  </label>
                </div>
                <label>
                  品牌说明
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
                    品牌图标（将公开显示）
                    {config.brand.logoUrl && (
                      <img
                        className="brand-logo-preview"
                        src={config.brand.logoUrl}
                        alt="待使用的品牌图标"
                      />
                    )}
                    <select
                      aria-label="品牌图标存放项目"
                      value={logoProject}
                      onChange={(e) => setLogoProject(e.target.value)}
                    >
                      {!managedProjects.length && (
                        <option value="">请先创建一个你管理的项目</option>
                      )}
                      {managedProjects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="logo-file-label">
                    选择图标图片
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      disabled={!logoProject || busy}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file || !logoProject) return;
                        void action(
                          async () => {
                            const form = new FormData();
                            form.append('file', file);
                            const result = await api<{ asset: Asset }>(
                              `/projects/${logoProject}/assets`,
                              { method: 'POST', body: form },
                            );
                            setConfig({
                              ...config,
                              brand: {
                                ...config.brand,
                                logoAssetId: result.asset.id,
                                logoUrl: result.asset.url,
                              },
                            });
                          },
                          '图标已上传；点击保存配置后才公开显示。',
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
                    恢复默认图标
                  </button>
                  <p className="fine-print">
                    图标将在登录页、导航和网站标签中公开。请使用你有权公开的标志，不要选择私人照片。
                  </p>
                </div>
                <label>
                  每月免费服务点
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
                <p className="form-hint">
                  更新政策不会在同一月份重复发放免费点。原有消费和已授予批次保留。
                </p>
                {reasonField}
                <button
                  className="button button-primary"
                  disabled={busy || reason.trim().length < 3}
                >
                  {busy ? <Busy /> : '保存配置'}
                </button>
                <div className="sidebar-divider" />
                <h2>注册邀请码</h2>
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
                      '已生成一个注册邀请码',
                      false,
                    )
                  }
                >
                  生成 7 天单次邀请码
                </button>
                {invite && (
                  <div className="generated-code">
                    <code>{invite}</code>
                    <IconButton
                      label="复制注册邀请码"
                      onClick={() =>
                        navigator.clipboard
                          .writeText(invite)
                          .catch(() => setError('请手动复制邀请码。'))
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
                  <h2>套餐目录</h2>
                  <p className="form-hint">
                    这是可配置权益目录。在线收款未启用时，不会创建虚假支付订单。
                  </p>
                  {plans.map((plan) => (
                    <div className="plan-row" key={plan.id}>
                      <div>
                        <strong>{plan.name}</strong>
                        <small>
                          {plan.units} 点 ·{' '}
                          {plan.expiresAfterDays ? `${plan.expiresAfterDays} 天有效` : '无自动到期'}{' '}
                          · V{plan.version ?? 1}
                        </small>
                      </div>
                      <strong>¥{(plan.priceCents / 100).toFixed(2)}</strong>
                      <span className="soft-tag">{plan.active ? '可用目录项' : '未上架'}</span>
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
                            '套餐新版本已保存',
                          )
                        }
                      >
                        {plan.active ? '停售' : '启用目录'}
                      </button>
                    </div>
                  ))}
                  {!plans.length && (
                    <p className="quiet-copy">还没有套餐，以下方表单创建第一项。</p>
                  )}
                </section>
                <form
                  className="surface ops-section stack-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action(
                      () => api('/ops/plans', jsonRequest('POST', { ...planDraft, reason })),
                      '套餐目录已创建',
                    );
                  }}
                >
                  <h2>创建权益套餐</h2>
                  <label>
                    套餐名称
                    <input
                      value={planDraft.name}
                      onChange={(e) => setPlanDraft({ ...planDraft, name: e.target.value })}
                      required
                      maxLength={100}
                    />
                  </label>
                  <div className="field-grid">
                    <label>
                      点数
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
                      价格（元）
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
                      有效天数（空为不自动到期）
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
                    创建未上架套餐
                  </button>
                </form>
              </>
            )}
            {tab === 'models' && (
              <>
                <div className="surface ops-section">
                  <div className="section-heading">
                    <h2>模型能力目录</h2>
                    <button
                      className="button button-secondary"
                      onClick={() =>
                        setModelEdit({
                          id: '',
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
                      添加模型
                    </button>
                  </div>
                  <p className="form-hint">
                    调整模型范围不会越过全局执行门禁。服务密钥不在网页中展示或保存。
                  </p>
                  {models.map((model) => (
                    <button
                      className="model-row"
                      key={model.id}
                      onClick={() => setModelEdit({ ...model })}
                    >
                      <SlidersHorizontal size={23} />
                      <div>
                        <strong>{model.label}</strong>
                        <small>{model.id}</small>
                      </div>
                      <span className="soft-tag">{model.enabled ? '目录已启用' : '目录停用'}</span>
                      <span>编辑</span>
                    </button>
                  ))}
                  {!models.length && <p className="quiet-copy">当前没有模型目录项。</p>}
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
                      } = modelEdit;
                      void action(
                        () =>
                          api(
                            `/ops/models/${encodeURIComponent(id)}`,
                            jsonRequest('PUT', {
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
                              reason,
                            }),
                          ),
                        '模型目录配置已更新',
                      );
                    }}
                  >
                    <h2>{modelEdit.label || '新模型目录项'}</h2>
                    <label>
                      供应商模型 ID
                      <input
                        value={modelEdit.id}
                        onChange={(e) => setModelEdit({ ...modelEdit, id: e.target.value })}
                        pattern="[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}"
                        maxLength={120}
                        required
                      />
                      <small>填写供应商控制台中的准确模型标识；修改为新标识会创建另一项。</small>
                    </label>
                    <label>
                      供应商
                      <select
                        value={modelEdit.provider ?? 'qwen'}
                        onChange={(e) => {
                          const provider = e.target.value as 'qwen' | 'ark';
                          setModelEdit({
                            ...modelEdit,
                            provider,
                            operations: provider === 'ark' ? ['generate-image'] : ['edit-plan'],
                          });
                        }}
                      >
                        <option value="qwen">阿里云 · Qwen</option>
                        <option value="ark">火山方舟 · Ark</option>
                      </select>
                    </label>
                    <fieldset className="model-operations">
                      <legend>用于哪些任务</legend>
                      {(modelEdit.provider === 'ark'
                        ? [['generate-image', '图片生成']]
                        : [
                            ['edit-plan', '调整建议'],
                            ['generate-text', '文字生成'],
                            ['transcribe', '语音识别'],
                          ]
                      ).map(([operation, label]) => (
                        <label key={operation}>
                          <input
                            type="checkbox"
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
                          {label}
                        </label>
                      ))}
                    </fieldset>
                    <label>
                      显示名称
                      <input
                        value={modelEdit.label}
                        onChange={(e) => setModelEdit({ ...modelEdit, label: e.target.value })}
                        required
                      />
                    </label>
                    <div className="field-grid">
                      {(
                        [
                          ['minWidth', '最小宽度'],
                          ['maxWidth', '最大宽度'],
                          ['minHeight', '最小高度'],
                          ['maxHeight', '最大高度'],
                          ['maxOutputs', '最大输出数'],
                          ['unitCost', '每次任务服务点'],
                        ] as const
                      ).map(([key, label]) => (
                        <label key={key}>
                          {label}
                          <input
                            type="number"
                            min={key === 'unitCost' || key === 'maxOutputs' ? 1 : 64}
                            max={key === 'unitCost' ? 100000 : key === 'maxOutputs' ? 4 : 4096}
                            step="1"
                            value={modelEdit[key]}
                            onChange={(e) =>
                              setModelEdit({ ...modelEdit, [key]: Number(e.target.value) })
                            }
                            required
                          />
                        </label>
                      ))}
                    </div>
                    <label>
                      质量选项（逗号分隔）
                      <input
                        value={modelEdit.allowedQualities.join(', ')}
                        onChange={(e) =>
                          setModelEdit({
                            ...modelEdit,
                            allowedQualities: e.target.value
                              .split(',')
                              .map((s) => s.trim())
                              .filter(Boolean),
                          })
                        }
                      />
                    </label>
                    <label className="switch-row">
                      <span>启用目录项</span>
                      <input
                        type="checkbox"
                        checked={modelEdit.enabled}
                        onChange={(e) => setModelEdit({ ...modelEdit, enabled: e.target.checked })}
                      />
                    </label>
                    {reasonField}
                    <button
                      className="button button-primary"
                      disabled={
                        busy ||
                        reason.trim().length < 3 ||
                        !modelEdit.id ||
                        !modelEdit.operations?.length
                      }
                    >
                      保存模型范围
                    </button>
                  </form>
                )}
              </>
            )}
            {tab === 'quota' && <QuotaManager />}
            {tab === 'audit' && (
              <div className="surface ops-section">
                <h2>最新操作记录</h2>
                <p className="form-hint">这里只显示管理元数据，不包含私人照片、配方或项目讨论。</p>
                {entries.length ? (
                  <div className="audit-list">
                    {entries.map((entry) => (
                      <article key={entry.id}>
                        <div>
                          <strong>{entry.action ?? entry.type ?? '管理操作'}</strong>
                          <time>{formatDate(entry.createdAt)}</time>
                        </div>
                        <p>
                          {entry.reason ?? entry.detail?.reason ?? '此项为系统记录，无人工操作原因'}
                        </p>
                        <small>记录 {entry.id}</small>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="quiet-copy">尚无可显示的操作记录。</p>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
