import { t } from '../i18n';
import { Microphone, MicrophoneSlash, PhoneDisconnect } from '@phosphor-icons/react';
import '../ai/interaction-surfaces.css';
import { MotionDetails } from '../motion/Presence';
import { useEffect, useState } from 'react';
import type { AssistantContext } from '@ai-xiutu/contracts';
import { api, errorMessage, jsonRequest } from '../lib/api';
import { secureUuid } from '../lib/uuid';
import type { TeamVoiceState } from './useTeamVoice';
import { VoiceCaptions } from '../ai/VoiceCaptions';
import { SearchEvidence } from '../ai/SearchEvidence';
import { ChoiceSelect } from '../components/ChoiceSelect';

interface Model {
  id: string;
  label: string;
  operations: string[];
  unitCost: number;
  maxSeconds: number;
  maxDelegations: number;
  imageInput: boolean;
  voice?: { voices: string[] } | null;
}
interface Catalog {
  voiceReady: boolean;
  models: Model[];
}

export function TeamVoiceControls({
  room,
  capture,
}: {
  room: TeamVoiceState;
  capture?: () => Promise<AssistantContext>;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [voiceId, setVoiceId] = useState('');
  const [modelId, setModelId] = useState('');
  const [share, setShare] = useState(false);
  const [pending, setPending] = useState(false);
  const agent = room.roster.agent;
  const isHost = agent.state !== 'off' && agent.hostSpeakerId === room.speaker;
  const selectedVoice = catalog?.models.find((item) => item.id === voiceId);
  const selected = catalog?.models.find((item) => item.id === modelId);
  const sharingMic =
    room.roster.members.find((member) => member.speakerId === room.speaker)?.listeningToAi ?? false;
  const invitationBlocked =
    !room.invitationReady ||
    !!room.pendingInvitation ||
    !!room.pendingIndividualVoice ||
    (agent.state === 'off' && agent.lastOutcome === 'unknown');
  useEffect(() => {
    if (room.state !== 'connected' || !room.canInvite) return;
    const controller = new AbortController();
    void api<Catalog>('/assistant/models', { signal: controller.signal })
      .then((value) => {
        if (controller.signal.aborted) return;
        setCatalog(value);
        if (room.pendingInvitation || room.pendingIndividualVoice) return;
        setVoiceId((old) =>
          value.models.some((item) => item.id === old && item.operations.includes('realtime-voice'))
            ? old
            : (value.models.find((item) => item.operations.includes('realtime-voice'))?.id ?? ''),
        );
        setModelId((old) =>
          value.models.some((item) => item.id === old && item.operations.includes('assistant-turn'))
            ? old
            : (value.models.find((item) => item.operations.includes('assistant-turn'))?.id ?? ''),
        );
      })
      .catch((error) => {
        if (!controller.signal.aborted) room.setMessage(errorMessage(error));
      });
    return () => controller.abort();
  }, [room.state, room.canInvite, room.artworkId]);
  async function control(action: 'start' | 'end' | 'sync') {
    const id = room.artworkId;
    if (!id || pending) return;
    const current = room.ownership(id);
    if (!current()) return;
    setPending(true);
    room.setMessage('');
    const path = '/artworks/' + id + '/team-voice/agent';
    try {
      if (action === 'end') await api(path, { method: 'DELETE' });
      else {
        const context = share && capture ? await capture() : undefined;
        if (!current()) return;
        if (action === 'start') {
          room.setContextStatus('');
          await room.inviteAgent({
            idempotencyKey: secureUuid(),
            modelId: voiceId,
            backendModelId: modelId,
            voice: selectedVoice?.voice?.voices[0],
            confirmed: true,
            context,
          });
        } else {
          room.setContextStatus('等待 AI 同步');
          await api(path + '/context', jsonRequest('PUT', context ?? null));
        }
      }
    } catch (error) {
      if (current()) {
        if (action === 'sync') room.setContextStatus('同步未完成');
        room.setMessage(errorMessage(error));
      }
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="team-voice" aria-label={t('团队语音')}>
      {room.state === 'connected' && (
        <div className="collaboration-actions">
          <button type="button" aria-pressed={!room.muted} onClick={() => void room.toggleMic()}>
            {room.muted ? <Microphone size={17} /> : <MicrophoneSlash size={17} />}
            {room.muted ? t('开启麦克风') : t('关闭麦克风')}
          </button>
          <button type="button" onClick={room.leave}>
            <PhoneDisconnect size={17} />
            {t('离开团队语音')}
          </button>
        </div>
      )}
      {room.invitationError && (
        <div role="alert">
          <p>{t(room.invitationError)}</p>
          <button type="button" onClick={room.restoreInvitations}>
            {t('重新读取邀请记录')}
          </button>
        </div>
      )}
      {room.pendingIndividualVoice && (
        <p role="status">
          {t('个人 AI 通话仍待确认，核验前暂停新的团队 AI 邀请。成员之间的语音交流仍可使用。')}
        </p>
      )}
      {room.pendingInvitation &&
        (room.pendingInvitation.state === 'unknown' ||
          room.state !== 'connected' ||
          agent.state === 'off') && (
          <div className="team-voice-caption" role="status" aria-label={t('团队 AI 邀请恢复')}>
            <p>{t('原团队 AI 邀请结果待确认，已暂停新的付费邀请。可继续加入成员通话。')}</p>
            <MotionDetails>
              <summary>{t('查看核验说明与请求标识')}</summary>
              <p style={{ overflowWrap: 'anywhere' }}>
                {t('请求标识：')}
                <code>{room.pendingInvitation.idempotencyKey}</code>
                {room.pendingInvitation.invitationId && (
                  <>
                    <br />
                    {t('房间邀请标识：')}
                    <code>{room.pendingInvitation.invitationId}</code>
                  </>
                )}
              </p>
              <p>
                {t(
                  '请从工作区「用量」核对预占，并将以上标识提供给平台运营。 当前接口未提供历史邀请核验查询；房间邀请标识也不是计费会话标识。 重新加入、结束按钮的成功提示或新邀请的失败提示，都不能解除旧请求的待核验状态。',
                )}
              </p>
            </MotionDetails>
          </div>
        )}
      {room.state !== 'connected' ? (
        <button
          type="button"
          disabled={room.state === 'connecting'}
          onClick={() => void room.join()}
        >
          {room.state === 'connecting' ? t('正在加入语音') : t('加入团队语音')}
        </button>
      ) : (
        <>
          {agent.state === 'off' && (
            <VoiceCaptions
              key="members"
              captions={room.peerCaptions}
              userLabel={t('成员')}
              initiallyVisible={false}
              onVisibilityChange={room.captionPeers}
              status={room.peerCaptionStatus}
            />
          )}
          {agent.state === 'off' && agent.lastOutcome === 'unknown' && (
            <p role="status">{t('上一轮 AI 费用待核验。')}</p>
          )}
          {agent.state === 'off' && room.canInvite && catalog?.voiceReady && (
            <MotionDetails>
              <summary>{t('邀请 AI 加入')}</summary>
              <ChoiceSelect
                label={t('团队语音模型')}
                value={voiceId}
                onValueChange={setVoiceId}
                disabled={pending || invitationBlocked}
                options={[
                  { value: '', label: t('选择语音模型') },
                  ...catalog.models
                    .filter((item) => item.operations.includes('realtime-voice'))
                    .map((item) => ({ value: item.id, label: item.label })),
                ]}
              />
              <ChoiceSelect
                label={t('团队思考模型')}
                value={modelId}
                onValueChange={setModelId}
                disabled={pending || invitationBlocked}
                options={[
                  { value: '', label: t('选择思考模型') },
                  ...catalog.models
                    .filter((item) => item.operations.includes('assistant-turn'))
                    .map((item) => ({ value: item.id, label: item.label })),
                ]}
              />
              <label className="team-voice-checkbox">
                <input
                  type="checkbox"
                  checked={share}
                  disabled={!selected?.imageInput || !capture || pending || invitationBlocked}
                  onChange={(event) => setShare(event.target.checked)}
                />
                {t('同时共享当前预览')}
              </label>
              {selectedVoice && (
                <small>
                  {t('团队额度')}
                  {selectedVoice.unitCost} {t('点 · 最长')}
                  {selectedVoice.maxSeconds} {t('秒 ·')} {selectedVoice.maxDelegations}{' '}
                  {t('次后台协作')}
                </small>
              )}
              <button
                type="button"
                disabled={
                  pending ||
                  invitationBlocked ||
                  !selectedVoice ||
                  !selected ||
                  (share && !selected.imageInput)
                }
                onClick={() => void control('start')}
              >
                {t('确认邀请 AI')}
              </button>
            </MotionDetails>
          )}
          {agent.state !== 'off' && (
            <>
              <p role="status">
                {agent.state === 'active'
                  ? t('团队 AI 已加入')
                  : agent.state === 'connecting'
                    ? t('团队 AI 正在连接')
                    : t('团队 AI 正在结束')}
              </p>
              {agent.state === 'active' && (
                <label className="team-voice-checkbox">
                  <input
                    type="checkbox"
                    checked={sharingMic}
                    disabled={room.pendingConsent !== null}
                    onChange={(event) => room.listenToAi(event.target.checked)}
                  />
                  {t('允许本轮 AI 听我的麦克风')}
                </label>
              )}
              {room.pendingConsent !== null && (
                <small role="status">{t('正在确认麦克风授权')}</small>
              )}
              {agent.state === 'active' && !agent.contextReady && (
                <small role="status">{t('AI 等待同步当前作品。')}</small>
              )}
              {agent.state === 'active' && (
                <VoiceCaptions key="ai" captions={room.captions} userLabel={t('成员')} />
              )}
              {isHost && agent.state === 'active' && (
                <div className="collaboration-actions">
                  {capture && (
                    <label className="team-voice-checkbox">
                      <input
                        type="checkbox"
                        checked={share}
                        onChange={(event) => setShare(event.target.checked)}
                      />
                      {t('同步时共享当前预览')}
                    </label>
                  )}
                  <button type="button" disabled={pending} onClick={() => void control('sync')}>
                    {t('同步 AI 画面')}
                  </button>
                  <button type="button" disabled={pending} onClick={() => void control('end')}>
                    {t('结束团队 AI')}
                  </button>
                </div>
              )}
              {room.contextStatus && <small role="status">{t(room.contextStatus)}</small>}
              {room.agentTool?.state === 'running' && (
                <small role="status">
                  {room.agentTool.name === 'search_resources'
                    ? t('正在查找团队素材')
                    : t('正在分析作品与需求')}
                </small>
              )}
              {room.agentResult && (
                <div className="team-voice-caption" aria-label={t('团队 AI 回复')}>
                  <p>{room.agentResult.text}</p>
                  {!!room.agentResult.search?.length && (
                    <SearchEvidence evidence={room.agentResult.search} selected={[]} disabled />
                  )}
                </div>
              )}
            </>
          )}
          <ul aria-label={t('语音成员')}>
            {room.roster.members.map((member) => (
              <li key={member.speakerId}>
                <span>
                  {member.displayName}
                  {member.speakerId === room.speaker ? t('（我）') : ''}
                </span>
                <small>
                  {member.muted
                    ? t('仅收听')
                    : member.listeningToAi && agent.state === 'active' && agent.contextReady
                      ? t('麦克风开启 · AI 可听见')
                      : t('麦克风开启')}
                </small>
              </li>
            ))}
          </ul>
        </>
      )}
      {room.message && <small role="status">{room.message}</small>}
    </section>
  );
}
