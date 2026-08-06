export interface DrawTransactionNode {
  getAttr(name: string): unknown;
  setAttr(name: string, value: unknown): void;
  destroy(): void;
}

type TransactionState<T extends DrawTransactionNode> = {
  state: "active" | "aborted";
  nodes: Set<T>;
};

const TRANSACTION_ATTRIBUTE = "htDrawTransactionId";

/** Owns canvas nodes until a complete verified intro is committed. */
export class DrawTransactionRegistry<T extends DrawTransactionNode = DrawTransactionNode> {
  private readonly transactions = new Map<string, TransactionState<T>>();
  private activeId: string | null = null;
  private sequence = 0;

  begin(): string {
    if (this.activeId) throw new Error("a draw transaction is already active");
    const id = `draw-transaction-${++this.sequence}`;
    this.transactions.set(id, { state: "active", nodes: new Set() });
    this.activeId = id;
    return id;
  }

  track(node: T): boolean {
    let transactionId = node.getAttr(TRANSACTION_ATTRIBUTE);
    if (typeof transactionId !== "string" && this.activeId) {
      transactionId = this.activeId;
      node.setAttr(TRANSACTION_ATTRIBUTE, transactionId);
    }
    if (typeof transactionId !== "string") return true;
    const transaction = this.transactions.get(transactionId);
    if (!transaction || transaction.state === "aborted") {
      node.destroy();
      return false;
    }
    transaction.nodes.add(node);
    return true;
  }

  commit(transactionId: string): void {
    const transaction = this.transactions.get(transactionId);
    if (!transaction || transaction.state !== "active") {
      throw new Error("cannot commit an inactive draw transaction");
    }
    transaction.nodes.forEach((node) => node.setAttr(TRANSACTION_ATTRIBUTE, undefined));
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
    transaction.nodes.clear();
    return nodes;
  }

  finishAborted(transactionId: string): void {
    if (this.transactions.get(transactionId)?.state === "aborted") {
      this.transactions.delete(transactionId);
    }
  }

  clear(): void {
    this.transactions.clear();
    this.activeId = null;
  }
}
