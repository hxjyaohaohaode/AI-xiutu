import type { DocumentFormat } from '@ai-xiutu/contracts';
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { ChoiceSelect } from '../components/ChoiceSelect';
import { downloadBlob } from '../lib/api';
import type { CaptureProjectCover } from './cover';
import type { FileFormat } from './export';

type ExportOption = FileFormat | 'pptx-cover' | '';

export function ExportContent({
  title,
  body,
  formatting,
  captureCover,
  formats,
}: {
  title: string;
  body: string;
  formatting?: DocumentFormat | null;
  captureCover?: CaptureProjectCover;
  formats?: readonly FileFormat[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ticket = useRef(0);
  useEffect(() => {
    setBusy(false);
    setError('');
    return () => {
      ticket.current++;
    };
  }, [body, title, formatting]);

  async function run(option: ExportOption) {
    if (!option || busy) return;
    const format = option === 'pptx-cover' ? 'pptx' : option;
    const id = ++ticket.current;
    setError('');
    setBusy(true);
    try {
      const cover = option === 'pptx-cover' ? await captureCover?.() : undefined;
      if (option === 'pptx-cover' && !cover)
        throw new Error('最新编辑还没有完成渲染，请稍后再共享。');
      if (ticket.current !== id) return;
      const { exportContent } = await import('./export');
      const sourceTitle =
        title.trim() ||
        body
          .trim()
          .split('\n', 1)[0]
          .replace(/^#{1,6}\s+/, '')
          .slice(0, 120) ||
        t('文档');
      const name =
        sourceTitle
          .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
          .slice(0, 72)
          .trim() || t('文档');
      const file = await exportContent(format, sourceTitle, body, cover?.imageDataUrl, formatting);
      cover?.assertCurrent();
      if (ticket.current === id) downloadBlob(file, name + '.' + format);
    } catch (cause) {
      if (ticket.current === id)
        setError(cause instanceof Error ? cause.message : '文件导出失败。');
    } finally {
      if (ticket.current === id) setBusy(false);
    }
  }
  return (
    <>
      <ChoiceSelect<ExportOption>
        value=""
        ariaLabel={t('下载文件')}
        size="compact"
        placeholder={busy ? t('正在导出') : t('下载文件')}
        disabled={busy || !body.trim()}
        onValueChange={(format) => void run(format)}
        options={[
          { value: 'docx', label: 'Word (.docx)' },
          { value: 'pptx', label: 'PowerPoint (.pptx)' },
          ...(captureCover
            ? [{ value: 'pptx-cover' as const, label: t('PowerPoint · 含当前画面') }]
            : []),
          { value: 'xlsx', label: 'Excel (.xlsx)' },
          { value: 'svg', label: t('矢量图表 (.svg)') },
          ...(formats?.includes('png') ? [{ value: 'png' as const, label: t('高清图表 (.png)') }] : []),
        ].filter(option => !formats || formats.some(format => format === option.value) ||
          (option.value === 'pptx-cover' && formats.includes('pptx'))) as { value: ExportOption; label: string }[]}
      />
      {error && (
        <span role="alert" className="control-note">
          {t(error)}
        </span>
      )}
    </>
  );
}
