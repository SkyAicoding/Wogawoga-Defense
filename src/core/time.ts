/**
 * 고정 타임스텝 누적기.
 * update(now)가 이번 프레임에 실행할 틱 수와 보간 알파를 돌려준다.
 * 배속은 누적 시간에 곱해지므로 틱 수학은 모든 배속에서 동일하다 (결정론 유지).
 */
export class FixedStepLoop {
  private acc = 0;
  private last = -1;
  /** 백그라운드 복귀 스파이럴 방지: 프레임당 최대 틱 */
  maxTicksPerFrame = 8;
  speed = 1;
  paused = false;

  constructor(readonly tickDt: number) {}

  /** @param now 초 단위 타임스탬프 */
  update(now: number): { ticks: number; alpha: number } {
    if (this.last < 0) this.last = now;
    let frameDt = now - this.last;
    this.last = now;
    if (frameDt > 0.25) frameDt = 0.25; // 탭 복귀 등 거대 델타 클램프
    if (this.paused) {
      this.acc = 0;
      return { ticks: 0, alpha: 1 };
    }
    this.acc += frameDt * this.speed;
    let ticks = Math.floor(this.acc / this.tickDt);
    if (ticks > this.maxTicksPerFrame) {
      ticks = this.maxTicksPerFrame;
      this.acc = this.tickDt * ticks; // 초과분 버림 (게임이 느려질 뿐 멈추지 않음)
    }
    this.acc -= ticks * this.tickDt;
    return { ticks, alpha: this.acc / this.tickDt };
  }

  reset(): void {
    this.acc = 0;
    this.last = -1;
  }
}
