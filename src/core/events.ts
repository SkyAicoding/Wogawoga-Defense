/** 컴파일 타임 타입 안전 pub/sub 이미터 */
export class Emitter<M extends Record<string, unknown>> {
  private handlers = new Map<keyof M, Set<(payload: never) => void>>();

  on<K extends keyof M>(event: K, fn: (payload: M[K]) => void): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(fn as (payload: never) => void);
    return () => this.off(event, fn);
  }

  off<K extends keyof M>(event: K, fn: (payload: M[K]) => void): void {
    this.handlers.get(event)?.delete(fn as (payload: never) => void);
  }

  emit<K extends keyof M>(event: K, payload: M[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const fn of set) (fn as (payload: M[K]) => void)(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}
