import { t, useLocale } from '../i18n';
import { useState } from 'react';
import type { AIModel, ImageOptions } from './types';
import {
  allowedImageSizes,
  imageOptionsError,
  imageSizeError,
  imageBatchError,
  changeImageOption,
} from './capabilities';
import { Disclosure, OptionChips } from '../components/Controls';
import { modelCopy } from './model-copy';
import { CheckControl } from '../components/CheckControl';
import { gifFrameCount, gifFrameDelay, openAISvgAuthorSchema } from '@ai-xiutu/contracts';
import './model-settings.css';

const names: Record<string, string> = {
  auto: '自动',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
  max: '最高',
  opaque: '不透明',
  transparent: '透明',
  png: 'PNG',
  jpeg: 'JPEG',
  webp: 'WebP',
  svg: 'SVG',
  gif: 'GIF',
};
const capabilityNames = {
  inputFidelity: '输入保真度',
  stream: '流式输出',
  partialImages: '渐进预览',
  svg: 'SVG',
  gif: 'GIF',
} as const;
export function ImageParameters({
  model,
  width,
  height,
  options,
  hasReference = false,
  disabled,
  onSize,
  onOptions,
}: {
  model?: AIModel;
  width: number;
  height: number;
  options: ImageOptions;
  hasReference?: boolean;
  disabled: boolean;
  onSize: (width: number, height: number) => void;
  onOptions: (options: ImageOptions) => void;
}) {
  const copy = modelCopy(useLocale());
  const [linkedChange, setLinkedChange] = useState<{
    modelId: string;
    background?: string;
    format?: string;
    field: 'background' | 'outputFormat';
  } | null>(null);
  const c = model?.parameterCapabilities;
  const svg = options.outputFormat === 'svg';
  const gif = options.outputFormat === 'gif';
  const authors = c?.svg.authors ?? [];
  const selectedAuthor = authors.find((author) => author.id === options.svg?.model);
  const choices = allowedImageSizes(model, options);
  const sizeError = options.size === 'auto' ? null : imageSizeError(model, width, height, options);
  const batchError = imageBatchError(model, width, height, options);
  const optionError = imageOptionsError(model, options);
  const step = c?.size.multipleOf ?? 1;
  const maxDimension = Math.min(model?.maxDimension ?? 8192,
    (gif ? c?.gif.maxDimension : c?.size.maxDimension) ?? 8192);
  const fields = [
    ['quality', '质量'],
    ['background', '背景'],
    ['outputFormat', '供应商编码'],
    ['complexity', '复杂度'],
  ] as const;
  const hasAdvancedOptions =
    c &&
    (c.background.supported ||
      c.outputFormat.supported ||
      c.complexity.supported ||
      (c.outputCompression.supported &&
        c.outputCompression.formats?.includes(options.outputFormat ?? 'png')));
  if (!model) return <p className="ai-model-empty">{copy.noModel}</p>;
  const previewWidth = Number.isFinite(width) && width > 0 ? width : 1;
  const previewHeight = Number.isFinite(height) && height > 0 ? height : 1;
  const ratio = previewWidth / previewHeight;
  const renderField = (field: (typeof fields)[number][0], label: string) => {
    const capability = c?.[field];
    if (!capability?.supported) return null;
    const fieldLabel =
      field === 'complexity'
        ? copy.complexity
        : field === 'outputFormat'
          ? copy.encoding
          : t(label);
    return (
      <div className="parameter-row" key={field}>
        <div className="parameter-label">{fieldLabel}</div>
        <OptionChips
          label={fieldLabel}
          value={options[field] ?? ''}
          options={[
            ...(field === 'complexity' ? [{ value: '', label: t('使用官方默认') }] : []),
            ...(capability.values ?? []).map((value) => ({
              value,
              label: names[value] ? t(names[value]) : value,
              disabled: (field === 'outputFormat' && value === 'svg' && hasReference) ||
                !changeImageOption(model, options, field, value),
              reason: field === 'outputFormat' && value === 'svg' && hasReference
                ? t('SVG 仅支持文字生图。') : !changeImageOption(model, options, field, value)
                ? copy.invalidPair
                : undefined,
            })),
          ]}
          disabled={disabled}
          onChange={(value) => {
            if (field === 'complexity' && !value) {
              const { complexity: _default, ...next } = options;
              onOptions(next);
              return;
            }
            const next = changeImageOption(model, options, field, value);
            if (!next) return;
            setLinkedChange(
              next.background !== options.background && field !== 'background'
                ? {
                    modelId: model.id,
                    background: next.background,
                    format: next.outputFormat,
                    field: 'background',
                  }
                : next.outputFormat !== options.outputFormat && field !== 'outputFormat'
                  ? {
                      modelId: model.id,
                      background: next.background,
                      format: next.outputFormat,
                      field: 'outputFormat',
                    }
                  : null,
            );
            onOptions(next);
          }}
        />
        {field === 'complexity' && <p className="control-note">{copy.complexityHint}</p>}
      </div>
    );
  };
  return (
    <div className="image-parameters image-parameters-v3">
      <div className="image-frame-summary" aria-label={copy.outputPreview}>
        <span className="image-frame-symbol" aria-hidden>
          <span
            style={{
              width: `${Math.min(38, 32 * ratio)}px`,
              height: `${Math.min(32, 38 / ratio)}px`,
            }}
          />
        </span>
        <span>
          <strong>
            {options.size === 'auto' ? t('自动尺寸') : `${width || '—'} × ${height || '—'}`}
          </strong>
          <small>
            {options.size === 'auto' ? '' : 'px · '}
            {options.n ?? 1} {t('张')}
          </small>
        </span>
      </div>
      <div className="parameter-label">{t('画幅与尺寸')}</div>
      <OptionChips
        label={t('常用生成尺寸')}
        value={options.size ?? width + 'x' + height}
        options={[
          ...((gif ? c?.gif.autoSizes?.length : c?.size.auto) ? [{ value: 'auto', label: t('自动尺寸') }] : []),
          ...(c?.size.allowedSizes ? choices : choices.slice(0, 3)).map((size) => ({
            value: size.width + 'x' + size.height,
            label: (
              <>
                <span>
                  {size.width === size.height
                    ? t('方形')
                    : size.width > size.height
                      ? t('横向')
                      : t('竖向')}
                </span>
                <small>
                  {size.width}×{size.height}
                </small>
              </>
            ),
          })),
        ]}
        disabled={disabled}
        onChange={(value) => {
          if (value === 'auto') {
            onOptions({ ...options, size: 'auto' });
            return;
          }
          const [w, h] = value.split('x').map(Number);
          onSize(w!, h!);
        }}
      />
      {!c?.size.allowedSizes && (
        <Disclosure title={t('自定义尺寸')} summary={width + ' × ' + height} role="ai-options">
          <div className="ai-dimension-fields">
            <label>
              {t('宽度')}
              <small>px</small>
              <input
                aria-label={t('宽度')}
                type="number"
                inputMode="numeric"
                value={width || ''}
                min={Math.ceil((model?.minWidth ?? 64) / step) * step}
                max={Math.floor(Math.min(model?.maxWidth ?? 8192, maxDimension) / step) * step}
                step={step}
                disabled={disabled}
                onChange={(event) => onSize(Number(event.target.value), height)}
              />
            </label>
            <label>
              {t('高度')}
              <small>px</small>
              <input
                aria-label={t('高度')}
                type="number"
                inputMode="numeric"
                value={height || ''}
                min={Math.ceil((model?.minHeight ?? 64) / step) * step}
                max={Math.floor(Math.min(model?.maxHeight ?? 8192, maxDimension) / step) * step}
                step={step}
                disabled={disabled}
                onChange={(event) => onSize(width, Number(event.target.value))}
              />
            </label>
          </div>
          {choices.length > 3 && (
            <OptionChips
              label={t('常用生成尺寸')}
              value={width + 'x' + height}
              options={choices.slice(3).map((size) => ({
                value: size.width + 'x' + size.height,
                label: size.width + ' × ' + size.height,
              }))}
              disabled={disabled}
              onChange={(value) => {
                const [w, h] = value.split('x').map(Number);
                onSize(w!, h!);
              }}
            />
          )}
        </Disclosure>
      )}
      {sizeError && (
        <p className="parameter-error" role="status">
          {sizeError}
        </p>
      )}
      {renderField('quality', '质量')}
      {c?.n.supported && (c.n.max ?? 1) > 1 && (
        <label className="ai-numeric-setting">
          <span>
            {t('输出数量')}
            <small>{t('张')}</small>
          </span>
          <input
            aria-label={t('输出数量')}
            type="number"
            inputMode="numeric"
            value={options.n ?? 1}
            min={c.n.min ?? 1}
            max={options.stream || svg ? 1 : (c.n.max ?? 1)}
            step={1}
            disabled={disabled || options.stream || svg}
            onChange={(event) => onOptions({ ...options, n: Number(event.target.value) })}
          />
        </label>
      )}
      {hasAdvancedOptions && (
        <Disclosure title={copy.more} role="ai-options" className="image-advanced-options">
          {renderField('background', '背景')}
          {renderField('outputFormat', '供应商编码')}
          {renderField('complexity', '复杂度')}
          {svg && (
            <div className="parameter-row">
              {authors.length > 0 && (
                <label className="ai-numeric-setting">
                  <span>{t('SVG 作者模型')}</span>
                  <select value={options.svg?.model ?? ''} disabled={disabled}
                    onChange={(event) => onOptions({ ...options, svg: { model: event.target.value } })}>
                    {authors.map((author) => <option key={author.id} value={author.id}>{author.id}</option>)}
                  </select>
                </label>
              )}
              {!!selectedAuthor?.efforts.length && (
                <label className="ai-numeric-setting">
                  <span>{t('SVG 作者推理强度')}</span>
                  <select value={options.svg?.reasoning?.effort ?? ''} disabled={disabled}
                    onChange={(event) => {
                      const author = openAISvgAuthorSchema.parse({
                        model: selectedAuthor.id,
                        ...(event.target.value ? { reasoning: { effort: event.target.value } } : {}),
                      });
                      onOptions({ ...options, svg: author });
                    }}>
                    <option value="">{t('使用官方默认')}</option>
                    {selectedAuthor.efforts.map((effort) => <option key={effort}>{effort}</option>)}
                  </select>
                </label>
              )}
              <p className="fine-print">{t('SVG 为单张文字生图。结果可下载矢量文件，工作台使用可编辑的 PNG 副本。')}</p>
            </div>
          )}
          {gif && (
            <div className="parameter-row">
              {([
                ['frameCount', 'GIF 帧数', gifFrameCount],
                ['frameDurationMs', '每帧停留时间（毫秒）', gifFrameDelay],
              ] as const).map(([field, label, range]) => (
                <label key={field} className="ai-numeric-setting">
                  <span>{t(label)}</span>
                  <input type="number" min={range.min} max={range.max} step={1} disabled={disabled}
                    value={options[field] ?? range.default}
                    onChange={(event) => onOptions({ ...options, [field]: event.target.valueAsNumber })}
                  />
                </label>
              ))}
              <p className="fine-print">{t('GIF 逐帧审核，按帧数预留服务点，停留时间按 10 毫秒取整。')}</p>
            </div>
          )}
          {c?.stream.supported && !svg && !gif && (
            <>
              <CheckControl
                label={t('使用 OpenAI 流式生成')}
                checked={options.stream === true}
                disabled={disabled}
                onChange={(event) =>
                  onOptions(
                    event.target.checked
                      ? { ...options, stream: true, n: 1 }
                      : { ...options, stream: undefined, partialImages: undefined },
                  )
                }
              />
              {options.stream && c.partialImages.supported && (
                <label className="ai-numeric-setting">
                  <span>{t('供应商部分图数量（0–3）')}</span>
                  <input
                    type="number"
                    min={0}
                    max={3}
                    step={1}
                    disabled={disabled}
                    value={options.partialImages ?? 0}
                    onChange={(event) =>
                      onOptions({ ...options, partialImages: event.target.valueAsNumber })
                    }
                  />
                </label>
              )}
              {options.stream && c.partialImages.supported && (
                <p className="fine-print">
                  {t('部分图审核通过后实时展示，每张按当前单张点数预留。')}
                </p>
              )}
            </>
          )}
          {c?.moderation?.supported && (
            <div className="parameter-row">
              <div className="parameter-label">{t('OpenAI 内容审核')}</div>
              <OptionChips
                label={t('OpenAI 内容审核')}
                value={options.moderation ?? 'auto'}
                disabled={disabled}
                options={(c.moderation.values ?? []).map((value) => ({
                  value,
                  label: t(names[value] ?? value),
                }))}
                onChange={(moderation) => onOptions({ ...options, moderation })}
              />
            </div>
          )}
          {hasReference && c?.inputFidelity.supported && (
            <div className="parameter-row">
              <div className="parameter-label">{t('输入保真度')}</div>
              <OptionChips
                label={t('输入保真度')}
                value={options.inputFidelity ?? 'low'}
                disabled={disabled}
                options={(c.inputFidelity.values ?? []).map((value) => ({
                  value,
                  label: t(names[value] ?? value),
                }))}
                onChange={(inputFidelity) => onOptions({ ...options, inputFidelity })}
              />
            </div>
          )}
          {linkedChange?.modelId === model.id &&
            linkedChange.background === options.background &&
            linkedChange.format === options.outputFormat && (
              <p className="image-linked-setting" role="status">
                {linkedChange.field === 'background' ? copy.linkedBackground : copy.linkedFormat}
              </p>
            )}
          {c?.outputCompression.supported &&
            c.outputCompression.formats?.includes(options.outputFormat ?? 'png') && (
              <div className="parameter-row">
                <label className="ai-numeric-setting">
                  <span>
                    {t('编码质量')}
                    <small>%</small>
                  </span>
                  <input
                    aria-label={t('编码质量')}
                    type="number"
                    inputMode="numeric"
                    value={options.outputCompression ?? 100}
                    min={c.outputCompression.min ?? 0}
                    max={c.outputCompression.max ?? 100}
                    step={1}
                    disabled={disabled}
                    onChange={(event) =>
                      onOptions({ ...options, outputCompression: Number(event.target.value) })
                    }
                  />
                </label>
              </div>
            )}
        </Disclosure>
      )}
      {batchError && (
        <p className="parameter-error" role="status">
          {batchError}
        </p>
      )}
      {optionError && (
        <p className="parameter-error" role="alert">
          {optionError}
        </p>
      )}
      <Disclosure title={copy.limits} role="capability" className="image-capability-details">
        <dl className="capability-list">
          <div>
            <dt>{copy.dimensions}</dt>
            <dd>
              {t('尺寸步进 {step} px；可用范围以当前模型为准。', { step })}
              {c?.size.reason && <p>{t(c.size.reason)}</p>}
            </dd>
          </div>
          {c?.outputFormat.supported && (
            <div>
              <dt>{copy.encoding}</dt>
              <dd>{copy.encodingHint}</dd>
            </div>
          )}
          {fields
            .filter(([field]) => !c?.[field].supported)
            .map(([field, label]) => (
              <div key={field}>
                <dt>{t(label)}</dt>
                <dd>{t(c?.[field].reason ?? '服务未开放此参数')}</dd>
              </div>
            ))}
          {Object.entries(capabilityNames).map(([field, label]) => {
            const capability = c?.[field as keyof typeof capabilityNames];
            return (
              <div key={field}>
                <dt>{t(label)}</dt>
                <dd>
                  {t(
                    capability?.reason ??
                      (capability?.supported ? '当前模型已开放' : '当前适配器未开放'),
                  )}
                </dd>
              </div>
            );
          })}
          <div>
            <dt>{t('生成范围')}</dt>
            <dd>
              {t('{min}–{max} 百万像素，单边上限 {dimension} px', {
                min: ((model?.minPixels ?? 0) / 1e6).toFixed(2),
                max: ((model?.maxPixels ?? 0) / 1e6).toFixed(2),
                dimension: model?.maxDimension ?? t('待读取'),
              })}
            </dd>
          </div>
          <div>
            <dt>{t('参考图')}</dt>
            <dd>
              {c?.references.supported
                ? t('最多 {count} 张；遮罩{mask}；标注图{markup}', {
                    count: c.references.maxCount,
                    mask: c.references.allowMask ? t('可用') : t('未开放'),
                    markup: c.references.allowMarkup ? t('可用') : t('未开放'),
                  })
                : t('当前模型未开放参考图')}
            </dd>
          </div>
          {c?.dependencies.map((dependency) => (
            <div key={dependency.field + dependency.requires}>
              <dt>{t('参数联动')}</dt>
              <dd>{t(dependency.reason)}</dd>
            </div>
          ))}
        </dl>
      </Disclosure>
    </div>
  );
}
