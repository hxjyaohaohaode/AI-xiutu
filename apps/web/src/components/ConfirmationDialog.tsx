import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal } from './Ui';

export interface ConfirmationOptions {
  title?: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
}

interface ConfirmationRequest<T> {
  readonly id: number;
  readonly options: T;
  readonly result: Promise<boolean>;
}

/** One owner, one question. An old dialog can never answer a newer question. */
export class ConfirmationRequests<T> {
  private sequence = 0;
  private available = true;
  private pending: {
    request: ConfirmationRequest<T>;
    resolve: (accepted: boolean) => void;
  } | null = null;

  get current(): ConfirmationRequest<T> | null {
    return this.pending?.request ?? null;
  }

  request(options: T): ConfirmationRequest<T> | null {
    if (!this.available || this.pending) return null;
    let resolve!: (accepted: boolean) => void;
    const result = new Promise<boolean>((done) => {
      resolve = done;
    });
    const request = Object.freeze({ id: ++this.sequence, options, result });
    this.pending = { request, resolve };
    return request;
  }

  settle(id: number, accepted: boolean): boolean {
    if (!this.pending || this.pending.request.id !== id) return false;
    const pending = this.pending;
    this.pending = null;
    pending.resolve(accepted === true);
    return true;
  }

  cancel(): void {
    if (this.pending) this.settle(this.pending.request.id, false);
  }

  dispose(): void {
    this.available = false;
    this.cancel();
  }

  /** React may replay effect setup after cleanup; IDs deliberately never reset. */
  activate(): void {
    this.available = true;
  }
}

/** The caller must recheck its own identity, source and version after awaiting. */
export function useConfirmation() {
  const [requests] = useState(() => new ConfirmationRequests<ConfirmationOptions>());
  const [request, setRequest] = useState<ConfirmationRequest<ConfirmationOptions> | null>(null);
  const closingFrame = useRef(request);
  if (request) closingFrame.current = request;
  const shown = request ?? closingFrame.current;
  const cancelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    requests.activate();
    if (!requests.current) setRequest(null);
    return () => requests.dispose();
  }, [requests]);
  useEffect(() => {
    // A second question can replace a closing frame before the dialog actually
    // closes. Reset its initial focus to cancel for that new question as well.
    if (request) cancelButton.current?.focus({ preventScroll: true });
  }, [request?.id]);

  const confirm = useCallback(
    (options: ConfirmationOptions): Promise<boolean> => {
      const next = requests.request(Object.freeze({ ...options }));
      if (!next) return Promise.resolve(false);
      setRequest(next);
      return next.result;
    },
    [requests],
  );
  const settle = useCallback(
    (id: number, accepted: boolean) => {
      if (!requests.settle(id, accepted)) return;
      setRequest((current) => (current?.id === id ? null : current));
    },
    [requests],
  );
  const cancel = useCallback(() => {
    const pending = requests.current;
    if (pending) settle(pending.id, false);
  }, [requests, settle]);

  const dialog = shown ? (
    <Modal
      open={!!request}
      title={shown.options.title ?? '确认操作'}
      className="studio-dialog confirmation-dialog"
      initialFocusRef={cancelButton}
      onClose={() => settle(shown.id, false)}
    >
      <div className="stack-form">
        <div className="confirmation-description" style={{ whiteSpace: 'pre-line' }}>
          {shown.options.description}
        </div>
        <div className="dialog-actions">
          <button
            ref={cancelButton}
            type="button"
            className="button button-secondary"
            onClick={() => settle(shown.id, false)}
          >
            {shown.options.cancelLabel ?? '取消'}
          </button>
          <button
            type="button"
            className={`button ${shown.options.tone === 'danger' ? 'button-secondary' : 'button-primary'}`}
            style={
              shown.options.tone === 'danger'
                ? { color: 'var(--danger)', borderColor: 'var(--danger)' }
                : undefined
            }
            onClick={() => settle(shown.id, true)}
          >
            {shown.options.confirmLabel ?? '确认继续'}
          </button>
        </div>
      </div>
    </Modal>
  ) : null;

  return { confirm, cancel, dialog };
}
