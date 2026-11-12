import { t } from '../i18n';
import { errorMessage } from '../lib/api';

export function voiceErrorMessage(error: unknown): string {
  const name = error && typeof error === 'object' && 'name' in error ? error.name : '';
  switch (name) {
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return t('未找到麦克风，请连接设备后重试。');
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return t('请在浏览器中允许使用麦克风。');
    case 'NotReadableError':
    case 'TrackStartError':
      return t('麦克风被占用或无法启动，请检查设备。');
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return t('当前麦克风不支持所需音频格式，请切换设备。');
    default:
      return errorMessage(error);
  }
}
