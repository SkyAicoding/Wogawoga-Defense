/**
 * **판별력 대조군 스위트** — "이걸 깨면 이 항목이 빨개진다"를 실행 가능하게 만든다.
 *
 * 봉투(tests/sim/autoplay.test.ts)는 `judge(BASE)` 가 전부 초록이길 요구한다.
 * 이 파일은 **같은 judge 를 되돌리기 위에서** 부르고 **지정된 다리가 빨갛길** 요구한다.
 * 곧 판별력이 주석의 문장이 아니라 실행물이 된다.
 *
 * ── 어떻게 도는가 (기본은 건너뛴다 — CI 예산 밖이다) ─────────────────────────
 *     AUTOPLAY_CONTROLS=fast npx vitest run tests/sim/autoplay.control.test.ts
 *     AUTOPLAY_CONTROLS=full npx vitest run tests/sim/autoplay.control.test.ts
 * fast = 독립 블록 2벌(블록당 개수는 봉투와 같다) · full = 봉투와 같은 4벌.
 * ⚠ 판정 불가(기준선이 그 프로파일에서 이미 빨간 다리)는 카탈로그의 `fullOnly` 에 선언된
 *   것만 허용된다. 선언 없는 판정 불가는 빨강이고, 초록 실행에서도 판정 불가 목록을 찍는다.
 * ⚠ 블록당 개수를 줄이지 않는 이유는 envelope.FAST 주석에 있다 — 짝 검정의 검출력은
 *   시드 수가 아니라 불일치 쌍 수에서 나오므로, 줄이면 스위트가 스스로 거짓 음성을 만든다.
 *
 * ── 세 가지를 한꺼번에 본다 ─────────────────────────────────────────────────
 *  (1) **기준선이 초록인가** — 같은 프로파일에서 `judge(BASE)` 의 그 다리가 초록이어야
 *      "되돌리기가 빨갛게 만들었다"는 말이 성립한다.
 *  (2) **되돌리기가 빨간가** — 겨냥한 다리가 실제로 깨져야 한다. 안 깨지면 그 다리는
 *      **아무 일도 안 하고 있는 것**이고, 그 사실이 이 스위트의 산출물이다.
 *  (3) **되돌리기가 실제로 무언가를 바꿨는가** — 다리의 실측값이 기준선과 달라야 한다.
 *      이게 없으면 "판별력을 증명한다던 스위트가 아무 일도 안 하는 채로 초록"일 수 있다.
 *      이 과제가 발견한 병을 대조군 층에서 그대로 재현하는 형태라 반드시 검사한다.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BASE, FAST, FULL, type Leg, type Profile } from './envelope';
import { CONTROLS, UNPROVEN, UNREACHABLE } from './controls';
import { ITEMS } from './autoplay.probes';

const MODE = process.env.AUTOPLAY_CONTROLS;
/** 이번 실행에서 판정 불가였던 (되돌리기, 다리) — 초록이어도 마지막에 표로 찍는다 */
const allUndecided: string[] = [];
const PROF: Profile = MODE === 'full' ? FULL : FAST;

const LEDGER_PATH = join(dirname(fileURLToPath(import.meta.url)), '__ledger__', 'autoplay.json');
const itemOf = (legId: string): string => legId.split('.')[0]!;
const byId = new Map(ITEMS.map((i) => [i.id, i]));

/** 항목 하나를 주어진 패치로 판정한다 (play 캐시가 기준선 스윕을 전 대조군에서 공유한다) */
function legsFor(itemId: string, patch: Parameters<(typeof ITEMS)[number]['judge']>[0]): Map<string, Leg> {
  const item = byId.get(itemId);
  if (!item) throw new Error(`알 수 없는 항목 ${itemId} — 다리 id 의 접두가 ITEMS 의 id 와 달라졌다`);
  return new Map(item.judge(patch, PROF).legs.map((l) => [l.id, l]));
}

describe.skipIf(!MODE)(`판별력 대조군 (${MODE ?? '-'})`, () => {
  it('카탈로그가 겨냥하는 다리의 항목이 전부 존재한다', () => {
    for (const c of CONTROLS) {
      for (const t of c.targets) {
        expect(byId.has(itemOf(t)), `${c.id} 이 겨냥하는 ${t} 의 항목 ${itemOf(t)} 가 없다`).toBe(true);
      }
    }
    expect(CONTROLS.length).toBeGreaterThan(0);
  });

  for (const c of CONTROLS) {
    it.skipIf(c.minProfile === 'full' && MODE !== 'full')(`${c.id} (${c.grade}) — ${c.why}`, () => {
      const items = [...new Set(c.targets.map(itemOf))];
      const base = new Map<string, Leg>();
      const ctrl = new Map<string, Leg>();
      for (const id of items) {
        for (const [k, v] of legsFor(id, BASE)) base.set(k, v);
        for (const [k, v] of legsFor(id, c.patch)) ctrl.set(k, v);
      }
      const lines: string[] = [];
      const notGreen: string[] = [];
      const notFired: string[] = [];
      const inert: string[] = [];
      /**
       * fast 등급에서 기준선 다리가 이미 빨간 경우 = **표본이 모자라 판정할 수 없다**.
       * (예: 유의성 다리는 블록 둘에서 불일치 쌍이 반으로 줄어 α 를 못 넘길 수 있다)
       * 그건 되돌리기의 문제도 그 다리의 문제도 아니므로 **판정 불가**로 뺀다.
       * full 등급에서는 같은 상황이 그대로 실패다 — 거기서는 봉투와 같은 표본을 쓰기 때문이다.
       *
       * ⚠⚠ **옛 규칙은 "전부 판정 불가일 때만 빨강"이었다 — 고쳤다.**
       *   그 형태에서는 넷을 겨냥해 셋이 판정 불가여도 초록이었고, 그 셋은 fast 실행에서
       *   **아무것도 증명하지 않은 채 증명된 것처럼** 보였다(실측: placebo-allies 가
       *   정확히 그 상태였다). 이제 판정 불가는 카탈로그가 `fullOnly` 에 **미리 선언한**
       *   다리만 허용된다. 선언 없이 판정 불가가 되면 빨강이고, 선언했는데 판정이
       *   되면(= 표본이 자란 것) 그것도 알려 준다. 그리고 **초록 실행에서도** 어느 다리가
       *   판정 불가였는지 표준출력에 남는다 — 조용히 넘어가는 자리를 없애는 것이 요점이다.
       */
      const undecided: string[] = [];
      const undeclared: string[] = [];
      const staleFullOnly: string[] = [];
      const declaredFullOnly = new Set(c.fullOnly ?? []);
      for (const t of c.targets) {
        const b = base.get(t);
        const x = ctrl.get(t);
        expect(b && x, `다리 ${t} 가 판정에서 나오지 않았다`).toBeTruthy();
        if (!b || !x) continue;
        const mark = !b.ok && MODE !== 'full' ? ' [판정불가]' : declaredFullOnly.has(t) ? ' [fullOnly]' : '';
        lines.push(`  ${t}${mark}\n    기준선 ${b.ok ? '○' : '✗'} ${b.value}\n    되돌리기 ${x.ok ? '○' : '✗'} ${x.value}`);
        if (!b.ok) {
          if (MODE === 'full') notGreen.push(t);
          else {
            undecided.push(t);
            if (!declaredFullOnly.has(t)) undeclared.push(t);
          }
          continue;
        }
        if (declaredFullOnly.has(t) && MODE !== 'full') staleFullOnly.push(t);
        if (x.ok) notFired.push(t);
        if (b.value === x.value) inert.push(t);
      }
      const msg = `\n${c.why}\n${lines.join('\n')}\n`;
      expect(notGreen, `${msg}⚠ 기준선이 이미 빨갛다 — 되돌리기가 빨갛게 만들었다고 말할 수 없다`).toEqual([]);
      expect(inert, `${msg}⚠ 되돌리기가 실측값을 한 자리도 안 바꿨다 — 패치가 아무 일도 안 한다(카탈로그가 낡았다)`).toEqual([]);
      expect(notFired, `${msg}⚠ 이 다리는 되돌리기에도 초록이다 = **아무것도 안 잡고 있다**. 문턱을 낮추지 말고 다음 순서로 처분하라: 더 센 kill 대조군 추가 → 그래도 안 잡히면 다리를 monitor 로 강등 → 항목의 계약 다리가 전부 강등되면 항목 삭제 + 보고`).toEqual([]);
      expect(undeclared,
        `${msg}⚠ 이 프로파일에서 **판정 불가**인데 카탈로그가 그렇게 선언하지 않았다.\n` +
        `   그 다리는 이번 실행에서 아무것도 증명하지 않았다. 되돌리기의 fullOnly 에 적거나(= 정직한 공시), ` +
        `AUTOPLAY_CONTROLS=full 로 재라.`).toEqual([]);
      if (undecided.length > 0 || staleFullOnly.length > 0) {
        // 초록 실행에서도 남는 기록 — 판정 불가가 조용히 지나가지 않게 한다.
        process.stdout.write(
          `\n[${c.id}] 판정 불가(fullOnly 선언됨): ${undecided.join(' · ') || '없음'}` +
            (staleFullOnly.length ? ` · ⚠ fullOnly 인데 이 프로파일에서 판정됐다(선언이 낡았다): ${staleFullOnly.join(' · ')}` : '') +
            '\n',
        );
      }
      allUndecided.push(...undecided.map((t) => `${c.id}:${t}`));
    }, 1_800_000);
  }

  it('증명 안 된 판별력과 주입구 없는 되돌리기를 정직하게 적어 둔다', () => {
    // 대체 대조군을 "같은 축"이라고 우기지 않는다 — 이 파일이 이미 한 번 당한 실패 형태다.
    expect(UNREACHABLE.length).toBeGreaterThan(0);
    for (const u of UNREACHABLE) {
      expect(u.what.length, `${u.what}`).toBeGreaterThan(0);
      expect(u.why.length).toBeGreaterThan(0);
      expect(u.item.length).toBeGreaterThan(0);
    }
    // UNPROVEN 에 적힌 다리는 **어떤 대조군도 겨냥하지 않아야** 한다. 겨냥하는데 목록에도
    // 있으면 둘 중 하나가 낡은 것이고, 그 어긋남이 곧 이 파일이 없애려는 병이다.
    const targeted = new Set(CONTROLS.flatMap((c) => c.targets));
    for (const u of UNPROVEN) {
      for (const l of u.legs) {
        expect(targeted.has(l), `${l} 은 UNPROVEN 인데 대조군이 겨냥한다 — 둘 중 하나가 낡았다`).toBe(false);
      }
    }
    // 그리고 **어떤 대조군도 겨냥하지 않는 다리**를 원장에서 뽑아 찍는다. 봉투가 잠근다고
    // 적어 놓고 아무도 확인한 적 없는 자리가 어디인지 다음 사람이 한 번에 보게 하려는 것이다
    // (전제·감시 다리도 섞여 나온다 — 그것들은 겨냥 대상이 아닌 것이 정상이다).
    const targetedAll = new Set(CONTROLS.flatMap((c) => c.targets));
    const untargeted = existsSync(LEDGER_PATH)
      ? Object.keys(JSON.parse(readFileSync(LEDGER_PATH, 'utf8')) as Record<string, string>)
          .filter((k) => !targetedAll.has(k))
      : [];
    process.stdout.write(
      `\n══ 이번 실행에서 판정 불가였던 다리 (${MODE} 등급) ══\n${allUndecided.join(' · ') || '없음'}\n` +
        `\n══ 어떤 대조군도 겨냥하지 않는 다리 (전제·감시 포함) ══\n${untargeted.join(' · ')}\n` +
        `\n══ 판별력이 증명 안 된 다리 ══\n` +
        UNPROVEN.map((u) => `· ${u.legs.join(' · ')}\n  시도: ${u.tried}\n  결과: ${u.finding}`).join('\n') +
        `\n══ 주입구가 없는 되돌리기 ══\n` +
        UNREACHABLE.map((u) => `· ${u.what} — ${u.why}\n  ${u.item}`).join('\n') + '\n',
    );
  });
});
