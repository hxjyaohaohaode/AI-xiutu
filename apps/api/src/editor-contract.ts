import type { FastifyInstance } from 'fastify';
import {
  TOOLS,
  V2_TOOLS,
  V3_TOOLS,
  MAX_V3_PIXELS,
  MAX_TILED_DIMENSION,
  localEditorSourceLimits,
} from '@ai-xiutu/editor';
import { numericParameterSchema, type NumericParameterDescriptor } from '@ai-xiutu/contracts';

/** Derived from actual executable registries, never a second editable copy of
 * ranges/steps. New kernels must register a schema version and explicit scopes. */
export function editorParameterContract(): NumericParameterDescriptor[] {
  return [
    ...TOOLS.map((tool) => ({
      path: `adjustments.${tool.id}`,
      label: tool.label,
      group: tool.group,
      unit: tool.unit,
      minimum: tool.min,
      maximum: tool.max,
      step: tool.step,
      neutral: tool.neutral,
      integer: false,
      stepPolicy: 'interaction-increment' as const,
      schemaVersions: [1, 2, 3, 4],
      scopes: ['global', 'region', 'group'] as const,
      aiWritable: true,
      description: tool.description,
      scopeMinimumVersion: { global: 1, region: 1, group: 3 },
    })),
    ...V2_TOOLS.map((tool) => ({
      path: tool.path,
      label: tool.label,
      group: tool.group,
      unit: tool.unit,
      minimum: tool.min,
      maximum: tool.max,
      step: tool.step,
      neutral: tool.neutral,
      integer: tool.unit === 'px' || tool.unit === 'seed',
      stepPolicy: 'interaction-increment' as const,
      schemaVersions: [2, 3, 4],
      scopes: ['global', 'region', 'group'] as const,
      aiWritable: true,
      description: tool.description,
      scopeMinimumVersion: { global: 2, region: 3, group: 3 },
    })),
    ...V3_TOOLS.map((tool) => ({
      path: tool.path,
      label: tool.label,
      group: tool.group,
      unit: tool.unit,
      minimum: tool.min,
      maximum: tool.max,
      step: tool.step,
      neutral: tool.neutral,
      integer: false,
      stepPolicy: 'interaction-increment' as const,
      schemaVersions: [3, 4],
      scopes: tool.group === 'transform' ? ['global'] : ['global', 'region', 'group'],
      aiWritable: false,
      description: tool.description,
      scopeMinimumVersion:
        tool.group === 'transform' ? { global: 3 } : { global: 3, region: 3, group: 3 },
    })),
  ].map((value) => numericParameterSchema.parse(value));
}

export function registerEditorContract(app: FastifyInstance) {
  const parameters = editorParameterContract();
  app.get('/v1/editor-contract', async () => ({
    protocolVersion: 1,
    recipeVersions: [
      { schemaVersion: 1, engineVersion: '1.0.0' },
      { schemaVersion: 2, engineVersion: '2.0.0' },
      { schemaVersion: 3, engineVersion: '3.0.0' },
      { schemaVersion: 4, engineVersion: '4.0.0' },
    ],
    preferredRecipeVersion: 4,
    coordinates: 'source-normalized',
    colorEncoding: 'rgba8-srgb',
    parameters,
    curves: {
      interpolation: ['linear', 'pchip-v1'],
      defaultForSavedRecipes: 'linear',
      maxControlPoints: 16,
    },
    limits: {
      v3MaxPixels: MAX_V3_PIXELS,
      localSourceByVersion: Object.fromEntries(
        ([1, 2, 3, 4] as const).map((version) => [version, localEditorSourceLimits(version)]),
      ),
      serverRevisionRaster: { maxPixels: MAX_V3_PIXELS, maxDimension: MAX_TILED_DIMENSION },
    },
    notes: [
      '区域和分组中的完整色彩参数需要 Recipe v3；v1/v2 局部仅基础13项',
      '当前AI白名单仅全局13+52数值，几何、人物、图层、形变必须人工确认的编辑路径',
    ],
  }));
}
