import type { ImageCapabilities } from '../ai/types';

export function opsModelFields(
  model: {
    operations?: readonly string[];
    allowedQualities: readonly string[];
    parameterCapabilities?: ImageCapabilities;
  },
  providerCapabilities?: ImageCapabilities,
) {
  const image = !!model.operations?.includes('generate-image');
  const capabilities = providerCapabilities ?? model.parameterCapabilities;
  return {
    image,
    sizes: image && capabilities?.size.supported !== false,
    outputs: image && capabilities?.n.supported !== false && (capabilities?.n.max ?? 10) > 1,
    maxOutputs: Math.min(10, capabilities?.n.max ?? 10),
    maxDimension: Math.min(8192, capabilities?.size.maxDimension ?? 8192),
    qualities: image
      ? capabilities?.quality.supported === false
        ? []
        : [...(capabilities?.quality.values ?? model.allowedQualities)]
      : [],
  };
}

export const auditLabels: Record<string, string> = {
  'operator.quota_view': '查看空间权益',
  'operator.user_invite': '创建用户邀请',
  'operator.user_status': '更新用户状态',
  'operator.config': '更新站点配置',
  'operator.plan_create': '创建权益套餐',
  'operator.plan_version': '更新权益套餐',
  'operator.model_config': '更新模型能力',
  'operator.quota_adjustment': '调整服务点',
  'operator.registration_invite': '创建注册邀请',
  'assistant.model_configured': '更新协作模型',
  'assistant.grant.created': '创建执行授权',
  'assistant.reconciled': '核验协作记录',
};
