import { t } from '../i18n';
import type { AIModel, ImageOptions } from './types';
import {
  allowedImageSizes,
  imageOptionsError,
  imageSizeError,
  imageBatchError,
} from './capabilities';
import { Disclosure, OptionChips } from '../components/Controls';

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
  disabled,
  onSize,
  onOptions,
}: {
  model?: AIModel;
  width: number;
  height: number;
  options: ImageOptions;
  disabled: boolean;
  onSize: (width: number, height: number) => void;
  onOptions: (options: ImageOptions) => void;
}) {
  const c = model?.parameterCapabilities;
  const choices = allowedImageSizes(model);
  const sizeError = imageSizeError(model, width, height);
  const batchError = imageBatchError(model, width, height, options);
  const optionError = imageOptionsError(model, options);
  const step = c?.size.multipleOf ?? 1;
  const maxDimension = Math.min(model?.maxDimension ?? 8192, c?.size.maxDimension ?? 8192);
  const fields = [
    ['quality', '质量'],
    ['background', '背景'],
    ['outputFormat', '供应商编码'],
    ['complexity', '复杂度'],
  ] as const;
  return (
    <div className="image-parameters">
      <div className="parameter-label">{t('画幅与尺寸')}</div>
      <OptionChips
        label={t('常用生成尺寸')}
        value={width + 'x' + height}
        options={choices.map((size) => ({
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
        }))}
        disabled={disabled}
        onChange={(value) => {
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
          <p className="control-note">
            {t('尺寸步进 {step} px；可用范围以当前模型为准。', { step })}
          </p>
        </Disclosure>
      )}
      {sizeError && (
        <p className="parameter-error" role="status">
          {sizeError}
        </p>
      )}
      {c?.size.reason && <p className="control-note">{t(c.size.reason)}</p>}
      {fields.map(([field, label]) => {
        const capability = c?.[field];
        if (!capability?.supported) return null;
        return (
          <div className="parameter-row" key={field}>
            <div className="parameter-label">{t(label)}</div>
            <OptionChips
              label={t(label)}
              value={options[field] ?? ''}
              options={(capability.values ?? []).map((value) => ({
                value,
                label: names[value] ? t(names[value]) : value,
                disabled:
                  field === 'background' &&
                  value === 'transparent' &&
                  options.outputFormat === 'jpeg',
                reason:
                  field === 'background' &&
                  value === 'transparent' &&
                  options.outputFormat === 'jpeg'
                    ? t('JPEG 不支持透明背景')
                    : undefined,
              }))}
              disabled={disabled}
              onChange={(value) => {
                const next = { ...options, [field]: value };
                if (
                  field === 'outputFormat' &&
                  value === 'jpeg' &&
                  next.background === 'transparent'
                )
                  next.background = 'opaque';
                onOptions(next);
              }}
            />
            {capability.reason && <p className="control-note">{t(capability.reason)}</p>}
          </div>
        );
      })}
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
            max={c.n.max ?? 1}
            step={1}
            disabled={disabled}
            onChange={(event) => onOptions({ ...options, n: Number(event.target.value) })}
          />
        </label>
      )}
      {c?.outputCompression.supported && (
        <div className="parameter-row">
          {c.outputCompression.formats?.includes(options.outputFormat ?? 'png') ? (
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
          ) : (
            <p className="control-note">{t('压缩参数仅适用于 JPEG / WebP；PNG 不发送此项。')}</p>
          )}
        </div>
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
      {c?.outputFormat.supported && (
        <p className="control-note">
          {t('这里选择供应商编码；项目内素材统一规范化为 PNG。下载时可再选本地导出格式。')}
        </p>
      )}
      <Disclosure title={t('能力与限制')} summary={t('按当前模型')} role="capability">
        <dl className="capability-list">
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
                  {capability?.supported
                    ? t('当前模型已开放')
                    : t(capability?.reason ?? '当前适配器未开放')}
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
