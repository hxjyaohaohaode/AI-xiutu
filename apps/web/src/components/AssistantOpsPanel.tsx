import { t } from '../i18n';
import { ChoiceSelect } from './ChoiceSelect';
import { SquishSwitch } from './control-motion';
import { useEffect, useRef, useState } from 'react';
import { Plus, ArrowClockwise } from '@phosphor-icons/react';
import { api, jsonRequest, errorMessage, formatDate } from '../lib/api';
import { InlineError, Busy } from './Ui';
import { FeatureSkeleton } from './DeferredFeature';
import { OpsMutationOwner } from './ops-mutation';
import '../ai/live-assistant.css';
type Settings = {
  enabled: boolean;
  label?: string;
  provider: 'openai';
  operations: string[];
  unitCost: number;
  maxSeconds: number;
  maxDelegations: number;
  maxOutputTokens: number;
  contextWindowTokens: number;
  visualTokenReserve: number;
  imageInput: boolean;
  webSearch: boolean;
  webImageSearch?: boolean;
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  voiceReasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
};
type Model = { id: string; config: Settings; hash: string };
type Profile = {
  id: string;
  label: string;
  protocol: string;
  imageInput: boolean;
  fullDuplex: boolean;
  reasoning?: string[];
};
type ResponseProfile = {
  id: string;
  contextWindowTokens: number;
  maxOutputTokens: number;
  reasoning: string[];
};
type Unknown = {
  id: string;
  actor_id: string;
  project_id: string;
  model_id: string;
  error_code: string;
  elapsed_seconds?: number;
  created_at: string;
};
const initial = (): Settings => ({
  enabled: false,
  label: '',
  provider: 'openai',
  operations: ['assistant-turn'],
  unitCost: 1,
  maxSeconds: 180,
  maxDelegations: 6,
  maxOutputTokens: 2048,
  contextWindowTokens: 32768,
  visualTokenReserve: 4096,
  imageInput: false,
  webSearch: false,
});
export function AssistantOpsPanel() {
  const [models, setModels] = useState<Model[]>([]),
    [profiles, setProfiles] = useState<Profile[]>([]),
    [responsesProfiles, setResponsesProfiles] = useState<ResponseProfile[]>([]),
    [ready, setReady] = useState(false),
    [voiceReady, setVoiceReady] = useState(false),
    [catalogLoaded, setCatalogLoaded] = useState(false),
    [selected, setSelected] = useState(''),
    [modelId, setModelId] = useState(''),
    [settings, setSettingsState] = useState<Settings>(initial),
    [hash, setHash] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  const [unknown, setUnknown] = useState<{ turns: Unknown[]; voices: Unknown[] }>({
      turns: [],
      voices: [],
    }),
    [resolution, setResolution] = useState<{ kind: 'turn' | 'voice'; record: Unknown } | null>(
      null,
    ),
    [reason, setReason] = useState(''),
    [evidence, setEvidence] = useState('');
  const voice = settings.operations.includes('realtime-voice');
  const profile = voice
    ? profiles.find((entry) => entry.id === modelId)
    : responsesProfiles.find((entry) => entry.id === modelId);
  const voiceProfile = profiles.find((entry) => entry.id === modelId);
  const responseProfile = responsesProfiles.find((entry) => entry.id === modelId);
  const outputBudgetVisible = !voice || !!voiceProfile?.protocol.toLowerCase().includes('realtime');
  const outputBudgetMax = voice ? 4096 : Math.min(8192, responseProfile?.maxOutputTokens ?? 8192);
  const imageBudgetVisible = !voice && settings.imageInput;
  const [recordKind, setRecordKind] = useState<'turn' | 'voice'>('turn'),
    [recordFilter, setRecordFilter] = useState(''),
    [recordDraft, setRecordDraft] = useState('');
  const [cursor, setCursor] = useState<string | null>(null),
    [nextCursor, setNextCursor] = useState<string | null>(null),
    [previous, setPrevious] = useState<(string | null)[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(true),
    [recordsLoaded, setRecordsLoaded] = useState(false),
    [readError, setReadError] = useState<string | null>(null);
  const loadId = useRef(0);
  const loadController = useRef<AbortController | null>(null);
  const [mutation] = useState(() => new OpsMutationOwner());
  const currentDraft = useRef({ selected, modelId, settings, hash });
  currentDraft.current = { selected, modelId, settings, hash };
  const currentScope = useRef({ recordKind, recordFilter, cursor });
  currentScope.current = { recordKind, recordFilter, cursor };
  useEffect(() => {
    mutation.mount();
    return () => mutation.unmount();
  }, [mutation]);
  function setSettings(next: Settings) {
    if (!mutation.busy) setSettingsState(next);
  }
  async function load() {
    if (!mutation.mounted) return;
    const request = ++loadId.current;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    const isCurrent = () =>
      mutation.mounted &&
      request === loadId.current &&
      !controller.signal.aborted &&
      currentScope.current.recordKind === recordKind &&
      currentScope.current.recordFilter === recordFilter &&
      currentScope.current.cursor === cursor;
    setRecordsLoading(true);
    setRecordsLoaded(false);
    setReadError(null);
    setError(null);
    const query = new URLSearchParams({ kind: recordKind });
    if (recordFilter) query.set('recordId', recordFilter);
    if (cursor) query.set('cursor', cursor);
    try {
      const [catalog, records] = await Promise.all([
        api<{
          models: Model[];
          profiles: Profile[];
          responsesProfiles?: ResponseProfile[];
          ready: boolean;
          voiceReady: boolean;
        }>('/ops/assistant-models', { signal: controller.signal }),
        api<{ turns: Unknown[]; voices: Unknown[]; nextCursor: string | null }>(
          `/ops/assistant-reconciliation?${query}`,
          { signal: controller.signal },
        ),
      ]);
      if (!isCurrent()) return;
      setModels(catalog.models);
      setProfiles(catalog.profiles);
      setResponsesProfiles(catalog.responsesProfiles ?? []);
      setReady(catalog.ready);
      setVoiceReady(catalog.voiceReady);
      setCatalogLoaded(true);
      setUnknown(records);
      setNextCursor(records.nextCursor);
      setRecordsLoaded(true);
      return catalog;
    } catch (err) {
      if (isCurrent()) {
        setReadError(errorMessage(err));
        throw err;
      }
    } finally {
      if (isCurrent()) setRecordsLoading(false);
      if (loadController.current === controller) loadController.current = null;
    }
  }
  useEffect(() => {
    void load().catch(() => {});
    return () => {
      loadId.current++;
      loadController.current?.abort();
    };
  }, [recordKind, recordFilter, cursor]);
  function select(id: string) {
    if (mutation.busy) return;
    setSelected(id);
    setSaved(false);
    const item = models.find((m) => m.id === id);
    setModelId(item?.id ?? '');
    setSettings(item ? structuredClone(item.config) : initial());
    setHash(item?.hash ?? null);
  }
  async function save() {
    if (mutation.busy) return;
    if (!modelId.trim()) {
      setError('请选择或填写模型 ID。');
      return;
    }
    const draft = currentDraft.current;
    await mutation.run(
      { modelId: draft.modelId, settings: draft.settings, hash: draft.hash },
      async (snapshot, current) => {
        await api(
          `/ops/assistant-models/${encodeURIComponent(snapshot.modelId)}`,
          jsonRequest('PUT', { config: snapshot.settings, expectedHash: snapshot.hash }),
        );
        if (!current()) return;
        const catalog = await load();
        if (!current() || !catalog) return;
        const model = catalog.models.find((item) => item.id === snapshot.modelId);
        if (!model) throw new Error(t('配置已提交，但无法确认保存后的模型。请重新读取。'));
        return model;
      },
      {
        current: () => {
          const value = currentDraft.current;
          return (
            value.modelId === draft.modelId &&
            value.selected === draft.selected &&
            value.settings === draft.settings &&
            value.hash === draft.hash
          );
        },
        started() {
          setBusy(true);
          setError(null);
          setSaved(false);
        },
        value(model) {
          setSelected(model.id);
          setModelId(model.id);
          setSettingsState(structuredClone(model.config));
          setHash(model.hash);
          setSaved(true);
        },
        error: (error) => setError(errorMessage(error)),
        settled: () => setBusy(false),
      },
    );
  }
  async function reconcile(choice: 'release' | 'settle') {
    if (!resolution || mutation.busy) return;
    await mutation.run(
      { resolution, choice, reason, evidence },
      async (snapshot, current) => {
        await api(
          `/ops/assistant-reconciliation/${snapshot.resolution.kind}/${snapshot.resolution.record.id}`,
          jsonRequest('POST', {
            resolution: snapshot.choice,
            reason: snapshot.reason,
            evidenceRef: snapshot.evidence,
          }),
        );
        if (!current()) return;
        setResolution(null);
        setReason('');
        setEvidence('');
        await load();
        return true;
      },
      {
        current: () => true,
        started() {
          setBusy(true);
          setError(null);
        },
        value() {},
        error: (error) => setError(errorMessage(error)),
        settled: () => setBusy(false),
      },
    );
  }
  return (
    <section
      className="assistant-ops"
      aria-label={t('实时语音与智能体运营配置')}
      data-catalog-state={catalogLoaded ? 'ready' : recordsLoading ? 'loading' : 'error'}
      data-record-state={recordsLoading ? 'loading' : recordsLoaded ? 'ready' : 'error'}
    >
      <header className="section-heading">
        <div>
          <h2>{t('语音与协作模型')}</h2>
        </div>
        <button
          className="text-button"
          disabled={busy || recordsLoading}
          onClick={() => {
            if (!mutation.busy) void load().catch(() => {});
          }}
        >
          <ArrowClockwise size={17} />
          {readError ? t('重新读取') : t('刷新')}
        </button>
      </header>
      <InlineError message={error ?? readError} />
      {catalogLoaded ? (
        <>
          <div className="ops-readiness" role="status">
            <span data-ready={ready}>
              {t('文字协作')} · {ready ? t('已配置') : t('未就绪')}
            </span>
            <span data-ready={voiceReady}>
              {t('实时语音')} · {voiceReady ? t('已配置') : t('未就绪')}
            </span>
          </div>
          <div className="assistant-ops-layout">
            <div className="assistant-model-list">
              <button className="text-button" disabled={busy} onClick={() => select('')}>
                <Plus size={16} />
                {t('配置模型')}
              </button>
              {models.length === 0 && <p className="control-note">{t('当前没有模型目录项。')}</p>}
              {models.map((model) => (
                <button
                  key={model.id}
                  disabled={busy}
                  aria-pressed={selected === model.id}
                  onClick={() => select(model.id)}
                >
                  <span>
                    {model.config.label || model.id}
                    <small>{model.id}</small>
                  </span>
                  <small>{model.config.enabled ? t('已启用') : t('已停用')}</small>
                </button>
              ))}
            </div>
            <form
              className="assistant-model-form"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <label>
                {t('用途')}
                <ChoiceSelect
                  ariaLabel={t('模型用途')}
                  disabled={!!selected || busy}
                  value={voice ? 'realtime-voice' : 'assistant-turn'}
                  onValueChange={(value) => {
                    setSettings({ ...initial(), operations: [value] });
                    setModelId('');
                    setHash(null);
                  }}
                  options={[
                    {
                      value: 'assistant-turn',
                      label: t('思考与工具协作'),
                    },
                    {
                      value: 'realtime-voice',
                      label: t('实时语音'),
                    },
                  ]}
                />
              </label>
              <label>
                {t('模型 ID')}
                {voice ? (
                  <ChoiceSelect
                    ariaLabel={t('实时语音模型协议')}
                    disabled={!!selected || busy}
                    value={modelId}
                    onValueChange={(value) => {
                      setModelId(value);
                      const next = { ...settings };
                      delete next.voiceReasoningEffort;
                      setSettings(next);
                    }}
                    placeholder={t('选择已适配的协议')}
                    options={[
                      { value: '', label: t('选择已适配的协议'), disabled: true },
                      ...profiles.map((profile) => ({
                        value: profile.id,
                        label: profile.label,
                        description: profile.protocol,
                      })),
                    ]}
                  />
                ) : (
                  <input
                    required
                    list="assistant-responses-models"
                    value={modelId}
                    disabled={!!selected || busy}
                    pattern="[A-Za-z0-9][A-Za-z0-9._:-]{0,127}"
                    placeholder={t('填入此账号可用的官方模型 ID')}
                    onChange={(e) => setModelId(e.target.value)}
                  />
                )}
              </label>
              {!voice && (
                <datalist id="assistant-responses-models">
                  {responsesProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id} />
                  ))}
                </datalist>
              )}
              <label>
                {t('显示名称')}
                <input
                  disabled={busy}
                  value={settings.label ?? ''}
                  maxLength={120}
                  onChange={(e) => setSettings({ ...settings, label: e.target.value })}
                />
              </label>
              <SquishSwitch
                className="ops-switch"
                label={t('启用此模型')}
                disabled={busy}
                checked={settings.enabled}
                onCheckedChange={(enabled) => setSettings({ ...settings, enabled })}
              />
              <label>
                {t('每轮服务点')}
                <input
                  disabled={busy}
                  type="number"
                  min={1}
                  max={100000}
                  step={1}
                  value={settings.unitCost}
                  onChange={(e) => setSettings({ ...settings, unitCost: Number(e.target.value) })}
                />
              </label>
              {voice ? (
                <>
                  <label>
                    {t('最长通话（秒）')}
                    <input
                      disabled={busy}
                      type="number"
                      min={30}
                      max={600}
                      step={10}
                      value={settings.maxSeconds}
                      onChange={(e) =>
                        setSettings({ ...settings, maxSeconds: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label>
                    {t('最多后端协作次数')}
                    <input
                      disabled={busy}
                      type="number"
                      min={1}
                      max={20}
                      step={1}
                      value={settings.maxDelegations}
                      onChange={(e) =>
                        setSettings({ ...settings, maxDelegations: Number(e.target.value) })
                      }
                    />
                  </label>
                </>
              ) : (
                <>
                  <SquishSwitch
                    className="ops-switch"
                    label={t('图像输入')}
                    disabled={busy}
                    checked={settings.imageInput}
                    onCheckedChange={(imageInput) => setSettings({ ...settings, imageInput })}
                  />
                  <SquishSwitch
                    className="ops-switch"
                    label={t('公开网络检索')}
                    disabled={busy}
                    checked={settings.webSearch}
                    onCheckedChange={(webSearch) => setSettings({ ...settings, webSearch })}
                  />
                  <SquishSwitch
                    className="ops-switch"
                    label={t('公开图片检索')}
                    checked={settings.webImageSearch === true}
                    disabled={busy || !settings.webSearch}
                    onCheckedChange={(webImageSearch) =>
                      setSettings({ ...settings, webImageSearch })
                    }
                  />
                  <label>
                    {t('推理参数')}
                    <ChoiceSelect
                      ariaLabel={t('推理参数')}
                      disabled={busy}
                      value={settings.reasoningEffort ?? ''}
                      onValueChange={(value) => {
                        const next = { ...settings };
                        if (value) next.reasoningEffort = value as Settings['reasoningEffort'];
                        else delete next.reasoningEffort;
                        setSettings(next);
                      }}
                      options={[
                        { value: '', label: t('不传此参数') },
                        ...(profile?.reasoning ?? ['none', 'low', 'medium', 'high']).map(
                          (value) => ({
                            value,
                            label: value,
                          }),
                        ),
                      ]}
                    />
                  </label>
                </>
              )}
              {voice && !!profile?.reasoning?.length && (
                <label>
                  {t('实时语音推理档位')}
                  <ChoiceSelect
                    ariaLabel={t('实时语音推理档位')}
                    disabled={busy}
                    value={settings.voiceReasoningEffort ?? ''}
                    onValueChange={(value) => {
                      const next = { ...settings };
                      if (value)
                        next.voiceReasoningEffort = value as Settings['voiceReasoningEffort'];
                      else delete next.voiceReasoningEffort;
                      setSettings(next);
                    }}
                    options={[
                      { value: '', label: t('不传此参数') },
                      ...profile.reasoning.map((value) => ({ value, label: value })),
                    ]}
                  />
                </label>
              )}
              {outputBudgetVisible && (
                <label>
                  {t('每次响应的输出预算')}
                  <input
                    disabled={busy}
                    type="number"
                    min={256}
                    max={outputBudgetMax}
                    step={256}
                    value={settings.maxOutputTokens}
                    onChange={(event) =>
                      setSettings({ ...settings, maxOutputTokens: Number(event.target.value) })
                    }
                  />
                </label>
              )}
              {!voice && (
                <label>
                  {t('应用上下文预算')}
                  <input
                    disabled={busy}
                    type="number"
                    min={8192}
                    max={responseProfile?.contextWindowTokens ?? 2000000}
                    step={1}
                    value={settings.contextWindowTokens ?? 32768}
                    onChange={(event) =>
                      setSettings({ ...settings, contextWindowTokens: Number(event.target.value) })
                    }
                  />
                </label>
              )}
              {imageBudgetVisible && (
                <label>
                  {t('每张图的输入预留')}
                  <input
                    disabled={busy}
                    type="number"
                    min={1024}
                    max={32768}
                    step={1}
                    value={settings.visualTokenReserve ?? 4096}
                    onChange={(event) =>
                      setSettings({ ...settings, visualTokenReserve: Number(event.target.value) })
                    }
                  />
                </label>
              )}
              <button className="button button-primary" disabled={busy || !modelId}>
                {busy ? <Busy /> : saved ? t('已保存配置') : t('保存配置')}
              </button>
            </form>
          </div>
        </>
      ) : recordsLoading ? (
        <FeatureSkeleton profile="panel" label={t('读取模型目录')} compact />
      ) : null}
      <section className="assistant-reconcile">
        <h3>{t('待核验的会话')}</h3>
        <p className="control-note">
          {t('超时不等于未计费。先核对供应商回执和使用量，再选择结算或释放；系统不会自动重发。')}
        </p>
        <form
          className="assistant-record-filters"
          onSubmit={(event) => {
            event.preventDefault();
            if (mutation.busy) return;
            setCursor(null);
            setPrevious([]);
            setRecordFilter(recordDraft.trim());
          }}
        >
          <label>
            {t('会话类型')}
            <ChoiceSelect
              ariaLabel={t('核验会话类型')}
              value={recordKind}
              disabled={busy}
              onValueChange={(value) => {
                setRecordKind(value);
                setCursor(null);
                setPrevious([]);
              }}
              options={[
                { value: 'turn', label: t('文字协作') },
                { value: 'voice', label: t('实时语音') },
              ]}
            />
          </label>
          <label>
            {t('会话编号')}
            <input
              disabled={busy}
              value={recordDraft}
              onChange={(event) => setRecordDraft(event.target.value)}
              placeholder={t('完整会话 UUID，可留空')}
            />
          </label>
          <button disabled={busy || recordsLoading}>{t('查询会话')}</button>
        </form>
        {recordsLoading ? (
          <FeatureSkeleton profile="table" label={t('读取待核验会话')} compact />
        ) : !recordsLoaded ? null : unknown.turns.length + unknown.voices.length === 0 ? (
          <p>{t('当前没有待核验会话。')}</p>
        ) : (
          <div className="ops-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('类型 / 标识')}</th>
                  <th>{t('模型')}</th>
                  <th>{t('状态原因')}</th>
                  <th>{t('发生时间')}</th>
                  <th>{t('处理')}</th>
                </tr>
              </thead>
              <tbody>
                {(['turn', 'voice'] as const).flatMap((kind) =>
                  (kind === 'turn' ? unknown.turns : unknown.voices).map((record) => (
                    <tr key={record.id}>
                      <td data-label={t('类型 / 标识')}>
                        {kind === 'turn' ? t('文字协作') : t('实时语音')}
                        <small>{record.id}</small>
                      </td>
                      <td data-label={t('模型')}>{record.model_id}</td>
                      <td data-label={t('状态原因')}>{record.error_code}</td>
                      <td data-label={t('发生时间')}>{formatDate(record.created_at)}</td>
                      <td data-label={t('处理')}>
                        <button
                          className="text-button"
                          disabled={busy || recordsLoading}
                          onClick={() => {
                            setResolution({ kind, record });
                            setReason('');
                            setEvidence('');
                          }}
                        >
                          {t('核验')}
                        </button>
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        )}
        {recordsLoaded && !recordsLoading && (
          <nav aria-label={t('待核验会话分页')}>
            <button
              disabled={!previous.length || busy || recordsLoading}
              onClick={() => {
                setCursor(previous.at(-1) ?? null);
                setPrevious((value) => value.slice(0, -1));
              }}
            >
              {t('上一页')}
            </button>
            <span>
              {t('第')}
              {previous.length + 1} {t('页')}
            </span>
            <button
              disabled={!nextCursor || busy || recordsLoading}
              onClick={() => {
                setPrevious((value) => [...value, cursor]);
                setCursor(nextCursor);
              }}
            >
              {t('下一页')}
            </button>
          </nav>
        )}
        {resolution && (
          <div className="assistant-resolution">
            <p>
              {t('核验')}
              {resolution.record.id}
            </p>
            <label>
              {t('凭证引用')}
              <input
                disabled={busy}
                value={evidence}
                minLength={3}
                maxLength={200}
                onChange={(e) => setEvidence(e.target.value)}
                placeholder={t('供应商请求 ID 或对账记录编号，不填写密钥')}
              />
            </label>
            <label>
              {t('核验依据')}
              <textarea
                disabled={busy}
                value={reason}
                minLength={10}
                maxLength={1000}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div>
              <button className="text-button" disabled={busy} onClick={() => setResolution(null)}>
                {t('返回')}
              </button>
              <button
                className="button button-secondary"
                disabled={busy || reason.trim().length < 10 || evidence.trim().length < 3}
                onClick={() => void reconcile('release')}
              >
                {t('确认未计费，释放预占')}
              </button>
              <button
                className="button button-primary"
                disabled={busy || reason.trim().length < 10 || evidence.trim().length < 3}
                onClick={() => void reconcile('settle')}
              >
                {t('确认已计费，结算')}
              </button>
            </div>
          </div>
        )}
      </section>
    </section>
  );
}
