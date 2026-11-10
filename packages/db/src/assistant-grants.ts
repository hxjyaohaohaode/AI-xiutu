import type { Queryable } from './index.js';
import { QuotaError } from './quota.js';

export type AssistantAction = 'assistant-turn' | 'realtime-voice' | 'edit' | 'generate-image';
export interface GrantClaim {
  grantId: string;
  actorId: string;
  projectId: string;
  key: string;
  action: AssistantAction;
  modelId: string;
  units: number;
  automatic?: boolean;
}
export async function assertAssistantGrant(
  tx: Queryable,
  grantId: string,
  actorId: string,
  projectId: string,
  lock = false,
  modelId?: string,
) {
  const row = (
    await tx.query(
      'SELECT mode,model_ids FROM assistant_grants WHERE id=$1 AND actor_id=$2 AND project_id=$3 AND revoked_at IS NULL AND expires_at>clock_timestamp()' +
        (lock ? ' FOR UPDATE' : ''),
      [grantId, actorId, projectId],
    )
  ).rows[0];
  if (!row) throw new QuotaError('ASSISTANT_GRANT_EXPIRED', 'AI 授权已失效，请重新设置执行范围');
  if (modelId && !row.model_ids.includes(modelId))
    throw new QuotaError('ASSISTANT_ACTION_FORBIDDEN', '模型超出本次授权范围');
  return row.mode as 'suggest' | 'confirm' | 'auto';
}
/** Caller uses a transaction and its normal resource/ACL locks before this call. */
export async function claimAssistantGrant(tx: Queryable, claim: GrantClaim): Promise<void> {
  if (!Number.isSafeInteger(claim.units) || claim.units < 0)
    throw new QuotaError('ASSISTANT_BUDGET_INVALID', '授权费用无效');
  const result = await tx.query(
    `SELECT g.*,g.expires_at>clock_timestamp() AS unexpired FROM assistant_grants g
     WHERE g.id=$1 AND g.actor_id=$2 AND g.project_id=$3 FOR UPDATE`,
    [claim.grantId, claim.actorId, claim.projectId],
  );
  const grant = result.rows[0];
  if (!grant || grant.revoked_at || !grant.unexpired)
    throw new QuotaError('ASSISTANT_GRANT_EXPIRED', 'AI 授权已失效，请重新设置执行范围');
  if (
    !Array.isArray(grant.allowed_actions) ||
    !grant.allowed_actions.includes(claim.action) ||
    !Array.isArray(grant.model_ids) ||
    (claim.modelId && !grant.model_ids.includes(claim.modelId)) ||
    (claim.automatic && grant.mode !== 'auto') ||
    (grant.mode === 'suggest' && ['edit', 'generate-image'].includes(claim.action))
  )
    throw new QuotaError('ASSISTANT_ACTION_FORBIDDEN', '这项操作超出了本次 AI 授权范围');
  const existing = (
    await tx.query(
      'SELECT action,model_id,units FROM assistant_grant_claims WHERE grant_id=$1 AND claim_key=$2',
      [claim.grantId, claim.key],
    )
  ).rows[0];
  if (existing) {
    if (
      existing.action !== claim.action ||
      existing.model_id !== claim.modelId ||
      existing.units !== claim.units
    )
      throw new QuotaError('ASSISTANT_CLAIM_CONFLICT', '已执行操作不能更改费用或模型');
    return;
  }
  if (grant.used_units + claim.units > grant.unit_limit || grant.used_steps >= grant.step_limit)
    throw new QuotaError('ASSISTANT_BUDGET_EXHAUSTED', '已达到本次 AI 的点数或操作次数上限');
  await tx.query(
    'INSERT INTO assistant_grant_claims(grant_id,claim_key,action,model_id,units) VALUES($1,$2,$3,$4,$5)',
    [claim.grantId, claim.key, claim.action, claim.modelId, claim.units],
  );
  await tx.query(
    'UPDATE assistant_grants SET used_units=used_units+$2,used_steps=used_steps+1 WHERE id=$1',
    [claim.grantId, claim.units],
  );
}
