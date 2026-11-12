import { t, useLocale, formatNumber } from '../i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowClockwise,
  DownloadSimple,
  Wallet,
  HourglassMedium,
  CalendarBlank,
} from '@phosphor-icons/react';
import { api, downloadBlob, errorMessage } from '../lib/api';
import type { Space } from '../lib/types';
import { Busy, InlineError } from '../components/Ui';
import { ChoiceSelect, type ChoiceOption } from '../components/ChoiceSelect';
import { MotionDetails } from '../motion/Presence';
import {
  appendUsagePage,
  assertUsageScope,
  pointText,
  shanghaiDate,
  usageDateError,
  usageEndpoint,
  usageKindDescriptions,
  usageKinds,
  usageLabels,
  usageUuid,
  type UsageFilter,
  type UsageKind,
  type UsageReport,
} from './model';
import { usageQuotes, type UsageAssistantCatalog, type UsageModelCatalog } from './catalog';
import { collectUsageCsv } from './export';
import { useUsageResource } from './useUsageResource';
import { UsageCapacity } from './UsageCapacity';
import { UsageInsights } from './UsageInsights';
import { UsageLedger, type UsageMember } from './UsageLedger';
import { UsagePricing } from './UsagePricing';
import { UsageJob } from './UsageJob';
import { UsageRiver } from './UsageRiver';
import { UsageSkeleton } from './UsageSkeleton';
import { UsageNumber } from './UsageNumber';
import { usageJobReference, type UsageJobTarget } from './providerBilling';
import './usage.css';
import './usage-refinement.css';

type Props = {
  space?: Space | null;
  spaces?: readonly Space[];
  currentUserId?: string | null;
  operator?: boolean;
  refreshToken?: number;
};
type ReportState = {
  key: string;
  report: UsageReport | null;
  loading: boolean;
  more: boolean;
  error: string | null;
  pageError: string | null;
};
type Request = { key: string; controller: AbortController };

export function UsageDashboard(props: Props) {
  const identity = JSON.stringify([
    props.currentUserId ?? '',
    !!props.operator,
    props.space?.id ?? '',
    props.space?.role ?? '',
  ]);
  return <UsageWorkspace {...props} identity={identity} key={identity} />;
}

function UsageWorkspace({
  space,
  spaces = [],
  currentUserId,
  operator = false,
  refreshToken = 0,
  identity,
}: Props & { identity: string }) {
  useLocale();
  const [scope, setScope] = useState<'personal' | 'space'>(
    space?.kind === 'team' ? 'space' : 'personal',
  );
  const [from, setFrom] = useState(() => shanghaiDate(new Date(Date.now() - 29 * 86_400_000)));
  const [to, setTo] = useState(() => shanghaiDate(new Date()));
  const [bucket, setBucket] = useState<'day' | 'month'>('day');
  const [member, setMember] = useState('');
  const [memberDraft, setMemberDraft] = useState('');
  const [historicalMember, setHistoricalMember] = useState('');
  const [memberError, setMemberError] = useState<string | null>(null);
  const [spaceDraft, setSpaceDraft] = useState('');
  const [actorDraft, setActorDraft] = useState('');
  const [operatorFilter, setOperatorFilter] = useState({ spaceId: '', actorId: '' });
  const [operatorError, setOperatorError] = useState<string | null>(null);
  const [kind, setKind] = useState<UsageKind>('consumed');
  const [jobDetail, setJobDetail] = useState<{ key: string; target: UsageJobTarget } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [catalogRefresh, setCatalogRefresh] = useState(0);
  const [snapshot, setSnapshot] = useState<ReportState | null>(null);
  const [exportState, setExportState] = useState<{
    key: string;
    busy: boolean;
    error: string | null;
    message: string | null;
  } | null>(null);
  const moreRequest = useRef<Request | null>(null);
  const exportRequest = useRef<Request | null>(null);
  const seenCursors = useRef(new Set<string>());
  const revision = `${refreshToken}:${refresh}`;
  const personalSpace =
    space?.kind === 'personal' ? space : spaces.find((item) => item.kind === 'personal');
  const memberScope = !operator && scope === 'space' && space?.kind === 'team';
  const canSelectMember = !!memberScope && ['owner', 'admin'].includes(space!.role);
  const memberId = memberScope ? (member === 'custom' ? historicalMember : member) : '';
  const knownSpaces = useMemo(
    () => (space && !spaces.some((item) => item.id === space.id) ? [...spaces, space] : spaces),
    [space, spaces],
  );
  const members = useUsageResource<{ members: UsageMember[] }>(
    memberScope ? `/spaces/${encodeURIComponent(space!.id)}/members` : null,
    identity,
    revision,
  );
  const legacy = useUsageResource<UsageModelCatalog>(
    '/models',
    identity,
    `${revision}:${catalogRefresh}`,
  );
  const assistant = useUsageResource<UsageAssistantCatalog>(
    '/assistant/models',
    identity,
    `${revision}:${catalogRefresh}`,
  );
  const quotes = useMemo(
    () => usageQuotes(legacy.data, assistant.data),
    [legacy.data, assistant.data],
  );
  const query = useMemo<UsageFilter>(
    () => ({
      scope: operator ? 'operator' : scope,
      spaceId: operator
        ? operatorFilter.spaceId || undefined
        : scope === 'space'
          ? space?.id
          : personalSpace?.id,
      actorId: operator ? operatorFilter.actorId || undefined : undefined,
      memberId: memberId || undefined,
      from,
      to,
      bucket,
    }),
    [operator, scope, operatorFilter, space?.id, personalSpace?.id, memberId, from, to, bucket],
  );
  const dateError = usageDateError(from, to);
  const awaitingMember = memberScope && member === 'custom' && !historicalMember;
  const endpoint = !dateError && !awaitingMember ? usageEndpoint(query) : null;
  const requestKey = JSON.stringify([identity, endpoint, revision]);
  const activeKey = useRef(requestKey);
  activeKey.current = requestKey;
  const state: ReportState =
    snapshot?.key === requestKey
      ? snapshot
      : {
          key: requestKey,
          report: null,
          loading: !!endpoint,
          more: false,
          error: null,
          pageError: null,
        };
  const report = state.report;
  const exporting = exportState?.key === requestKey && exportState.busy;
  const exportError = exportState?.key === requestKey ? exportState.error : null;
  const exportMessage = exportState?.key === requestKey ? exportState.message : null;

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    seenCursors.current = new Set();
    moreRequest.current?.controller.abort();
    moreRequest.current = null;
    exportRequest.current?.controller.abort();
    exportRequest.current = null;
    setExportState(null);
    setJobDetail(null);
    setSnapshot({
      key: requestKey,
      report: null,
      loading: !!endpoint,
      more: false,
      error: null,
      pageError: null,
    });
    if (endpoint)
      api<UsageReport>(endpoint, { signal: controller.signal })
        .then((value) => {
          if (!current || activeKey.current !== requestKey) return;
          assertUsageScope(value, query);
          if (value.nextCursor) seenCursors.current.add(value.nextCursor);
          setSnapshot({
            key: requestKey,
            report: value,
            loading: false,
            more: false,
            error: null,
            pageError: null,
          });
        })
        .catch((error: unknown) => {
          if (current && activeKey.current === requestKey && !controller.signal.aborted)
            setSnapshot({
              key: requestKey,
              report: null,
              loading: false,
              more: false,
              error: errorMessage(error),
              pageError: null,
            });
        });
    return () => {
      current = false;
      controller.abort();
      if (moreRequest.current?.key === requestKey) moreRequest.current.controller.abort();
      if (exportRequest.current?.key === requestKey) exportRequest.current.controller.abort();
    };
  }, [endpoint, requestKey, query]);

  async function loadMore() {
    if (!report?.nextCursor || moreRequest.current?.key === requestKey) return;
    const cursor = report.nextCursor;
    const request = { key: requestKey, controller: new AbortController() };
    moreRequest.current?.controller.abort();
    moreRequest.current = request;
    setSnapshot((old) => (old?.key === requestKey ? { ...old, more: true, pageError: null } : old));
    try {
      const result = await api<UsageReport>(usageEndpoint(query, cursor), {
        signal: request.controller.signal,
      });
      if (request.controller.signal.aborted || activeKey.current !== requestKey) return;
      if (result.nextCursor && seenCursors.current.has(result.nextCursor))
        throw new Error('账本分页重复，请刷新后重试。');
      const combined = appendUsagePage(report, result, cursor, query);
      if (result.nextCursor) seenCursors.current.add(result.nextCursor);
      setSnapshot((old) =>
        old?.key === requestKey ? { ...old, report: combined, pageError: null } : old,
      );
    } catch (error) {
      if (!request.controller.signal.aborted && activeKey.current === requestKey)
        setSnapshot((old) =>
          old?.key === requestKey ? { ...old, pageError: errorMessage(error) } : old,
        );
    } finally {
      if (moreRequest.current === request) moreRequest.current = null;
      if (activeKey.current === requestKey)
        setSnapshot((old) => (old?.key === requestKey ? { ...old, more: false } : old));
    }
  }
  async function exportCsv() {
    if (!endpoint || !report || exportRequest.current?.key === requestKey) return;
    const request = { key: requestKey, controller: new AbortController() };
    exportRequest.current?.controller.abort();
    exportRequest.current = request;
    setExportState({ key: requestKey, busy: true, error: null, message: null });
    try {
      const blob = await collectUsageCsv(query, fetch, request.controller.signal);
      if (
        request.controller.signal.aborted ||
        activeKey.current !== requestKey ||
        exportRequest.current !== request
      )
        return;
      const subject = query.memberId || query.actorId;
      downloadBlob(
        blob,
        `usage-${query.scope}${query.spaceId ? `-${query.spaceId.slice(0, 8)}` : ''}${subject ? `-member-${subject.slice(0, 8)}` : ''}-${from}-${to}.csv`,
      );
      setExportState({
        key: requestKey,
        busy: false,
        error: null,
        message: 'CSV 已生成，包含所选范围的全部明细。',
      });
    } catch (error) {
      if (!request.controller.signal.aborted && activeKey.current === requestKey)
        setExportState({ key: requestKey, busy: false, error: errorMessage(error), message: null });
    } finally {
      if (exportRequest.current === request) exportRequest.current = null;
    }
  }
  function cancelExport() {
    exportRequest.current?.controller.abort();
    exportRequest.current = null;
    setExportState({ key: requestKey, busy: false, error: null, message: '已取消导出。' });
  }
  function selectPeriod(days: number | 'month') {
    const today = shanghaiDate(new Date());
    setTo(today);
    setFrom(
      days === 'month'
        ? `${today.slice(0, 7)}-01`
        : shanghaiDate(new Date(Date.now() - (days - 1) * 86_400_000)),
    );
  }
  const today = shanghaiDate(new Date());
  const isPeriodSelected = (days: number | 'month') =>
    to === today &&
    from ===
      (days === 'month'
        ? `${today.slice(0, 7)}-01`
        : shanghaiDate(new Date(Date.now() - (days - 1) * 86_400_000)));
  const selectedSpaceId = operator
    ? operatorFilter.spaceId || undefined
    : scope === 'space'
      ? space?.id
      : personalSpace?.id;
  const selectedSpaceName = knownSpaces.find((item) => item.id === selectedSpaceId)?.name;
  const walletName = operator
    ? selectedSpaceId
      ? selectedSpaceName || t('所选空间钱包')
      : t('全部空间钱包')
    : scope === 'personal'
      ? t('个人钱包')
      : t('{name}的钱包', { name: space?.name ?? t('空间') });
  const filteredMemberName = report?.filterActorId
    ? members.data?.members.find((item) => item.userId === report.filterActorId)?.displayName ||
      (report.filterActorId === currentUserId
        ? t('我')
        : t('成员 {id}', { id: report.filterActorId.slice(0, 8) }))
    : null;
  const memberOptions: ChoiceOption[] = [
    { value: '', label: t('全部成员') },
    ...(currentUserId ? [{ value: currentUserId, label: t('仅我') }] : []),
    ...(canSelectMember
      ? (members.data?.members ?? [])
          .filter((item) => item.userId !== currentUserId)
          .map((item) => ({
            value: item.userId,
            label: item.displayName,
            description: t('成员 {id}', { id: item.userId.slice(0, 8) }),
          }))
      : []),
  ];
  if (
    canSelectMember &&
    member &&
    member !== 'custom' &&
    !memberOptions.some((item) => item.value === member)
  )
    memberOptions.push({
      value: member,
      label: t('成员 {id}', { id: member.slice(0, 8) }),
      description: t('当前名单中未载入此成员'),
    });
  if (canSelectMember)
    memberOptions.push({
      value: 'custom',
      label: t('按成员 ID…'),
      description: t('也可查询已离开成员的历史记录'),
    });
  return (
    <section className="usage-dashboard" aria-label={t('用量与额度历史')}>
      <header className="view-heading usage-heading" data-motion="usage-heading">
        <h1 className="sr-only">{t('用量与额度')}</h1>
        <div className="view-actions usage-actions">
          <button
            type="button"
            className="text-button"
            onClick={() => setRefresh((value) => value + 1)}
            disabled={state.loading}
          >
            <ArrowClockwise size={17} aria-hidden /> {t('刷新')}
          </button>
          {exporting ? (
            <button type="button" className="button button-secondary" onClick={cancelExport}>
              <Busy label={t('导出中')} />
              <span>{t('取消')}</span>
            </button>
          ) : (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => void exportCsv()}
              disabled={!report || !!dateError}
            >
              <DownloadSimple size={17} aria-hidden /> {t('导出CSV')}
            </button>
          )}
        </div>
      </header>
      <div className="usage-card usage-filter-card" data-motion="usage-filters">
        <div className="usage-filters">
          {!operator && (
            <ChoiceSelect<'personal' | 'space'>
              className="usage-scope-field"
              label={t('范围')}
              value={scope}
              onValueChange={(value) => {
                setScope(value);
                setMember('');
                setMemberError(null);
              }}
              options={[
                { value: 'personal', label: t('我的个人用量') },
                ...(space
                  ? [{ value: 'space' as const, label: t('{v0} · 空间用量', { v0: space.name }) }]
                  : []),
              ]}
            />
          )}
          {memberScope && (
            <ChoiceSelect
              className="usage-member-field"
              label={t('成员')}
              value={member}
              onValueChange={(value) => {
                setMember(value);
                setMemberError(null);
              }}
              options={memberOptions}
            />
          )}
          <label>
            {t('开始日期')}
            <input
              type="date"
              value={from}
              max={to}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label>
            {t('结束日期')}
            <input
              type="date"
              value={to}
              min={from}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
          <div className="usage-presets" role="group" aria-label={t('快捷日期')}>
            <CalendarBlank size={15} aria-hidden />
            {[
              [7, t('7 天')],
              [30, t('30 天')],
              ['month', t('本月')],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={isPeriodSelected(value as number | 'month')}
                onClick={() => selectPeriod(value as number | 'month')}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {canSelectMember && member === 'custom' && (
          <form
            className="usage-id-filter"
            onSubmit={(event) => {
              event.preventDefault();
              const value = memberDraft.trim();
              if (!usageUuid(value)) {
                setMemberError('请输入完整有效的成员 UUID。');
                return;
              }
              setHistoricalMember(value);
              setMemberError(null);
            }}
          >
            <label>
              {t('成员 ID')}
              <input
                value={memberDraft}
                maxLength={36}
                placeholder={t('包括已离开成员的历史记录')}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setMemberDraft(event.target.value)}
              />
            </label>
            <button type="submit" className="button button-secondary">
              {t('应用成员')}
            </button>
            {awaitingMember && !memberError && (
              <span className="usage-filter-hint">{t('输入成员 ID 后应用。')}</span>
            )}
          </form>
        )}
        {operator && (
          <form
            className="usage-id-filter usage-operator-filter"
            onSubmit={(event) => {
              event.preventDefault();
              const spaceId = spaceDraft.trim(),
                actorId = actorDraft.trim();
              if ((spaceId && !usageUuid(spaceId)) || (actorId && !usageUuid(actorId))) {
                setOperatorError('空间与成员 ID 需要是完整的 UUID；留空表示全部。');
                return;
              }
              setOperatorFilter({ spaceId, actorId });
              setOperatorError(null);
            }}
          >
            <label>
              {t('空间ID')}
              <input
                value={spaceDraft}
                maxLength={36}
                onChange={(event) => setSpaceDraft(event.target.value)}
                placeholder={t('全部空间')}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label>
              {t('成员ID')}
              <input
                value={actorDraft}
                maxLength={36}
                onChange={(event) => setActorDraft(event.target.value)}
                placeholder={t('全部成员')}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <button type="submit" className="button button-secondary">
              {t('筛选')}
            </button>
          </form>
        )}
        {members.error && (
          <p className="usage-filter-hint" role="status">
            {t('成员名单暂未读取：')}
            {t(members.error)} {t('仍可查看全部或本人记录。')}
          </p>
        )}
        <InlineError message={t(memberError || operatorError || dateError || '')} />
        <p className="usage-filter-timezone" title={t('日期按北京时间计算，结束日期包含当天。')}>{t('北京时间')}</p>
      </div>
      <InlineError message={t(state.error || exportError || '')} />
      {state.error && (
        <button
          type="button"
          className="button button-secondary usage-retry"
          onClick={() => setRefresh((value) => value + 1)}
        >
          {t('重新读取账本')}
        </button>
      )}
      {exportMessage && (
        <p className="usage-status" role="status">
          {t(exportMessage)}
        </p>
      )}
      {state.loading && <UsageSkeleton />}
      {report && (
        <>
          <div className="usage-overview">
            <section className="usage-card usage-wallet" aria-label={t('当前钱包')} title={t('完整钱包余额，不随日期或成员筛选变化。')}>
              <div className="usage-card-heading">
                <h2>{walletName}</h2>
                <span className="usage-context-label">{t('当前余额')}</span>
              </div>
              <div className="usage-wallet-values">
                <div>
                  <span>
                    <Wallet size={17} aria-hidden /> {t('当前可用')}
                  </span>
                  <strong>
                    <UsageNumber value={report.balance.available} />
                    <small> {t('点')}</small>
                  </strong>
                </div>
                <div>
                  <span>
                    <HourglassMedium size={17} aria-hidden /> {t('当前预占')}
                  </span>
                  <strong>
                    <UsageNumber value={report.balance.held} />
                    <small> {t('点')}</small>
                  </strong>
                </div>
              </div>
              <MotionDetails className="usage-small-details">
                <summary>{t('其他钱包状态')}</summary>
                <dl className="usage-wallet-other">
                  <div>
                    <dt>{t('已结算')}</dt>
                    <dd>
                      {pointText(report.balance.consumed)} {t('点')}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('已到期')}</dt>
                    <dd>
                      {pointText(report.balance.expired)} {t('点')}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('已撤回')}</dt>
                    <dd>
                      {pointText(report.balance.revoked)} {t('点')}
                    </dd>
                  </div>
                </dl>
              </MotionDetails>
            </section>
            <UsageCapacity
              spaceId={selectedSpaceId}
              spaceName={selectedSpaceName}
              operator={operator}
              identity={identity}
              refresh={revision}
            />
          </div>
          <section className="usage-period" aria-label={t('所选期间的服务点汇总')}>
            <div className="usage-section-heading">
              <h2>{t('期间汇总')}</h2>
              <span>
                {filteredMemberName ? `${filteredMemberName} · ` : ''}
                {from} — {to}
              </span>
            </div>
            <div className="usage-totals" data-motion="usage-totals">
              {usageKinds.map((key) => (
                <button
                  type="button"
                  key={key}
                  aria-pressed={kind === key}
                  onClick={() => setKind(key)}
                  title={t(usageKindDescriptions[key])}
                >
                  <span>{key === 'held' ? t('累计预占') : t(usageLabels[key])}</span>
                  <strong>
                    <UsageNumber value={report.totals[key]} />
                  </strong>
                </button>
              ))}
            </div>
            {report.unknownAmountEntries > 0 && (
              <p className="usage-footnote" role="status">
                {t('本期 {count} 条记录的金额或分摊不完整，汇总仅包含已确认数值。', {
                  count: formatNumber(report.unknownAmountEntries),
                })}
              </p>
            )}
          </section>
          <UsageInsights
            report={report}
            kind={kind}
            quotes={quotes}
            bucket={bucket}
            onBucket={setBucket}
          />
          <UsageRiver series={report.series} range={report.range} />
          <UsageLedger
            key={requestKey}
            report={report}
            quotes={quotes}
            members={members.data?.members ?? []}
            spaces={knownSpaces}
            currentUserId={currentUserId}
            more={state.more}
            error={state.pageError}
            onMore={() => void loadMore()}
            onJob={(entry) => {
              const reference = usageJobReference(entry);
              if (reference) setJobDetail({ key: requestKey, target: { kind: 'job', reference } });
            }}
          />
        </>
      )}
      <UsagePricing
        quotes={quotes}
        loading={legacy.loading || assistant.loading}
        errors={[legacy.error, assistant.error].filter((value): value is string => !!value)}
        onRefresh={() => setCatalogRefresh((value) => value + 1)}
      />
      <section className="usage-card usage-provider-entry" aria-label={t('供应商公开费率')}>
        <div>
          <h2>{t('供应商公开费率')}</h2>
        </div>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => setJobDetail({ key: requestKey, target: { kind: 'prices' } })}
        >
          {t('查看模型公开费率')}
        </button>
      </section>
      {jobDetail?.key === requestKey && (
        <UsageJob
          target={jobDetail.target}
          identity={requestKey}
          operator={operator}
          onClose={() => setJobDetail(null)}
        />
      )}
    </section>
  );
}
