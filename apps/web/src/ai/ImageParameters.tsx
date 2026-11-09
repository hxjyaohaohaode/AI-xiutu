import type { AIModel, ImageOptions } from './types';
import {
  allowedImageSizes,
  imageOptionsError,
  imageSizeError,
  imageBatchError,
} from './capabilities';
import { Disclosure, OptionChips, ValueSlider } from '../components/Controls';

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
      <div className="parameter-label">画幅与尺寸</div>
      <OptionChips
        label="常用生成尺寸"
        value={width + 'x' + height}
        options={choices.map((size) => ({
          value: size.width + 'x' + size.height,
          label: (
            <>
              <span>
                {size.width === size.height ? '方形' : size.width > size.height ? '横向' : '竖向'}
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
        <Disclosure title="自定义尺寸" summary={width + ' × ' + height} role="ai-options">
          <ValueSlider
            label="宽度"
            value={width}
            min={Math.ceil((model?.minWidth ?? 64) / step) * step}
            max={Math.floor(Math.min(model?.maxWidth ?? 8192, maxDimension) / step) * step}
            step={step}
            unit=" px"
            disabled={disabled}
            onChange={(value) => onSize(value, height)}
          />
          <ValueSlider
            label="高度"
            value={height}
            min={Math.ceil((model?.minHeight ?? 64) / step) * step}
            max={Math.floor(Math.min(model?.maxHeight ?? 8192, maxDimension) / step) * step}
            step={step}
            unit=" px"
            disabled={disabled}
            onChange={(value) => onSize(width, value)}
          />
          <p className="control-note">仅发送符合当前模型像素、比例和步进要求的尺寸。</p>
        </Disclosure>
      )}
      {sizeError && (
        <p className="parameter-error" role="status">
          {sizeError}
        </p>
      )}
      {c?.size.reason && <p className="control-note">{c.size.reason}</p>}
      {fields.map(([field, label]) => {
        const capability = c?.[field];
        if (!capability?.supported) return null;
        return (
          <div className="parameter-row" key={field}>
            <div className="parameter-label">{label}</div>
            <OptionChips
              label={label}
              value={options[field] ?? ''}
              options={(capability.values ?? []).map((value) => ({
                value,
                label: names[value] ?? value,
                disabled:
                  field === 'background' &&
                  value === 'transparent' &&
                  options.outputFormat === 'jpeg',
                reason:
                  field === 'background' &&
                  value === 'transparent' &&
                  options.outputFormat === 'jpeg'
                    ? 'JPEG 不支持透明背景'
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
            {capability.reason && <p className="control-note">{capability.reason}</p>}
          </div>
        );
      })}
      {c?.n.supported && (c.n.max ?? 1) > 1 && (
        <ValueSlider
          label="输出数量"
          value={options.n ?? 1}
          min={c.n.min ?? 1}
          max={c.n.max ?? 1}
          unit=" 张"
          disabled={disabled}
          onChange={(n) => onOptions({ ...options, n })}
        />
      )}
      {c?.outputCompression.supported && (
        <div className="parameter-row">
          {c.outputCompression.formats?.includes(options.outputFormat ?? 'png') ? (
            <ValueSlider
              label="编码质量"
              value={options.outputCompression ?? 100}
              min={c.outputCompression.min ?? 0}
              max={c.outputCompression.max ?? 100}
              unit="%"
              disabled={disabled}
              onChange={(outputCompression) => onOptions({ ...options, outputCompression })}
            />
          ) : (
            <p className="control-note">压缩参数仅适用于 JPEG / WebP；PNG 不发送此项。</p>
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
          这里选择供应商编码；项目内素材统一规范化为 PNG。下载时可再选本地导出格式。
        </p>
      )}
      <Disclosure title="能力与限制" summary="按当前模型" role="capability">
        <dl className="capability-list">
          {fields
            .filter(([field]) => !c?.[field].supported)
            .map(([field, label]) => (
              <div key={field}>
                <dt>{label}</dt>
                <dd>{c?.[field].reason ?? '服务未开放此参数'}</dd>
              </div>
            ))}
          {Object.entries(capabilityNames).map(([field, label]) => {
            const capability = c?.[field as keyof typeof capabilityNames];
            return (
              <div key={field}>
                <dt>{label}</dt>
                <dd>
                  {capability?.supported
                    ? '当前模型已开放'
                    : (capability?.reason ?? '当前适配器未开放')}
                </dd>
              </div>
            );
          })}
          <div>
            <dt>生成范围</dt>
            <dd>
              {((model?.minPixels ?? 0) / 1e6).toFixed(2)}–
              {((model?.maxPixels ?? 0) / 1e6).toFixed(2)} 百万像素，单边上限{' '}
              {model?.maxDimension ?? '待读取'} px
            </dd>
          </div>
          <div>
            <dt>参考图</dt>
            <dd>
              {c?.references.supported
                ? '最多 ' +
                  c.references.maxCount +
                  ' 张；遮罩' +
                  (c.references.allowMask ? '可用' : '未开放') +
                  '；标注图' +
                  (c.references.allowMarkup ? '可用' : '未开放')
                : '当前模型未开放参考图'}
            </dd>
          </div>
          {c?.dependencies.map((dependency) => (
            <div key={dependency.field + dependency.requires}>
              <dt>参数联动</dt>
              <dd>{dependency.reason}</dd>
            </div>
          ))}
        </dl>
      </Disclosure>
    </div>
  );
}
