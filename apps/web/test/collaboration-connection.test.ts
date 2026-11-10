import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../src/lib/api';
import {
  canRecoverCollaborationConnection,
  canReportTransportFailure,
  isTransientCollaborationFailure,
} from '../src/collaboration/connection-state';

const interruptedRead = {
  status: 'reconnecting' as const,
  failureOrigin: 'transport' as const,
  pendingDraft: false,
  unknownCommand: false,
  processing: false,
  suspended: false,
};

test('a successful authoritative poll recovers an idle room after a transient transport failure', () => {
  for (const status of [0, 429, 500, 503]) {
    assert.equal(
      isTransientCollaborationFailure(new ApiError('CONNECTION_FAILED', '', status)),
      true,
    );
    assert.equal(canRecoverCollaborationConnection(interruptedRead), true);
  }
  for (const status of [401, 403, 404, 409])
    assert.equal(
      isTransientCollaborationFailure(new ApiError('AUTH_OR_OWNERSHIP_FAILED', '', status)),
      false,
    );
  assert.equal(
    isTransientCollaborationFailure(new Error('Unexpected recipe parser failure')),
    false,
  );
});

test('a healthy poll cannot acknowledge an unknown command or discard unsent local work', () => {
  assert.equal(
    canRecoverCollaborationConnection({ ...interruptedRead, unknownCommand: true }),
    false,
  );
  assert.equal(
    canRecoverCollaborationConnection({ ...interruptedRead, pendingDraft: true }),
    false,
  );
  assert.equal(canRecoverCollaborationConnection({ ...interruptedRead, processing: true }), false);
  assert.equal(canRecoverCollaborationConnection({ ...interruptedRead, suspended: true }), false);
  assert.equal(
    canRecoverCollaborationConnection({ ...interruptedRead, failureOrigin: 'operation' }),
    false,
  );
});

test('later network failures and successful polls both preserve conflict and permission errors', () => {
  for (const status of ['conflict', 'forbidden'] as const) {
    assert.equal(
      canReportTransportFailure({ status, failureOrigin: 'operation', unknownCommand: false }),
      false,
    );
    assert.equal(canRecoverCollaborationConnection({ ...interruptedRead, status }), false);
  }
  assert.equal(
    canReportTransportFailure({
      status: 'reconnecting',
      failureOrigin: 'operation',
      unknownCommand: false,
    }),
    false,
  );
  assert.equal(
    canReportTransportFailure({ status: 'saving', failureOrigin: null, unknownCommand: true }),
    false,
  );
  assert.equal(
    canReportTransportFailure({ status: 'ready', failureOrigin: null, unknownCommand: false }),
    true,
  );
  assert.equal(
    canReportTransportFailure({
      status: 'reconnecting',
      failureOrigin: 'transport',
      unknownCommand: false,
    }),
    true,
  );
});
