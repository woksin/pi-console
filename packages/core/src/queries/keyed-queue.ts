/** Dictionary point lookup, including missing and adversarial IDs. */
export const rowOf = <T>(rows: Record<string, T>, id: string): T | undefined => Object.hasOwn(rows, id) ? rows[id] : undefined;

interface QueueEntry { id: string; key: string }
interface HeapNode extends QueueEntry { index: number }

/** Indexed minimum queue: replacement/removal never leaves obsolete deadlines behind. */
export class KeyedQueue {
  readonly #heap: HeapNode[] = [];
  readonly #nodes = new Map<string, HeapNode>();

  get first(): QueueEntry | undefined { return this.#heap[0]; }
  get size(): number { return this.#heap.length; }

  set(entry: QueueEntry): void {
    this.delete(entry.id);
    const node = { ...entry, index: this.#heap.length };
    this.#nodes.set(node.id, node);
    this.#heap.push(node);
    this.#up(node);
  }

  delete(id: string): void {
    const node = this.#nodes.get(id);
    if (!node) return;
    const last = this.#heap[this.#heap.length - 1];
    this.#heap.pop();
    this.#nodes.delete(id);
    if (node.index === this.#heap.length) return;
    last.index = node.index;
    this.#heap[last.index] = last;
    this.#up(last);
    this.#down(last);
  }

  #swap(a: HeapNode, b: HeapNode): void {
    [this.#heap[a.index], this.#heap[b.index]] = [b, a];
    [a.index, b.index] = [b.index, a.index];
  }

  #up(node: HeapNode): void {
    while (node.index > 0) {
      const parent = this.#heap[Math.floor((node.index - 1) / 2)];
      if (parent.key <= node.key) return;
      this.#swap(parent, node);
    }
  }

  #down(node: HeapNode): void {
    let child = this.#child(node);
    while (child && child.key < node.key) {
      this.#swap(node, child);
      child = this.#child(node);
    }
  }

  #child(node: HeapNode): HeapNode | undefined {
    const left = this.#heap[node.index * 2 + 1] as HeapNode | undefined;
    const right = this.#heap[node.index * 2 + 2] as HeapNode | undefined;
    if (!left) return undefined;
    return right && right.key < left.key ? right : left;
  }
}

/** Reverse dependencies with remembered old owners, including unknown owners. */
export class Owners<Id = string> {
  readonly #owners = new Map<Id, Id>();
  readonly #members = new Map<Id, Set<Id>>();

  get(id: Id): Id | undefined { return this.#owners.get(id); }
  members(owner: Id): ReadonlySet<Id> { return this.#members.get(owner) ?? new Set(); }

  descendants(roots: Iterable<Id>): Set<Id> {
    const pending = [...roots];
    const seen = new Set<Id>();
    for (const id of pending) {
      if (seen.has(id)) continue;
      seen.add(id);
      for (const child of this.members(id)) pending.push(child);
    }
    return seen;
  }

  set(id: Id, owner: Id | null | undefined): void {
    this.#remove(id);
    if (owner === null || owner === undefined) return;
    this.#owners.set(id, owner);
    this.#group(owner).add(id);
  }

  #remove(id: Id): void {
    const old = this.#owners.get(id);
    this.#owners.delete(id);
    if (old === undefined) return;
    const members = this.#members.get(old);
    members?.delete(id);
    if (members?.size === 0) this.#members.delete(old);
  }

  #group(owner: Id): Set<Id> {
    let members = this.#members.get(owner);
    if (!members) { members = new Set(); this.#members.set(owner, members); }
    return members;
  }
}
