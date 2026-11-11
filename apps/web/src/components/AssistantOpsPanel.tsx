import { t } from '../i18n';
import { ChoiceSelect } from './ChoiceSelect';
import { useEffect, useRef, useState } from 'react';
import { Plus, ArrowClockwise } from '@phosphor-icons/react';
import { api, jsonRequest, errorMessage, formatDate } from '../lib/api';
import { InlineError, Busy } from './Ui';
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
    [selected, setSelected] = useState(''),
    [modelId, setModelId] = useState(''),
    [settings, setSettings] = useState<Settings>(initial),
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
  const [recordKind, setRecordKind] = useState<'turn' | 'voice'>('turn'),
    [recordFilter, setRecordFilter] = useState(''),
    [recordDraft, setRecordDraft] = useState('');
  const [cursor, setCursor] = useState<string | null>(null),
    [nextCursor, setNextCursor] = useState<string | null>(null),
    [previous, setPrevious] = useState<(string | null)[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const loadId = useRef(0);
  async function load() {
    const request = ++loadId.current;
    setRecordsLoading(true);
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
        }>('/ops/assistant-models'),
        api<{ turns: Unknown[]; voices: Unknown[]; nextCursor: string | null }>(
          `/ops/assistant-reconciliation?${query}`,
        ),
      ]);
      if (request !== loadId.current) return;
      setModels(catalog.models);
      setProfiles(catalog.profiles);
      setResponsesProfiles(catalog.responsesProfiles ?? []);
      setReady(catalog.ready);
      setVoiceReady(catalog.voiceReady);
      setUnknown(records);
      setNextCursor(records.nextCursor);
    } catch (err) {
      if (request === loadId.current) throw err;
    } finally {
      if (request === loadId.current) setRecordsLoading(false);
    }
  }
  useEffect(() => {
    void load().catch((e) => setError(errorMessage(e)));
    return () => {
      loadId.current++;
    };
  }, [recordKind, recordFilter, cursor]);
  function select(id: string) {
    setSelected(id);
    setSaved(false);
    const item = models.find((m) => m.id === id);
    setModelId(item?.id ?? '');
    setSettings(item ? structuredClone(item.config) : initial());
    setHash(item?.hash ?? null);
  }
  async function save() {
    if (busy) return;
    if (!modelId.trim()) {
      setError('请选择或填写模型 ID。');
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api(
        `/ops/assistant-models/${encodeURIComponent(modelId)}`,
        jsonRequest('PUT', { config: settings, expectedHash: hash }),
      );
      await load();
      const reread = await api<{ models: Model[] }>('/ops/assistant-models');
      const current = reread.models.find((m) => m.id === modelId);
      setHash(current?.hash ?? null);
      setSelected(modelId);
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function reconcile(choice: 'release' | 'settle') {
    if (!resolution || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api(
        `/ops/assistant-reconciliation/${resolution.kind}/${resolution.record.id}`,
        jsonRequest('POST', { resolution: choice, reason, evidenceRef: evidence }),
      );
      setResolution(null);
      setReason('');
      setEvidence('');
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="assistant-ops" aria-label={t('实时语音与智能体运营配置')}>
      <header className="section-heading">
        <div>
          <h2>{t('语音与协作模型')}</h2>
          <p>{t('生成图片仍使用原有模型目录；这里配置实时交流、看图建议和资源检索。')}</p>
        </div>
        <button
          className="text-button"
          onClick={() => void load().catch((e) => setError(errorMessage(e)))}
        >
          <ArrowClockwise size={17} />
          {t('刷新')}
        </button>
      </header>
      <p className="control-note">
        {t('智能体环境：')}
        {ready ? t('已配置') : t('未就绪')} {t('· 实时语音环境：')}
        {voiceReady ? t('已配置') : t('未就绪')}
        {t('。密钥、审核凭证与出口代理只在服务器环境配置。')}
      </p>
      <div className="assistant-ops-layout">
        <div className="assistant-model-list">
          <button className="text-button" onClick={() => select('')}>
            <Plus size={16} />
            {t('配置模型')}
          </button>
          {models.map((model) => (
            <button
              key={model.id}
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
                { value: 'assistant-turn', label: t('思考与工具协作'), description: 'Responses' },
                { value: 'realtime-voice', label: t('实时语音'), description: 'Live / Realtime' },
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
              value={settings.label ?? ''}
              maxLength={120}
              onChange={(e) => setSettings({ ...settings, label: e.target.value })}
            />
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
            />
            {t('启用此模型')}
          </label>
          <label>
            {t('每轮服务点')}
            <input
              type="number"
              min={1}
              max={100000}
              step={1}
              value={settings.unitCost}
              onChange={(e) => setSettings({ ...settings, unitCost: Number(e.target.value) })}
            />
          </label>
          <p className="control-note">
            {t(
              '服务点由你定价。语音按一次有时限会话计点，包含下方范围内的后端协作；供应商的时长与 Token 成本另行核算，1 点不是官方价格。',
            )}
          </p>
          {voice ? (
            <>
              <label>
                {t('最长通话（秒）')}
                <input
                  type="range"
                  min={30}
                  max={600}
                  step={10}
                  value={settings.maxSeconds}
                  onChange={(e) => setSettings({ ...settings, maxSeconds: Number(e.target.value) })}
                />
                <output>
                  {settings.maxSeconds} {t('秒')}
                </output>
              </label>
              <label>
                {t('最多后端协作次数')}
                <input
                  type="range"
                  min={1}
                  max={20}
                  step={1}
                  value={settings.maxDelegations}
                  onChange={(e) =>
                    setSettings({ ...settings, maxDelegations: Number(e.target.value) })
                  }
                />
                <output>
                  {settings.maxDelegations} {t('次')}
                </output>
              </label>
            </>
          ) : (
            <>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={settings.imageInput}
                  onChange={(e) => setSettings({ ...settings, imageInput: e.target.checked })}
                />
                {t('允许显式共享图像（需模型支持）')}
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={settings.webSearch}
                  onChange={(e) => setSettings({ ...settings, webSearch: e.target.checked })}
                />
                {t('允许用户选择公开网络检索（需模型支持）')}
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={settings.webImageSearch === true}
                  disabled={!settings.webSearch}
                  onChange={(e) => setSettings({ ...settings, webImageSearch: e.target.checked })}
                />
                {t('当前模型支持公开图片检索结果')}
              </label>
              <label>
                {t('推理参数')}
                <ChoiceSelect
                  ariaLabel={t('推理参数')}
                  value={settings.reasoningEffort ?? ''}
                  onValueChange={(value) => {
                    const next = { ...settings };
                    if (value) next.reasoningEffort = value as Settings['reasoningEffort'];
                    else delete next.reasoningEffort;
                    setSettings(next);
                  }}
                  options={[
                    { value: '', label: t('不传此参数') },
                    ...(profile?.reasoning ?? ['none', 'low', 'medium', 'high']).map((value) => ({
                      value,
                      label: value,
                    })),
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
                value={settings.voiceReasoningEffort ?? ''}
                onValueChange={(value) => {
                  const next = { ...settings };
                  if (value) next.voiceReasoningEffort = value as Settings['voiceReasoningEffort'];
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
          <label>
            {t('每次响应的输出预算')}
            <input
              type="range"
              min={256}
              max={8192}
              step={256}
              value={settings.maxOutputTokens}
              onChange={(e) =>
                setSettings({ ...settings, maxOutputTokens: Number(e.target.value) })
              }
            />
            <output>
              {settings.maxOutputTokens} tokens
              {voice ? t('（Realtime 最多发送 4096；Live 输出不使用此参数）') : ''}
            </output>
          </label>
          <label>
            {t('应用上下文预算')}
            <input
              type="number"
              min={8192}
              max={2000000}
              step={1}
              value={settings.contextWindowTokens ?? 32768}
              onChange={(event) =>
                setSettings({ ...settings, contextWindowTokens: Number(event.target.value) })
              }
            />
            <small>{t('按实际模型能力设置，包含指令、工具、历史、图片预留与输出。')}</small>
          </label>
          <label>
            {t('每张图的输入预留')}
            <input
              type="number"
              min={1024}
              max={32768}
              step={1}
              value={settings.visualTokenReserve ?? 4096}
              onChange={(event) =>
                setSettings({ ...settings, visualTokenReserve: Number(event.target.value) })
              }
            />
            <small>{t('用于派发前的保守预算；实际 token 消耗以供应商回执为准。')}</small>
          </label>
          <button className="button button-primary" disabled={busy || !modelId}>
            {busy ? <Busy /> : saved ? t('已保存配置') : t('保存配置')}
          </button>
        </form>
      </div>
      <InlineError message={error} />
      <section className="assistant-reconcile">
        <h3>{t('待核验的会话')}</h3>
        <p className="control-note">
          {t('超时不等于未计费。先核对供应商回执和使用量，再选择结算或释放；系统不会自动重发。')}
        </p>
        <form
          className="assistant-record-filters"
          onSubmit={(event) => {
            event.preventDefault();
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
              value={recordDraft}
              onChange={(event) => setRecordDraft(event.target.value)}
              placeholder={t('完整会话 UUID，可留空')}
            />
          </label>
          <button disabled={busy || recordsLoading}>{t('查询会话')}</button>
        </form>
        {unknown.turns.length + unknown.voices.length === 0 ? (
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
                      <td>
                        {kind === 'turn' ? t('文字协作') : t('实时语音')}
                        <small>{record.id}</small>
                      </td>
                      <td>{record.model_id}</td>
                      <td>{record.error_code}</td>
                      <td>{formatDate(record.created_at)}</td>
                      <td>
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
        {resolution && (
          <div className="assistant-resolution">
            <p>
              {t('核验')}
              {resolution.record.id}
            </p>
            <label>
              {t('凭证引用')}
              <input
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
                value={reason}
                minLength={10}
                maxLength={1000}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div>
              <button className="text-button" onClick={() => setResolution(null)}>
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
