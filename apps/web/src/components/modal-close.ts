/** An asynchronous close decision belongs to one still-open modal owner. */
export class ModalCloseRequests {
  private pending: object | null = null;

  invalidate() {
    this.pending = null;
  }

  async request(actions: {
    isCurrent: () => boolean;
    canClose?: () => boolean | Promise<boolean>;
    close: () => void;
  }): Promise<boolean> {
    if (this.pending || !actions.isCurrent()) return false;
    const token = {};
    this.pending = token;
    try {
      const answer = actions.canClose?.() ?? true;
      const accepted = typeof answer === 'boolean' ? answer : await answer;
      if (accepted !== true) return false;
      if (this.pending !== token || !actions.isCurrent()) return false;
      actions.close();
      return true;
    } catch {
      // A failed guard is not permission to dismiss an unsaved subtree.
      return false;
    } finally {
      if (this.pending === token) this.pending = null;
    }
  }
}
