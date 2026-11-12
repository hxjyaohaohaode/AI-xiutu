import { X } from '@phosphor-icons/react';
import { IconButton, Modal } from '../components/Ui';
import { t } from '../i18n';
import { useEffect, useState } from 'react';
import type { AssistantVisualAttachment } from '@ai-xiutu/contracts';

export function visualAttachmentLabel(kind: AssistantVisualAttachment['kind']) {
  return kind === 'editor' ? t('编辑界面截图') : kind === 'sketch' ? t('草图') : t('照片预览');
}

export function DraftAttachmentCard({
  source,
  label,
  disabled,
  onRemove,
}: {
  source: string | File;
  label: string;
  disabled?: boolean;
  onRemove: () => void;
}) {
  const [preview, setPreview] = useState<{ file: File; url: string }>();
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (typeof source === 'string') return;
    const url = URL.createObjectURL(source);
    setPreview({ file: source, url });
    return () => URL.revokeObjectURL(url);
  }, [source]);
  const url = typeof source === 'string' ? source : preview?.file === source ? preview.url : '';
  return (
    <>
      <figure className="ai-draft-attachment" aria-label={label}>
        {url && (
          <button
            type="button"
            className="ai-attachment-thumbnail"
            aria-label={t('查看附件')}
            onClick={() => setExpanded(true)}
          >
            <img src={url} alt={label} />
          </button>
        )}
        <figcaption>{label}</figcaption>
        <IconButton label={t('移除附件')} disabled={disabled} onClick={onRemove}>
          <X size={15} />
        </IconButton>
      </figure>
      {expanded && url && (
        <Modal title={label} open onClose={() => setExpanded(false)}>
          <img className="ai-attachment-preview-image" src={url} alt={label} />
        </Modal>
      )}
    </>
  );
}
