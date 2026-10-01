export interface DrawTransactionNode {
  getAttr(name: string): unknown;
  setAttr(name: string, value: unknown): void;
  destroy(): void;
}

/** An immutable, registry-bound command capability, captured before any await. */
export type DrawCommandOwnership = Readonly<{ transactionId: string | null; generation: number }>;
type TransactionState<T extends DrawTransactionNode> = {
  state: "active" | "aborted" | "released";
  nodes: Set<T>;
  generation: number;
  cancelled: boolean;
  savepoint: { id: string; nodes: Set<T> } | null;
};
const TRANSACTION_ATTRIBUTE = "htDrawTransactionId";
const GENERATION_ATTRIBUTE = "htDrawTransactionGeneration";

/** Owns canvas nodes until a complete verified intro is committed. */
export class DrawTransactionRegistry<T extends DrawTransactionNode = DrawTransactionNode> {
  private readonly transactions = new Map<string, TransactionState<T>>();
  private readonly captures = new WeakMap<DrawCommandOwnership, {
    transaction: TransactionState<T> | null; epoch: number; cancellationEpoch: number;
  }>();
  private activeId: string | null = null;
  private epoch = 0;
  private cancellationEpoch = 0;

  begin(): string {
    if (this.activeId) throw new Error("a draw transaction is already active");
    const id = `draw-transaction-${globalThis.crypto.randomUUID()}`;
    this.transactions.set(id, { state: "active", nodes: new Set(), generation: 0, cancelled: false, savepoint: null });
    this.activeId = id;
    return id;
  }

  capture(): DrawCommandOwnership {
    const transaction = this.activeId ? this.transactions.get(this.activeId)! : null;
    const ownership = Object.freeze({ transactionId: this.activeId, generation: transaction?.generation ?? 0 });
    this.captures.set(ownership, { transaction, epoch: this.epoch, cancellationEpoch: this.cancellationEpoch });
    return ownership;
  }

  status(ownership: DrawCommandOwnership): "active" | "retired" | "released" {
    const captured = this.captures.get(ownership);
    if (!captured || captured.epoch !== this.epoch) return "retired";
    const transaction = captured.transaction;
    if (!transaction) return "active"; // Pre-intro work is never adopted by a later root.
    if (transaction.state === "released") return "released";
    return transaction.state === "active" && transaction.generation === ownership.generation && !transaction.cancelled
      ? "active" : "retired";
  }

  /** Retire continuations before resolving waits, without changing ink-release status. */
  cancelCommands(): void {
    this.cancellationEpoch++;
  }

  isCancelled(ownership: DrawCommandOwnership): boolean {
    return this.status(ownership) !== "active" ||
      this.captures.get(ownership)?.cancellationEpoch !== this.cancellationEpoch;
  }

  track(node: T, ownership?: DrawCommandOwnership): boolean {
    if (ownership) {
      if (this.isCancelled(ownership)) { node.destroy(); return false; }
      if (!ownership.transactionId) return true;
      node.setAttr(TRANSACTION_ATTRIBUTE, ownership.transactionId);
      // Retaining an earlier completed node must not rewrite its generation.
      if (node.getAttr(GENERATION_ATTRIBUTE) === undefined) node.setAttr(GENERATION_ATTRIBUTE, ownership.generation);
    }
    let transactionId = node.getAttr(TRANSACTION_ATTRIBUTE);
    if (typeof transactionId !== "string" && !ownership && this.activeId) {
      transactionId = this.activeId;
      node.setAttr(TRANSACTION_ATTRIBUTE, transactionId);
    }
    if (typeof transactionId !== "string") return true;
    const transaction = this.transactions.get(transactionId);
    if (!transaction || transaction.state !== "active") { node.destroy(); return false; }
    if (!transaction.nodes.has(node)) {
      const generation = node.getAttr(GENERATION_ATTRIBUTE);
      if (generation !== undefined && generation !== transaction.generation) { node.destroy(); return false; }
      node.setAttr(GENERATION_ATTRIBUTE, transaction.generation);
    }
    transaction.nodes.add(node);
    return true;
  }

  /** One current reveal beat inside the atomic intro, never a nested transaction. */
  savepoint(transactionId: string): string {
    const transaction = this.transactions.get(transactionId);
    if (!transaction || transaction.state !== "active") throw new Error("cannot checkpoint an inactive draw transaction");
    const id = `draw-savepoint-${globalThis.crypto.randomUUID()}`;
    // Each checkpoint begins a new command generation. Prior completed nodes
    // stay owned by the root, but a late prior-beat callback cannot enter it.
    transaction.generation++;
    transaction.cancelled = false;
    transaction.savepoint = { id, nodes: new Set(transaction.nodes) };
    return id;
  }

  /** Retire only this beat's captured commands; callers join them before rollback. */
  cancel(transactionId: string, savepointId: string): void {
    this.getSavepoint(transactionId, savepointId).cancelled = true;
  }

  hasSavepoint(): boolean {
    return Boolean(this.activeId && this.transactions.get(this.activeId)?.savepoint);
  }

  private getSavepoint(transactionId: string, savepointId: string): TransactionState<T> {
    const transaction = this.transactions.get(transactionId);
    if (!transaction || transaction.state !== "active" || transaction.savepoint?.id !== savepointId) {
      throw new Error("cannot roll back an inactive draw savepoint");
    }
    return transaction;
  }

  /** The caller must cancel AND join its old execution before rolling back. */
  rollback(transactionId: string, savepointId: string): Set<T> {
    const transaction = this.getSavepoint(transactionId, savepointId);
    const removed = new Set<T>();
    for (const node of transaction.nodes) {
      if (transaction.savepoint!.nodes.has(node)) continue;
      removed.add(node); node.destroy(); transaction.nodes.delete(node);
    }
    transaction.generation++;
    transaction.cancelled = false;
    return removed;
  }

  /** Drop a destroyed node from the live transaction and its checkpoint snapshot. */
  detach(node: T): void {
    for (const transaction of this.transactions.values()) {
      transaction.nodes.delete(node);
      transaction.savepoint?.nodes.delete(node);
    }
  }

  /** Release already-visible ink, including partial ink; never authorize late creation. */
  commit(transactionId: string): void {
    const transaction = this.transactions.get(transactionId);
    if (!transaction || transaction.state !== "active") throw new Error("cannot commit an inactive draw transaction");
    transaction.state = "released";
    transaction.nodes.forEach((node) => {
      node.setAttr(TRANSACTION_ATTRIBUTE, undefined);
      node.setAttr(GENERATION_ATTRIBUTE, undefined);
    });
    this.dropRetainedNodes(transaction);
    this.transactions.delete(transactionId);
    if (this.activeId === transactionId) this.activeId = null;
  }

  abort(transactionId: string): Set<T> {
    const transaction = this.transactions.get(transactionId);
    if (!transaction) return new Set<T>();
    transaction.state = "aborted";
    if (this.activeId === transactionId) this.activeId = null;
    const nodes = new Set(transaction.nodes);
    nodes.forEach((node) => node.destroy());
    this.dropRetainedNodes(transaction);
    return nodes;
  }

  finishAborted(transactionId: string): void {
    const transaction = this.transactions.get(transactionId);
    if (transaction?.state !== "aborted") return;
    this.dropRetainedNodes(transaction);
    this.transactions.delete(transactionId);
  }

  clear(): void {
    this.epoch++;
    for (const transaction of this.transactions.values()) {
      transaction.state = "aborted";
      this.dropRetainedNodes(transaction);
    }
    this.transactions.clear(); this.activeId = null;
  }

  /** Ownership objects keep the transaction alive. The node sets must not. */
  private dropRetainedNodes(transaction: TransactionState<T>): void {
    transaction.nodes.clear();
    transaction.savepoint?.nodes.clear();
  }
}
