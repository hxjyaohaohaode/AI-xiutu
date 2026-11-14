
import { useEffect, useState } from 'react';
import { Robot } from '@phosphor-icons/react';
import { readModelCatalog, errorMessage } from '../lib/api';
import { useAssistantPreferences } from '../ai/assistantPreferences';
import { t } from '../i18n';

type Model = { id: string; label: string; operations: string[] };
export function AccountAssistantPreferences({ actorId }: { actorId: string }) {
  const [value, set] = useAssistantPreferences(actorId);
  const [models, setModels] = useState<Model[] | null>(null);
  const [failure, setFailure] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [saved, setSaved] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    readModelCatalog<{ models: Model[] }>('/assistant/models', controller.signal).then(
      (result) => { if (!controller.signal.aborted) setModels(result.models); },
      (error) => { if (!controller.signal.aborted) setFailure(errorMessage(error)); },
    );
    return () => controller.abort();
  }, [actorId, attempt]);
  async function change(patch: Parameters<typeof set>[0]) {
    setSaving(true);
    try { await set(patch); setSaved(t('助手默认值已更新')); }
    catch (error) { setSaved(errorMessage(error)); }
    finally { setSaving(false); }
  }
  const picker = (name: string, key: 'textModel' | 'voiceModel', operation: string) => {
    const choices = models?.filter((model) => model.operations.includes(operation)) ?? [];
    return <label>{t(name)}
      <select disabled={saving || !choices.length} value={choices.some(({ id }) => id === value[key]) ? value[key] : ''}
        onChange={(event) => change({ [key]: event.target.value })}>
        <option value="">{t('使用首个可用模型')}</option>
        {choices.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
      </select>
    </label>;
  };
  return (
    <section className="account-section account-assistant-preferences">
      <div className="account-section-heading"><Robot size={20} /><h2>{t('助手偏好')}</h2></div>
      <p>{t('默认值会同步到此账号的其他设备。每轮仍可在对话里单独选择模型和参数。')}</p>
      {picker('默认文字模型', 'textModel', 'assistant-turn')}
      {picker('默认语音模型', 'voiceModel', 'realtime-voice')}
      <label>{t('默认执行方式')}
        <select disabled={saving} value={value.mode} onChange={(event) => change({ mode: event.target.value === 'suggest' ? 'suggest' : 'confirm' })}>
          <option value="confirm">{t('预览后确认')}</option>
          <option value="suggest">{t('只给建议')}</option>
        </select>
      </label>
      <label><input type="checkbox" disabled={saving} checked={value.captions}
        onChange={(event) => change({ captions: event.target.checked })} /> {t('实时通话默认显示字幕')}</label>
      {!!failure && !models && <p role="alert">{failure} <button type="button" className="text-button" onClick={() => {
        setFailure(''); setAttempt((previous) => previous + 1);
      }}>{t('重试')}</button></p>}
      {saved && <p role="status">{saved}</p>}
    </section>
  );
}
