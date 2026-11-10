import { ApiError } from '../lib/api';

export type CollaborationConnectionStatus =
  | 'off'
  | 'connecting'
  | 'ready'
  | 'acquiring'
  | 'previewing'
  | 'saving'
  | 'reconnecting'
  | 'conflict'
  | 'forbidden';

export type CollaborationFailureOrigin = 'transport' | 'operation' | null;

/** A successful room read can repair transport failures, never ownership or write failures. */
export function isTransientCollaborationFailure(error: unknown): boolean {
  return (
    error instanceof ApiError && (error.status === 0 || error.status === 429 || error.status >= 500)
  );
}

export function canReportTransportFailure(input: {
  status: CollaborationConnectionStatus;
  failureOrigin: CollaborationFailureOrigin;
  unknownCommand: boolean;
}): boolean {
  return (
    input.status !== 'conflict' &&
    input.status !== 'forbidden' &&
    !input.unknownCommand &&
    !(input.status === 'reconnecting' && input.failureOrigin === 'operation')
  );
}

export function canRecoverCollaborationConnection(input: {
  status: CollaborationConnectionStatus;
  failureOrigin: CollaborationFailureOrigin;
  pendingDraft: boolean;
  unknownCommand: boolean;
  processing: boolean;
  suspended: boolean;
}): boolean {
  return (
    input.status === 'reconnecting' &&
    input.failureOrigin === 'transport' &&
    !input.pendingDraft &&
    !input.unknownCommand &&
    !input.processing &&
    !input.suspended
  );
}
