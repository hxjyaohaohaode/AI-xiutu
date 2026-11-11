import { t } from '../i18n';
import { knownNumber } from './model';

/** Public catalog fields only. Provider invoices and actual token receipts are not exposed here. */
export type UsageModelCatalog = {
  executionEnabled: boolean;
  reason?: string | null;
  availableOperations: string[];
  models: {
    id: string;
    label?: string;
    enabled?: boolean;
    operations?: string[];
    pointsPerPlan?: number;
    runtimeAvailable?: boolean;
    runtimeOperations?: string[];
    runtimeReason?: string | null;
    pricing?: {
      unit: 'service-point';
      per: 'image';
      defaultPerImage: number;
      qualityPerImage: Record<string, number>;
    };
    parameterCapabilities?: { quality?: { supported: boolean; values?: string[] } };
  }[];
};
export type UsageAssistantCatalog = {
  ready: boolean;
  voiceReady: boolean;
  reason?: string | null;
  models: {
    id: string;
    label: string;
    operations: string[];
    unitCost: number;
    maxSeconds?: number;
  }[];
};
export type UsageQuote = {
  key: string;
  modelId: string;
  label: string;
  operation: string;
  points: number | null;
  per: string;
  available: boolean;
  reason: string | null;
  qualities: { name: string; points: number | null }[];
  maxSeconds: number | null;
};
const price = (value: unknown) => {
  const number = knownNumber(value);
  return number !== null && Number.isSafeInteger(number) && number >= 0 ? number : null;
};
export function usageQuotes(
  legacy: UsageModelCatalog | null,
  assistant: UsageAssistantCatalog | null,
): UsageQuote[] {
  const rows: UsageQuote[] = [];
  for (const model of legacy?.models ?? []) {
    if (model.enabled === false) continue;
    for (const operation of model.operations ?? ['edit-plan']) {
      const image = operation === 'generate-image';
      const available =
        legacy?.executionEnabled === true &&
        model.runtimeAvailable === true &&
        legacy.availableOperations.includes(operation) &&
        (model.runtimeOperations?.includes(operation) ?? true);
      const imagePricing =
        image && model.pricing?.unit === 'service-point' && model.pricing.per === 'image'
          ? model.pricing
          : null;
      const quality = model.parameterCapabilities?.quality;
      rows.push({
        key: `job:${model.id}:${operation}`,
        modelId: model.id,
        label: model.label || model.id,
        operation,
        points: price(imagePricing?.defaultPerImage ?? model.pointsPerPlan),
        per: image ? '张' : operation === 'transcribe' ? '次转录' : '次',
        available,
        reason: available ? null : model.runtimeReason || legacy?.reason || '当前暂不可用',
        qualities: Object.entries(imagePricing?.qualityPerImage ?? {})
          .filter(
            ([name]) =>
              quality?.supported !== false && (!quality?.values || quality.values.includes(name)),
          )
          .map(([name, points]) => ({ name, points: price(points) })),
        maxSeconds: null,
      });
    }
  }
  for (const model of assistant?.models ?? []) {
    for (const operation of model.operations) {
      if (operation !== 'assistant-turn' && operation !== 'realtime-voice') continue;
      const voice = operation === 'realtime-voice';
      const available = voice ? assistant?.voiceReady === true : assistant?.ready === true;
      rows.push({
        key: `assistant:${model.id}:${operation}`,
        modelId: model.id,
        label: model.label || model.id,
        operation,
        points: price(model.unitCost),
        per: voice ? '次通话' : '轮',
        available,
        reason: available ? null : assistant?.reason || '当前暂不可用',
        qualities: [],
        maxSeconds: voice ? price(model.maxSeconds) : null,
      });
    }
  }
  return rows.sort(
    (a, b) =>
      Number(b.available) - Number(a.available) ||
      a.operation.localeCompare(b.operation) ||
      a.label.localeCompare(b.label),
  );
}

/** A model id may serve two execution families; match the operation before showing a label. */
export function usageModelName(
  quotes: readonly UsageQuote[],
  modelId: string | null,
  operation?: string | null,
) {
  if (!modelId) return t('未记录模型');
  return (
    quotes.find((quote) => quote.modelId === modelId && quote.operation === operation)?.label ??
    modelId
  );
}
