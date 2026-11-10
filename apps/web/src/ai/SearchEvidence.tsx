import { MotionDetails } from '../motion/Presence';
import { useContext, useEffect, useState } from 'react';
import {
  assistantSearchEvidenceSchema,
  type AssistantCloudResource,
  type AssistantSearchEvidence,
} from '@ai-xiutu/contracts';
import { Modal } from '../components/Ui';
import { AIVisibilityContext } from './AIVisibility';
import { useRetainedDialogValue } from './useRetainedDialogValue';
import './live-assistant.css';

interface ReferenceControls {
  selected: string[];
  disabled: boolean;
  onSelect?: (id: string) => void;
}

export function CloudImageResults({
  resources,
  selected,
  disabled,
  onSelect,
}: ReferenceControls & {
  resources: AssistantCloudResource[];
}) {
  const [preview, setPreview] = useState<AssistantCloudResource | null>(null);
  const displayedPreview = useRetainedDialogValue(preview);
  const [unavailable, setUnavailable] = useState(false);
  const visible = useContext(AIVisibilityContext);
  useEffect(() => {
    if (!visible) setPreview(null);
  }, [visible]);
  const thumbnail = (id: string) => `/v1/assets/${encodeURIComponent(id)}/thumbnail`;
  const canSelect = (id: string) => !disabled && (selected.includes(id) || selected.length < 8);
  const label = (item: AssistantCloudResource) => item.title || item.name;
  const details = (item: AssistantCloudResource) =>
    `${item.spaceName} · ${item.projectTitle} · ${item.width}×${item.height}`;
  return (
    <>
      <ul className="assistant-cloud-grid" aria-label="云端图片结果">
        {resources.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className="assistant-cloud-preview"
              aria-label={`查看 ${label(item)}`}
              onClick={() => {
                setUnavailable(false);
                setPreview(item);
              }}
            >
              <img src={thumbnail(item.id)} alt="" loading="lazy" />
              <span>
                {label(item)}
                <small>{details(item)}</small>
              </span>
            </button>
            {onSelect && (
              <button
                type="button"
                className="assistant-reference-toggle"
                aria-pressed={selected.includes(item.id)}
                disabled={!canSelect(item.id)}
                onClick={() => onSelect(item.id)}
              >
                {selected.includes(item.id) ? '移出参考' : '选为参考'}
              </button>
            )}
          </li>
        ))}
      </ul>
      {displayedPreview && (
        <Modal
          title={label(displayedPreview)}
          open={visible && !!preview}
          onClose={() => setPreview(null)}
        >
          <div className="assistant-cloud-detail">
            {unavailable ? (
              <p role="alert">图片暂不可查看，请检查素材状态和访问权限。</p>
            ) : (
              <img
                src={thumbnail(displayedPreview.id)}
                alt={label(displayedPreview)}
                onError={() => setUnavailable(true)}
              />
            )}
            <p>{details(displayedPreview)}</p>
            {onSelect && (
              <button
                type="button"
                className="button button-primary"
                disabled={unavailable || !canSelect(displayedPreview.id)}
                onClick={() => {
                  if (!visible || !preview) return;
                  onSelect(preview.id);
                  setPreview(null);
                }}
              >
                {selected.includes(displayedPreview.id) ? '移出参考' : '选为参考'}
              </button>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

export function SearchEvidence({
  evidence,
  ...controls
}: ReferenceControls & {
  evidence: AssistantSearchEvidence[];
}) {
  const safe = evidence.flatMap((item) => {
    const result = assistantSearchEvidenceSchema.safeParse(item);
    return result.success ? [result.data] : [];
  });
  return (
    <div className="assistant-search-evidence">
      {safe.map((item, index) => (
        <MotionDetails key={`${item.kind}:${item.query}:${index}`} defaultOpen>
          <summary>
            {item.kind === 'cloud' ? '云端图片' : '公开来源'} · {item.query}
          </summary>
          {item.kind === 'cloud' ? (
            item.resources.length ? (
              <CloudImageResults resources={item.resources} {...controls} />
            ) : (
              <p>本次范围内没有匹配的图片。</p>
            )
          ) : (
            <>
              {item.images.map((image) => (
                <div className="assistant-public-image" key={image.imageUrl}>
                  <p>{image.caption || '公开图片'}</p>
                  <a href={image.imageUrl} target="_blank" rel="noopener noreferrer">
                    查看图片
                  </a>
                  <a href={image.sourceUrl} target="_blank" rel="noopener noreferrer">
                    来源网页
                  </a>
                </div>
              ))}
              <div className="assistant-citations">
                {item.sources.map((source) => (
                  <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">
                    {source.title || '查看来源'}
                  </a>
                ))}
              </div>
              {item.requested === 'images' && !item.images.length && !!item.sources.length && (
                <p>本次只返回来源网页。</p>
              )}
              {!item.images.length && !item.sources.length && <p>本次未取得可引用的公开结果。</p>}
            </>
          )}
        </MotionDetails>
      ))}
    </div>
  );
}
