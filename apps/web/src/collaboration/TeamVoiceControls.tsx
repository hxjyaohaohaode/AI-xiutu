import { useEffect, useState } from 'react';
import type { AssistantContext } from '@ai-xiutu/contracts';
import { api, errorMessage, jsonRequest } from '../lib/api';
import { secureUuid } from '../lib/uuid';
import type { TeamVoiceState } from './useTeamVoice';
import { VoiceCaptions } from '../ai/VoiceCaptions';
import { SearchEvidence } from '../ai/SearchEvidence';

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
  useEffect(() => {
    if (room.state !== 'connected' || !room.canInvite) return;
    const controller = new AbortController();
    void api<Catalog>('/assistant/models', { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setCatalog(value);
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
          await api(
            path,
            jsonRequest('POST', {
              idempotencyKey: secureUuid(),
              modelId: voiceId,
              backendModelId: modelId,
              voice: selectedVoice?.voice?.voices[0],
              confirmed: true,
              context,
            }),
          );
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
    <section className="team-voice" aria-label="团队语音">
      {room.state !== 'connected' ? (
        <button
          type="button"
          disabled={room.state === 'connecting'}
          onClick={() => void room.join()}
        >
          {room.state === 'connecting' ? '正在加入语音' : '加入团队语音'}
        </button>
      ) : (
        <>
          <div className="collaboration-actions">
            <button type="button" aria-pressed={!room.muted} onClick={() => void room.toggleMic()}>
              {room.muted ? '开启麦克风' : '关闭麦克风'}
            </button>
            <button type="button" onClick={room.leave}>
              离开团队语音
            </button>
          </div>
          {agent.state === 'off' && (
            <VoiceCaptions
              key="members"
              captions={room.peerCaptions}
              userLabel="成员"
              initiallyVisible={false}
              onVisibilityChange={room.captionPeers}
              status={room.peerCaptionStatus}
            />
          )}
          {agent.state === 'off' && agent.lastOutcome === 'unknown' && (
            <p role="status">上一轮 AI 费用待核验。</p>
          )}
          {agent.state === 'off' && room.canInvite && catalog?.voiceReady && (
            <details>
              <summary>邀请 AI 加入</summary>
              <label>
                团队语音模型
                <select
                  value={voiceId}
                  onChange={(event) => setVoiceId(event.target.value)}
                  disabled={pending}
                >
                  <option value="">选择语音模型</option>
                  {catalog.models
                    .filter((item) => item.operations.includes('realtime-voice'))
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                团队思考模型
                <select
                  value={modelId}
                  onChange={(event) => setModelId(event.target.value)}
                  disabled={pending}
                >
                  <option value="">选择思考模型</option>
                  {catalog.models
                    .filter((item) => item.operations.includes('assistant-turn'))
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                </select>
              </label>
              <label className="team-voice-checkbox">
                <input
                  type="checkbox"
                  checked={share}
                  disabled={!selected?.imageInput || !capture || pending}
                  onChange={(event) => setShare(event.target.checked)}
                />
                同时共享当前预览
              </label>
              {selectedVoice && (
                <small>
                  团队额度 {selectedVoice.unitCost} 点 · 最长 {selectedVoice.maxSeconds} 秒 ·{' '}
                  {selectedVoice.maxDelegations} 次后台协作
                </small>
              )}
              <button
                type="button"
                disabled={pending || !selectedVoice || !selected || (share && !selected.imageInput)}
                onClick={() => void control('start')}
              >
                确认邀请 AI
              </button>
            </details>
          )}
          {agent.state !== 'off' && (
            <>
              <p role="status">
                {agent.state === 'active'
                  ? '团队 AI 已加入'
                  : agent.state === 'connecting'
                    ? '团队 AI 正在连接'
                    : '团队 AI 正在结束'}
              </p>
              {agent.state === 'active' && (
                <label className="team-voice-checkbox">
                  <input
                    type="checkbox"
                    checked={sharingMic}
                    disabled={room.pendingConsent !== null}
                    onChange={(event) => room.listenToAi(event.target.checked)}
                  />
                  允许本轮 AI 听我的麦克风
                </label>
              )}
              {room.pendingConsent !== null && <small role="status">正在确认麦克风授权</small>}
              {agent.state === 'active' && !agent.contextReady && (
                <small role="status">AI 等待同步当前作品。</small>
              )}
              {agent.state === 'active' && (
                <VoiceCaptions key="ai" captions={room.captions} userLabel="成员" />
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
                      同步时共享当前预览
                    </label>
                  )}
                  <button type="button" disabled={pending} onClick={() => void control('sync')}>
                    同步 AI 画面
                  </button>
                  <button type="button" disabled={pending} onClick={() => void control('end')}>
                    结束团队 AI
                  </button>
                </div>
              )}
              {room.contextStatus && <small role="status">{room.contextStatus}</small>}
              {room.agentTool?.state === 'running' && (
                <small role="status">
                  {room.agentTool.name === 'search_resources'
                    ? '正在查找团队素材'
                    : '正在分析作品与需求'}
                </small>
              )}
              {room.agentResult && (
                <div className="team-voice-caption" aria-label="团队 AI 回复">
                  <p>{room.agentResult.text}</p>
                  {!!room.agentResult.search?.length && (
                    <SearchEvidence evidence={room.agentResult.search} selected={[]} disabled />
                  )}
                </div>
              )}
            </>
          )}
          <ul aria-label="语音成员">
            {room.roster.members.map((member) => (
              <li key={member.speakerId}>
                <span>
                  {member.displayName}
                  {member.speakerId === room.speaker ? '（我）' : ''}
                </span>
                <small>
                  {member.muted
                    ? '仅收听'
                    : member.listeningToAi && agent.state === 'active' && agent.contextReady
                      ? '麦克风开启 · AI 可听见'
                      : '麦克风开启'}
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
