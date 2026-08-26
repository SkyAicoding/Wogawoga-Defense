# Age of Dinosaurs (공룡의 시대)

원시시대 3D 타워디펜스. Vite + TypeScript(strict) + Three.js, 광고·결제·서버 없음.
그래픽은 **전부 코드 프로시저럴**이고 런타임 의존성은 three 하나뿐이다.

## 시작할 때 — **먼저 `docs/HANDOFF.md` 를 읽어라**

이 저장소는 여러 기기(회사·집·폰)에서 이어서 작업한다. 그리고 **컨테이너가 작업 트리를
자주 잃는다** — 한 세션에서 16회 관측됐고, 그때마다 HEAD 가 옛 커밋으로 돌아간다.
**원격 브랜치만 살아남는다.**

`docs/HANDOFF.md` 가 세션을 넘어 살아남는 유일한 상태 기록이다. 거기에 있는 것:
지금 어디까지 됐나 · 얇은 계약 표 · 이 저장소가 반복해서 당한 함정 · 롤백 복구 절차.

`.claude/hooks/session-start.sh` 가 세션 시작 때 트리가 원격보다 뒤처졌는지 자동으로
알려 준다. 뒤처졌다고 나오면 **먼저 복구하고 나서** 일을 시작해라.

## 브랜치

| 브랜치 | 무엇 |
|---|---|
| `claude/primitive-defense-game-7covq4` | **배포 브랜치.** 여기 푸시하면 GitHub Pages 가 나간다. **검증 통과본만** 올린다 |
| `claude/gate2-wip` | 미검증 작업분. 롤백 보험으로 **자주** 푸시한다 |

⚠ CI(`ci.yml`)는 `branches-ignore: []` 라 **모든 푸시에서 돈다.** WIP 스냅샷마다 빨간 CI 가
하나씩 남는 것은 정상이다. 배포(`pages.yml`)는 배포 브랜치에서만 돈다.

## 명령

```bash
npm install          # 의존성 (세션 훅이 자동으로 한다)
npm run typecheck    # tsc --noEmit — 이 저장소의 린터다
npm test             # vitest — 단위 + 난이도 봉투
npm run build        # 프로덕션 빌드 → dist/
npm run e2e          # Playwright. PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome 필요
```

난이도 봉투(`tests/sim/autoplay.test.ts`)는 27개 계약으로 **15분 이상** 걸린다.
백그라운드로 돌려라 — 포그라운드 `sleep` 은 막혀 있다.

## 절대 하면 안 되는 것

1. **난이도 문턱을 어느 방향으로도 내리지 마라.** `tests/sim/autoplay.probes.ts` ·
   `autoplay.test.ts` · `envelope.ts` 의 숫자 문턱은 그대로 둔다. 봉투가 빨개지면
   **게임 쪽 수치**를 고친다. (감사: 이 세 파일이 배포본 대비 **주석 아닌 변경 0줄**이어야 한다)
2. **`tests/sim/__ledger__/autoplay.json` 을 손으로 고치지 마라.** **전부 초록이 된 뒤에만**
   `AUTOPLAY_LEDGER=1` 로 다시 뽑는다. 빨간 채로 뽑으면 그 빨강이 기록으로 승격된다.
   주석의 `⟦원장 …⟧` 는 **검사되는 인용**이라, 다시 뽑으면 값과 **그 값에 기대던 문장까지**
   고쳐야 메타 it 이 초록이다.
3. **실패 불가능한 계약을 만들지 마라.** 새 테스트는 그 기능을 무력화하는 최소 패치로
   **실제로 빨개지는지 확인**해라. 이 저장소는 그걸 여러 번 잡았다.
4. **`src/sim/**` 에서 `Math.random` 금지.** 결정론이 1순위다. `AllySim`/`EnemySim` 에
   필드를 더하면 `entities.ts` 의 `resetAlly`/`resetEnemy` 초기화와 `battle.ts hash()`
   접기가 **필수**다.
5. **저장 키 `wogawoga.save`(`src/core/save.ts`)를 바꾸지 마라** — 기존 진행도가 날아간다.
6. **저장소 이름·배포 URL 을 바꾸지 마라** — 지금 링크가 죽는다.
7. **`git add -A` 로 스냅샷하면 임시 계측 파일(`zz*`)까지 쓸려 들어간다.** 배포 전에
   `git ls-files | grep zz` 로 확인해라. 실제로 실패 불가능한 테스트가 그렇게 커밋된 적이 있다.

## 이 저장소가 **세 번** 당한 병 — 잣대가 재려는 것과 다른 것을 잰다

전부 "테스트는 초록인데 그림/뜻은 틀렸다" 형태였다:
1. `gate.test.ts` 의 `STRUCTURE_RING = 1.0` 이 구조물 **중심 고리**를 마을 바깥끝으로 착각
   (실제 바깥끝은 `WALL_R` 1.28 · `BASECAMP_MAX_RADIUS` 1.45)
2. `standoffFor` 가 `e.radius`(**충돌** 반지름)를 메시 앞 도달로 착각 — 실측 배율 0.96~2.51,
   **단조도 아니다**(golem 0.96 · ptera 2.51)
3. `tests/data/stages.test.ts` 의 `MAX_STANDOFF = 1.95` 하드코딩이 정지선이 옮겨간 뒤에도 그대로

**처방**: 상수를 베끼지 말고 **원본에서 import** 해라. 잠금 테스트는 식을 베끼지 말고
**실제 결과를 되읽어라**(`tests/render/gatepose.test.ts` 가 `EnemyView` 를 돌려 인스턴스
행렬에서 자세를 되읽는 이유가 그것이다 — 식을 베끼면 뷰만 고치는 회귀가 조용히 통과한다).

## 밸런스는 사용자가 직접 한다

게임 수치를 취향으로 돌리지 마라. 봉투가 빨개지면 먼저 **"계기의 문제인가 게임의 문제인가"**
를 실측으로 가르고, 게임 쪽이면 무엇을 얼마나 돌려야 하는지 **실측과 함께 올려라**.

손잡이 위치: `src/data/balance.ts`(문간 `GATE_*` · 아군 `ALLY_*` · 채집 `GATHER_*`) ·
`src/data/stages/stage0N.ts`(웨이브 예산·HP 곡선) · `src/data/hometown.ts`(마을 레벨 표) ·
`enemies.ts` · `towers.ts` · `allies.ts`
