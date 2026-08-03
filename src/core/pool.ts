/** 객체 풀 — 핫 루프에서 GC 압력 제거 */
export class Pool<T> {
  private items: T[] = [];

  constructor(
    private factory: () => T,
    private reset: (item: T) => void,
    prewarm = 0,
  ) {
    for (let i = 0; i < prewarm; i++) this.items.push(factory());
  }

  acquire(): T {
    const item = this.items.pop();
    if (item !== undefined) {
      this.reset(item);
      return item;
    }
    const fresh = this.factory();
    this.reset(fresh);
    return fresh;
  }

  release(item: T): void {
    this.items.push(item);
  }

  get available(): number {
    return this.items.length;
  }
}

/**
 * 밀집 배열 — swap-remove로 순회 중 제거 가능.
 * 순회는 인덱스 역순으로 하면 제거에 안전하다.
 */
export class DenseList<T> {
  readonly items: T[] = [];

  add(item: T): void {
    this.items.push(item);
  }

  /** 해당 인덱스를 마지막 요소와 교체 후 pop. 제거된 요소 반환 */
  removeAt(index: number): T {
    const items = this.items;
    const removed = items[index] as T;
    const last = items.pop() as T;
    if (index < items.length) items[index] = last;
    return removed;
  }

  remove(item: T): boolean {
    const i = this.items.indexOf(item);
    if (i < 0) return false;
    this.removeAt(i);
    return true;
  }

  clear(): void {
    this.items.length = 0;
  }

  get length(): number {
    return this.items.length;
  }
}
