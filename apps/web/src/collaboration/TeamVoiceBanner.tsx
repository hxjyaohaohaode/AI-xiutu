import { t } from '../i18n';
import { useRef, useState } from 'react';
import {
  Microphone,
  MicrophoneSlash,
  PhoneDisconnect,
  SlidersHorizontal,
  SpinnerGap,
  UsersThree,
} from '@phosphor-icons/react';
import { errorMessage } from '../lib/api';
import type { TeamVoiceState } from './useTeamVoice';

type RoomControls = Pick<
  TeamVoiceState,
  'state' | 'muted' | 'message' | 'toggleMic' | 'leave' | 'setMessage'
>;

/** Keep an ongoing room reachable while its artwork controls are in another view. */
export function TeamVoiceBanner({ room, onReturn }: { room: RoomControls; onReturn: () => void }) {
  const [switchingMic, setSwitchingMic] = useState(false);
  const micRequest = useRef(false);
  if (room.state === 'idle') return null;
  const connected = room.state === 'connected';
  async function toggleMicrophone() {
    if (!connected || micRequest.current) return;
    micRequest.current = true;
    setSwitchingMic(true);
    try {
      await room.toggleMic();
    } catch (error) {
      room.setMessage(errorMessage(error));
    } finally {
      micRequest.current = false;
      setSwitchingMic(false);
    }
  }
  return (
    <section
      className="team-voice-banner"
      aria-label={t('当前团队通话')}
      data-state={room.state}
      data-mic={connected && !room.muted ? 'on' : 'off'}
    >
      <div className="team-voice-banner-status" role="status" aria-atomic="true">
        <UsersThree size={18} aria-hidden />
        <span>
          <strong>{connected ? t('团队通话中') : t('正在加入团队语音')}</strong>
          <small>
            {connected
              ? room.muted
                ? t('仅收听 · 麦克风关闭')
                : t('麦克风已开启')
              : t('连接中 · 麦克风尚未开启')}
          </small>
        </span>
      </div>
      <div className="team-voice-banner-actions" role="group" aria-label={t('团队语音快捷操作')}>
        <button type="button" onClick={onReturn}>
          <SlidersHorizontal size={16} aria-hidden />
          <span>{t('返回精修')}</span>
        </button>
        {connected && (
          <button
            type="button"
            aria-pressed={!room.muted}
            aria-busy={switchingMic}
            disabled={switchingMic}
            onClick={() => void toggleMicrophone()}
          >
            {switchingMic ? (
              <SpinnerGap size={16} className="spin" aria-hidden />
            ) : room.muted ? (
              <MicrophoneSlash size={16} aria-hidden />
            ) : (
              <Microphone size={16} aria-hidden />
            )}
            <span>
              {switchingMic
                ? room.muted
                  ? t('正在开启…')
                  : t('正在关闭…')
                : room.muted
                  ? t('开启麦克风')
                  : t('关闭麦克风')}
            </span>
          </button>
        )}
        <button type="button" className="team-voice-banner-leave" onClick={room.leave}>
          <PhoneDisconnect size={16} aria-hidden />
          <span>{t('离开通话')}</span>
        </button>
      </div>
      {room.message && (
        <p className="team-voice-banner-message" role="status">
          {room.message}
        </p>
      )}
    </section>
  );
}
