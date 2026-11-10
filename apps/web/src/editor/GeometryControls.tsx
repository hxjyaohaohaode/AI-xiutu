import {
  ArrowCounterClockwise,
  ArrowClockwise,
  ArrowsLeftRight,
  ArrowsDownUp,
} from '@phosphor-icons/react';
import { createFineTransformV3 } from '@ai-xiutu/editor';
import { cropFromPixels } from './precision';
import {
  NUMERIC_CONTROLS,
  currentV3,
  numericAt,
  withNumeric,
  type InspectorController,
} from './advanced-model';
import { ParameterShelf, type ShelfControl } from './ParameterShelf';
import { ProjectiveControls } from './ProjectiveControls';

export function GeometryControls({ controller }: { controller: InspectorController }) {
  const { editor, apply, report } = controller,
    recipe = currentV3(editor);
  const dimensions = editor.dimensions ?? { width: 1, height: 1 };
  const tab = editor.geometryMode,
    setTab = editor.setGeometryMode;
  function pixelRect() {
    const crop = currentV3(editor).geometry.crop;
    if (!crop) return { x: 0, y: 0, width: dimensions.width, height: dimensions.height };
    return {
      x: Math.floor(crop.x * dimensions.width),
      y: Math.floor(crop.y * dimensions.height),
      width:
        Math.ceil((crop.x + crop.width) * dimensions.width) - Math.floor(crop.x * dimensions.width),
      height:
        Math.ceil((crop.y + crop.height) * dimensions.height) -
        Math.floor(crop.y * dimensions.height),
    };
  }
  function setPixel(key: 'x' | 'y' | 'width' | 'height', value: number) {
    const current = currentV3(editor),
      pixels = { ...pixelRect(), [key]: value };
    apply(
      { ...current, geometry: { ...current.geometry, crop: cropFromPixels(dimensions, pixels) } },
      '调整裁切' + key,
    );
  }
  const rect = pixelRect();
  const cropControls: ShelfControl[] = (
    [
      ['width', '裁切宽度', 1, dimensions.width - rect.x],
      ['height', '裁切高度', 1, dimensions.height - rect.y],
      ['x', '左边界', 0, dimensions.width - 1],
      ['y', '上边界', 0, dimensions.height - 1],
    ] as const
  ).map(([key, label, min, max]) => ({
    id: key,
    label,
    value: rect[key],
    min,
    max,
    step: 1,
    integer: true,
    unit: 'px',
    onChange: (value: number) => setPixel(key, value),
  }));
  const transformControls = NUMERIC_CONTROLS.filter(
    (tool) =>
      tool.path.startsWith('transform.') &&
      (tab === 'placement'
        ? /scale|translate/.test(tool.path)
        : !/scale|translate/.test(tool.path)),
  ).map((tool) => ({
    id: tool.path,
    ...tool,
    value: numericAt(recipe, tool.path),
    onChange: (value: number) => {
      try {
        apply(withNumeric(currentV3(editor), tool, value), '调整' + tool.label);
      } catch (error) {
        report(error instanceof Error ? error.message : '参数组合不可用。');
      }
    },
    onReset: () =>
      apply(withNumeric(currentV3(editor), tool, tool.neutral), '重置' + tool.label, true),
  }));
  function ratio(value: number) {
    const latest = currentV3(editor),
      rect = pixelRect();
    let width = rect.width,
      height = width / value;
    if (height > rect.height) {
      height = rect.height;
      width = height * value;
    }
    const x = rect.x + (rect.width - width) / 2,
      y = rect.y + (rect.height - height) / 2;
    apply(
      {
        ...latest,
        geometry: {
          ...latest.geometry,
          crop: cropFromPixels(dimensions, {
            x,
            y,
            width: Math.max(1, width),
            height: Math.max(1, height),
          }),
        },
      },
      '按比例建立裁切起点',
      true,
    );
  }
  return (
    <section className="advanced-tool-family" data-motion="geometry-controls">
      <div className="tonal-tabs" aria-label="构图类别">
        {(
          [
            ['crop', '自由裁切'],
            ['transform', '角度与透视'],
            ['projective', '自由四角'],
            ['placement', '缩放与位置'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            aria-pressed={tab === id}
            onClick={() => {
              editor.commitCurrent('完成当前构图');
              setTab(id);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'crop' ? (
        <>
          <p className="control-note">
            直接拖动照片上的边角，或按原图像素调整。比例按钮只提供起点，不锁定后续尺寸。
          </p>
          <ParameterShelf
            label="任意像素裁切"
            controls={cropControls}
            onCommit={(name) => editor.commitCurrent('调整' + name)}
            onCancel={editor.cancelPreview}
          />
          <div className="tonal-tabs" aria-label="裁切比例起点">
            {(
              [
                ['1:1', 1],
                ['4:5', 0.8],
                ['3:2', 1.5],
                ['16:9', 16 / 9],
                ['9:16', 9 / 16],
              ] as const
            ).map(([label, value]) => (
              <button key={label} onClick={() => ratio(value)}>
                {label}
              </button>
            ))}
          </div>
          <button
            className="text-button"
            disabled={!recipe.geometry.crop}
            onClick={() =>
              apply(
                { ...recipe, geometry: { ...recipe.geometry, crop: null } },
                '恢复完整裁切范围',
                true,
              )
            }
          >
            恢复完整画幅
          </button>
        </>
      ) : tab === 'projective' ? (
        <ProjectiveControls controller={controller} />
      ) : (
        <ParameterShelf
          key={tab}
          label="自由构图变换"
          controls={transformControls}
          onCommit={(name) => editor.commitCurrent('调整' + name)}
          onCancel={editor.cancelPreview}
        />
      )}
      <div className="tonal-tabs" aria-label="画幅与方向">
        <button
          onClick={() =>
            apply(
              {
                ...recipe,
                geometry: {
                  ...recipe.geometry,
                  rotation: ((recipe.geometry.rotation + 270) % 360) as 0 | 90 | 180 | 270,
                },
              },
              '向左旋转90度',
              true,
            )
          }
        >
          <ArrowCounterClockwise size={16} />
          90°
        </button>
        <button
          onClick={() =>
            apply(
              {
                ...recipe,
                geometry: {
                  ...recipe.geometry,
                  rotation: ((recipe.geometry.rotation + 90) % 360) as 0 | 90 | 180 | 270,
                },
              },
              '向右旋转90度',
              true,
            )
          }
        >
          <ArrowClockwise size={16} />
          90°
        </button>
        <button
          aria-pressed={recipe.geometry.flipX}
          onClick={() =>
            apply(
              { ...recipe, geometry: { ...recipe.geometry, flipX: !recipe.geometry.flipX } },
              '水平镜像',
              true,
            )
          }
        >
          <ArrowsLeftRight size={16} />
          镜像
        </button>
        <button
          aria-pressed={recipe.geometry.flipY}
          onClick={() =>
            apply(
              { ...recipe, geometry: { ...recipe.geometry, flipY: !recipe.geometry.flipY } },
              '垂直镜像',
              true,
            )
          }
        >
          <ArrowsDownUp size={16} />
          翻转
        </button>
      </div>
      <label className="advanced-select">
        变换后的画幅
        <select
          aria-label="变换后的画幅"
          value={recipe.transform.fit}
          onChange={(event) =>
            apply(
              {
                ...recipe,
                transform: { ...recipe.transform, fit: event.target.value as 'contain' | 'crop' },
              },
              '选择变换画幅',
              true,
            )
          }
        >
          <option value="contain">包含完整变换结果</option>
          <option value="crop">保留原来画幅</option>
        </select>
      </label>
      <p className="control-note">
        超出原图的部分保持透明；需要真实补画内容时可交给 AI
        扩图，再明确采用候选。组合变换无效或超过内存预算时保留上一个有效结果。
      </p>
      <button
        className="text-button"
        onClick={() =>
          apply({ ...recipe, transform: createFineTransformV3() }, '重置精细构图变换', true)
        }
      >
        重置角度、透视和位移
      </button>
    </section>
  );
}
