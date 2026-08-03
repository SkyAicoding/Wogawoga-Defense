/** 화면 상태 머신 — 화면 수명주기의 유일한 소유자 */
export interface Screen<Ctx> {
  enter(ctx: Ctx, params?: unknown): void;
  exit(ctx: Ctx): void;
  /** 매 렌더 프레임 호출 (dt 초) */
  update?(ctx: Ctx, dt: number): void;
}

export class ScreenFsm<Ctx, Id extends string> {
  private screens = new Map<Id, Screen<Ctx>>();
  private current: Id | null = null;

  constructor(private ctx: Ctx) {}

  register(id: Id, screen: Screen<Ctx>): void {
    this.screens.set(id, screen);
  }

  goto(id: Id, params?: unknown): void {
    if (this.current === id) return;
    const prev = this.current ? this.screens.get(this.current) : null;
    const next = this.screens.get(id);
    if (!next) throw new Error(`unknown screen: ${id}`);
    prev?.exit(this.ctx);
    this.current = id;
    next.enter(this.ctx, params);
  }

  currentId(): Id | null {
    return this.current;
  }

  update(dt: number): void {
    if (!this.current) return;
    this.screens.get(this.current)?.update?.(this.ctx, dt);
  }
}
