import { t } from '../i18n';
import { ChoiceSelect } from '../components/ChoiceSelect';
import {
  ArrowCounterClockwise,
  ArrowClockwise,
  ArrowsLeftRight,
  ArrowsDownUp,
  Crop,
  Perspective,
  FrameCorners,
  ArrowsOutCardinal,
  ArrowsClockwise,
  CompassTool,
} from '@phosphor-icons/react';
import {
  createFineTransformV3,
  createRecipeV4,
  fitOrientedCrop,
  orientGeometry,
  orientedCropSpace,
  pixelCrop,
  type OrientationAction,
} from '@ai-xiutu/editor';
import { cropFromPixels, moveCropHandle } from './precision';
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
  const cropSpace = orientedCropSpace(dimensions, recipe.geometry);
  const { left: x, top: y, width, height } = cropSpace.crop;
  const rect = { x, y, width, height };
  function setPixel(key: 'x' | 'y' | 'width' | 'height', value: number) {
    const current = currentV3(editor);
    const space = orientedCropSpace(dimensions, current.geometry);
    const { left: x, top: y, width, height } = space.crop;
    const rect = { x, y, width, height };
    const visibleCrop =
      key === 'x' || key === 'y'
        ? moveCropHandle(
            space.dimensions,
            rect,
            'move',
            { x: key === 'x' ? value - rect.x : 0, y: key === 'y' ? value - rect.y : 0 },
            null,
          )
        : moveCropHandle(
            space.dimensions,
            rect,
            key === 'width' ? 'e' : 's',
            {
              x: key === 'width' ? value - rect.width : 0,
              y: key === 'height' ? value - rect.height : 0,
            },
            editor.cropRatio,
          );
    const sourceCrop = space.toSource(
      pixelCrop(space.dimensions, { ...current.geometry, crop: visibleCrop }),
    );
    const crop = cropFromPixels(dimensions, {
      ...sourceCrop,
      x: sourceCrop.left,
      y: sourceCrop.top,
    });
    apply({ ...current, geometry: { ...current.geometry, crop } }, t('调整裁切'));
  }
  const cropControls: ShelfControl[] = (
    [
      ['width', t('裁切宽度'), 1, cropSpace.dimensions.width - rect.x],
      ['height', t('裁切高度'), 1, cropSpace.dimensions.height - rect.y],
      ['x', t('左边界'), 0, cropSpace.dimensions.width - rect.width],
      ['y', t('上边界'), 0, cropSpace.dimensions.height - rect.height],
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
  function ratio(value: number | null, label: string) {
    if (value === null) {
      editor.setCropRatio(null);
      return;
    }
    const latest = currentV3(editor);
    const { left: x, top: y, width, height } = fitOrientedCrop(dimensions, latest.geometry, value);
    if (
      apply(
        {
          ...latest,
          geometry: {
            ...latest.geometry,
            crop: cropFromPixels(dimensions, { x, y, width, height }),
          },
        },
        t('裁切比例 {v0}', { v0: label }),
        true,
      )
    )
      editor.setCropRatio(value);
  }
  function orient(action: OrientationAction, label: string) {
    const current = currentV3(editor);
    const geometry = orientGeometry(current.geometry, action);
    if (!apply({ ...current, geometry }, label, true)) return;
    if (editor.cropRatio !== null && (current.geometry.rotation - geometry.rotation) % 180 !== 0)
      editor.setCropRatio(1 / editor.cropRatio);
  }
  const originalRatio =
    recipe.geometry.rotation % 180 === 0
      ? dimensions.width / dimensions.height
      : dimensions.height / dimensions.width;
  return (
    <section className="advanced-tool-family" data-motion="geometry-controls">
      <div className="tonal-tabs" aria-label={t('构图类别')}>
        {(
          [
            ['crop', t('裁切'), Crop],
            ['transform', t('角度与透视'), Perspective],
            ['projective', t('自由四角'), FrameCorners],
            ['placement', t('缩放与位置'), ArrowsOutCardinal],
          ] as const
        ).map(([id, label, Glyph]) => (
          <button
            key={id}
            aria-pressed={tab === id}
            onClick={() => {
              editor.commitCurrent(t('完成当前构图'));
              setTab(id);
            }}
          >
            <Glyph size={16} /> {label}
          </button>
        ))}
      </div>
      {tab === 'crop' ? (
        <>
          <ParameterShelf
            label={t('任意像素裁切')}
            controls={cropControls}
            onCommit={(name) => editor.commitCurrent(t('调整{v0}', { v0: t(name) }))}
            onCancel={editor.cancelPreview}
          />
          <div className="tonal-tabs" aria-label={t('裁切比例')}>
            {(
              [
                [t('自由'), null],
                [t('原图'), originalRatio],
                ['1:1', 1],
                ['4:5', 0.8],
                ['4:3', 4 / 3],
                ['3:2', 1.5],
                ['2:3', 2 / 3],
                ['3:4', 0.75],
                ['16:9', 16 / 9],
                ['9:16', 9 / 16],
              ] as const
            ).map(([label, value]) => (
              <button
                key={label}
                aria-pressed={editor.cropRatio === value}
                onClick={() => ratio(value, label)}
              >
                {label}
              </button>
            ))}
          </div>
          <ChoiceSelect
            ariaLabel={t('构图参考线')}
            size="compact"
            value={editor.cropGuide}
            options={[
              { value: 'thirds', label: t('三分线') },
              { value: 'golden', label: t('黄金分割') },
              { value: 'center', label: t('中心十字') },
              { value: 'diagonal', label: t('对角线') },
              { value: 'none', label: t('无参考线') },
            ]}
            onValueChange={(value) => editor.setCropGuide(value as typeof editor.cropGuide)}
          />
          <button
            className="text-button"
            disabled={!recipe.geometry.crop}
            onClick={() => {
              if (
                apply(
                  { ...recipe, geometry: { ...recipe.geometry, crop: null } },
                  t('恢复完整裁切范围'),
                  true,
                )
              )
                editor.setCropRatio(null);
            }}
          >
            {t('恢复完整画幅')}
          </button>
        </>
      ) : tab === 'projective' ? (
        <ProjectiveControls controller={controller} />
      ) : (
        <ParameterShelf
          key={tab}
          label={t('自由构图变换')}
          controls={transformControls}
          onCommit={(name) => editor.commitCurrent(t('调整{v0}', { v0: t(name) }))}
          onCancel={editor.cancelPreview}
        />
      )}
      <div className="tonal-tabs" aria-label={t('画幅与方向')}>
        <button aria-label={t('向左旋转90度')} onClick={() => orient('left', t('向左旋转90度'))}>
          <ArrowCounterClockwise size={16} />
          {t('左转')}
        </button>
        <button aria-label={t('向右旋转90度')} onClick={() => orient('right', t('向右旋转90度'))}>
          <ArrowClockwise size={16} />
          {t('右转')}
        </button>
        <button aria-label={t('旋转180度')} onClick={() => orient('half-turn', t('旋转180度'))}>
          <ArrowsClockwise size={16} /> 180°
        </button>
        <button
          aria-pressed={recipe.geometry.flipX}
          aria-label={t('水平镜像')}
          onClick={() => orient('mirror', t('水平镜像'))}
        >
          <ArrowsLeftRight size={16} />
          {t('镜像')}
        </button>
        <button
          aria-pressed={recipe.geometry.flipY}
          aria-label={t('垂直翻转')}
          onClick={() => orient('flip', t('垂直翻转'))}
        >
          <ArrowsDownUp size={16} />
          {t('翻转')}
        </button>
        <button
          onClick={() => orient('reset', t('恢复原图方向'))}
          disabled={!recipe.geometry.rotation && !recipe.geometry.flipX && !recipe.geometry.flipY}
        >
          <CompassTool size={16} /> {t('原方向')}
        </button>
      </div>
      <label className="advanced-select">
        {t('变换后的画幅')}
        <ChoiceSelect
          ariaLabel={t('变换后的画幅')}
          size="compact"
          value={recipe.transform.fit}
          onValueChange={(value) =>
            apply(
              { ...recipe, transform: { ...recipe.transform, fit: value as 'contain' | 'crop' } },
              t('选择变换画幅'),
              true,
            )
          }
          options={[
            { value: 'contain', label: t('包含完整变换结果') },
            { value: 'crop', label: t('保留原来画幅') },
          ]}
        />
      </label>
      <button
        className="text-button"
        onClick={() => {
          const current = currentV3(editor);
          const next = {
            ...current,
            geometry: { crop: null, rotation: 0 as const, flipX: false, flipY: false },
            transform: createFineTransformV3(),
            ...(current.schemaVersion === 4 ? { projective: createRecipeV4().projective } : {}),
          };
          if (apply(next, t('重置构图'), true)) editor.setCropRatio(null);
        }}
      >
        {t('重置构图')}
      </button>
    </section>
  );
}
