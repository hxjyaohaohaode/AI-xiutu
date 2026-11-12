import { t } from '../i18n';
import type { ReactNode } from 'react';
import { MotionDetails } from '../motion/Presence';
import { CropOrientationControls, CropPresetRail } from './CropPresetRail';
import { ChoiceSelect } from '../components/ChoiceSelect';
import { RubberSegment } from '../components/control-motion';
import { Crop, Perspective, FrameCorners, ArrowsOutCardinal } from '../components/ControlGlyph';
import {
  createRecipeV4,
  fitOrientedCrop,
  orientGeometry,
  orientedCropSpace,
  type OrientationAction,
} from '@ai-xiutu/editor';
import { changeOrientedCropPixel, cropFromPixels } from './precision';
import {
  NUMERIC_CONTROLS,
  currentV3,
  numericAt,
  withNumeric,
  type InspectorController,
} from './advanced-model';
import { ParameterShelf, type ShelfControl } from './ParameterShelf';
import { ProjectiveControls } from './ProjectiveControls';

export function GeometryControls({
  controller,
  layoutControl,
  target,
}: {
  controller: InspectorController;
  layoutControl?: ReactNode;
  target?: string;
}) {
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
    const crop = changeOrientedCropPixel(
      dimensions,
      current.geometry,
      key,
      value,
      editor.cropRatio,
    );
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
  const orientation = <CropOrientationControls geometry={recipe.geometry} onChange={orient} />;
  return (
    <section
      className="advanced-tool-family crop-geometry-controls"
      data-motion="geometry-controls"
    >
      <div className="crop-mode-tabs">
        <RubberSegment
          label={t('构图类别')}
          value={tab}
          onChange={(next) => {
            editor.commitCurrent(t('完成当前构图'));
            setTab(next);
          }}
          options={[
            { value: 'crop', label: t('裁切'), icon: <Crop size={16} /> },
            { value: 'transform', label: t('角度'), ariaLabel: t('角度与透视'), icon: <Perspective size={16} /> },
            { value: 'projective', label: t('四角'), ariaLabel: t('自由四角'), icon: <FrameCorners size={16} /> },
            { value: 'placement', label: t('缩放'), ariaLabel: t('缩放与位置'), icon: <ArrowsOutCardinal size={16} /> },
          ]}
        />
        {layoutControl}
      </div>
      {tab === 'crop' ? (
        <>
          <CropPresetRail originalRatio={originalRatio} value={editor.cropRatio} onChange={ratio} />
          {orientation}
          <div className="crop-live-readout">
            <output aria-label={t('裁切像素')}>
              {rect.width} × {rect.height} px
            </output>
            <output aria-label={t('旋转角度')}>{recipe.geometry.rotation}°</output>
          </div>
          <MotionDetails className="advanced-disclosure crop-exact-details">
            <summary>{t('精确裁切')}</summary>
            <ParameterShelf
              label={t('任意像素裁切')}
              controls={cropControls}
              onCommit={(name) => editor.commitCurrent(t('调整{v0}', { v0: t(name) }))}
              onCancel={editor.cancelPreview}
            />
          </MotionDetails>
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
          target={target}
          label={t('自由构图变换')}
          controls={transformControls}
          onCommit={(name) => editor.commitCurrent(t('调整{v0}', { v0: t(name) }))}
          onCancel={editor.cancelPreview}
        />
      )}
      {tab !== 'crop' && orientation}
      {(tab === 'transform' || tab === 'placement') && (
        <RubberSegment<'contain' | 'crop'>
          className="compact-choice-row"
          label={t('变换后的画幅')}
          value={recipe.transform.fit}
          onChange={(fit) => apply({ ...recipe, transform: { ...recipe.transform, fit } }, t('选择变换画幅'), true)}
          options={[
            { value: 'contain', label: t('容纳全部') },
            { value: 'crop', label: t('保留画幅') },
          ]}
        />
      )}
      {tab !== 'crop' && (
        <button
          type="button"
          className="text-button geometry-reset"
          onClick={() => {
            const current = currentV3(editor);
            const next = tab === 'projective' && current.schemaVersion === 4
              ? { ...current, projective: createRecipeV4().projective }
              : NUMERIC_CONTROLS
                .filter((tool) => transformControls.some(({ id }) => id === tool.path))
                .reduce((value, tool) => withNumeric(value, tool, tool.neutral), current);
            apply(next, t('重置当前构图参数'), true);
          }}
        >
          {t('重置当前构图参数')}
        </button>
      )}
    </section>
  );
}
