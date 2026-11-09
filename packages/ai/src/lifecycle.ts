import {
  audit,
  emit,
  markUnknownHold,
  transaction,
  type Database,
  type Queryable,
} from '@ai-xiutu/db';
import type { DispatchJournal } from './journal.js';

interface QueuedJob {
  id: string;
  project_id: string;
  operation: string;
  input_hash: string;
  hold_id: string;
  lease_started_at: Date | null;
  provider_request_id: string | null;
}

/** A caller must hold the job's FOR UPDATE lock so a new claim cannot race this
 * evidence check. Unreadable/mismatched evidence is never treated as absence. */
export async function hasQueuedDispatchEvidence(
  journal: DispatchJournal,
  job: QueuedJob,
  holdState: string,
): Promise<boolean> {
  let evidence = Boolean(job.lease_started_at || job.provider_request_id || holdState !== 'held');
  try {
    evidence = (await journal.hasDispatch(job.id, job.input_hash)) || evidence;
  } catch {
    evidence = true;
  }
  return evidence;
}

/** Check restore evidence before current permission/model rejection is allowed
 * to release a queued hold. Otherwise a restored already-paid task could be
 * refunded merely because its model or account was disabled after dispatch. */
export async function freezePreviouslyDispatchedJob(
  tx: Queryable,
  journal: DispatchJournal,
  job: QueuedJob,
): Promise<boolean> {
  const hold = (await tx.query('SELECT state FROM quota_holds WHERE id=$1', [job.hold_id])).rows[0];
  if (!hold) throw new Error('AI_HOLD_INTEGRITY_REQUIRED');
  if (!(await hasQueuedDispatchEvidence(journal, job, hold.state))) return false;
  await markUnknownHold(tx, job.hold_id);
  await tx.query(
    `UPDATE ai_jobs SET state='unknown',error_code='DISPATCH_ALREADY_RECORDED',
    input=input-'audioBase64',updated_at=clock_timestamp() WHERE id=$1`,
    [job.id],
  );
  await audit(tx, null, 'ai.restore_evidence', 'ai_job', job.id, { operation: job.operation });
  const project = (await tx.query('SELECT space_id FROM projects WHERE id=$1', [job.project_id]))
    .rows[0]!;
  await emit(tx, project.space_id, job.project_id, 'ai.unknown', job.id);
  return true;
}

/** Recovery is maintenance, not a provider capability. It must run even when
 * every external adapter is disabled. A lost lease is uncertain: never release
 * its hold or turn it back into queued, even if the local journal is absent. */
export async function recoverStaleAiJobs(db: Database): Promise<number> {
  return transaction(db, async (tx) => {
    const stale = await tx.query(
      `SELECT j.*,p.space_id FROM ai_jobs j JOIN projects p ON p.id=j.project_id
      WHERE j.state='running' AND
      (j.lease_started_at IS NULL OR j.lease_started_at<clock_timestamp()-interval '5 minutes')
      ORDER BY p.space_id,j.created_at,j.id FOR UPDATE OF j SKIP LOCKED`,
    );
    for (const row of stale.rows) {
      await markUnknownHold(tx, row.hold_id);
      await tx.query(
        `UPDATE ai_jobs SET state='unknown',error_code='WORKER_LOST',
        input=input-'audioBase64',updated_at=clock_timestamp() WHERE id=$1`,
        [row.id],
      );
      await audit(tx, null, 'ai.worker_lost', 'ai_job', row.id, {
        operation: row.operation,
        code: 'WORKER_LOST',
      });
      await emit(tx, row.space_id, row.project_id, 'ai.unknown', row.id);
    }
    return stale.rows.length;
  });
}
