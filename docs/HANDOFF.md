# 인수인계 — 다른 머신에서 이어서 작업할 때 먼저 읽는 문서

이 파일이 **세션을 넘어 살아남는 유일한 상태 기록**이다. 컨테이너의 스크래치패드
(`/tmp/claude-*/scratchpad`)는 롤백/머신 교체로 사라진다. **원격 저장소만 남는다.**

마지막 갱신: 문간 공성 마감 — §A·§B·§C²·§D·§E·§F 전부 닫고 배포 검증 중.

---

## 0. 사용자가 정한 것 (2026-08-25)

> **"게임 밸런싱은 나중에 내가 할 테니까, 너는 내가 요구하는 대로 구현해줘.
>   조정하는 방식은 내가 다른 아이디어를 낼 수 있으니까!"**

⇒ **게임 수치를 임의로 돌리지 마라.** 봉투가 빨개지면 먼저 "이게 계기의 문제인가
   게임의 문제인가"를 실측으로 가르고, 게임 쪽이면 **사용자에게 올려라**.
   이번 라운드에서 사다리(`tests/sim/ladder.test.ts`)가 그 예다 — 스테이지6 예산을
   +20% 올리면 통과시킬 수 있었지만 **밸런스 결정이라 안 했고**, 대신 바닥에서
   포화된 계기만 교체했다. 게임 값은 한 자리도 안 건드렸다.

밸런스 손잡이가 모여 있는 곳 (사용자용):
  · `src/data/balance.ts` — 문간 상수(GATE_*), 아군 상수(ALLY_*)
  · `src/data/stages/stage0N.ts` — 웨이브 예산·HP 곡선(budgetBase/Growth · hpBase/Growth)
  · `src/data/hometown.ts` — 마을 레벨 표(비용·HP·화력·사거리·정원)
  · `src/data/enemies.ts` · `towers.ts` · `allies.ts`
확인: `npx vitest run tests/sim/autoplay.test.ts` (27개 계약이 어디가 무너지는지 알려 준다)

---

## 1. 지금 어디까지 됐나

**배포 중**: https://skyaicoding.github.io/Wogawoga-Defense/
**게임 이름**: Age of Wogawoga (와가와가의 시대)

### 문간 공성 라운드 — 무엇이었나
사용자 요구: "보스 말고 나머지 공룡·적 부족도 마을 앞에서 멈춰 서로 때린다."
곧 적이 도착 즉시 누수하고 사라지던 것을, **문 앞에 서서 마을과 서로 HP 를 깎는**
상호 교전으로 통일하는 일이다.

핵심 자료구조: `gateOwed`(잔액). 스폰이 `gateOwed = baseDamage` 로 굳히고 문 앞의 한 입이
1씩 깎는다. 체류 상한에 걸려 뚫고 들어가면 `leakEnemy` 가 **잔액**을 청구한다. 그래서
  Σ(한 입) + (뚫을 때의 잔액) = baseDamage
가 **자료구조로** 성립한다 — 한 마리가 마을에 넣는 총 피해가 근사가 아니라 정의상 보존된다.

### 이번 라운드에서 닫은 것
| 항목 | 무엇 | 기전 |
|---|---|---|
| §A 아군 정원 | `11b.trained`/`11b.blocked` 붕괴 | 아군 값이 아니라 **집결 대열의 기하**였다 — 여섯이 한 점에 서서 같은 적을 봤다. `ALLY_MUSTER_ROW_GAP` 신설로 대열이 마을 앞으로 깊어진다 |
| §B 한 입 주기 | `9.real.dominates` 유의성 | 화력이 아니라 **시간**. 주기 30 에서는 마을 Lv1 이 한 마리당 두세 발밖에 못 쏴 레벨업 dps 가 처치로 바뀔 표본이 없었다. `GATE_BITE_TICKS` 60 |
| §C² 정지 자리 | 적 메시가 움막을 뚫었다 | **두 번 틀렸다.** ① 구조물 **중심 고리**(1.0)를 마을 바깥끝으로 착각 ② `radius`(충돌 반지름)를 메시 앞 도달로 착각(배율 0.96~2.51, **단조도 아니다**). 아래 §7 참조 |
| §D 부채 | 같은 종이 겹쳐 섰다 | 접선이 아니라 **회전**으로 벌린다(중심거리가 근사 없이 보존) |
| §E clamp | 체류 상한 순서 | `Math.min` + `holdMinTicks ∈ [60,120]` 데이터 계약 |
| §F UI | 빚 0 이면 경보가 **통째로** 꺼졌다 | `owedIncoming`/`owedAll`/`hpLow` 분리. 위급 테두리는 `farthest-side` + 밝은 적색(어두운 팥색은 하늘 위에서 명도만 바꿔 "어둡다"로 읽힌다) |

## 2. ⚠ 다음 사람이 알아야 할 것 — 얇은 자리와 함정

### 봉투에서 가장 얇은 자리 (여유 순)
| 다리 | 실측 | 문턱 | 여유 |
|---|---|---|---|
| **`3.floor`** | 5 | ≥ 5 | **0 — 한 판만 더 깊어지면 빨강** |
| `3.median` · `3.p05` | 8 · 7 | ≥8 · ≥7 | **원래 0** |
| `9.real.dominates` | 여유부호 9:0 (p 1.953e-3) | p ≤ α 3.571e-3 | **1쌍** (8:0 이면 빨강) |
| `7.baseNat.notDominant` | MDE 2판/80 | guard | 2판 |
| `5.gold` | 491 | ≤ 500 | 9 — 원래 얇다 |
| `12.frontOnly` | 3.75% | ≤ 5% | 1판 (한때 0 이었다가 회복) |

⚠ **α 는 방향 다리 수(14)로 나뉜다.** 새 방향 다리를 하나라도 더하면 α 가 좁아져
  `9.real.dominates` 가 **먼저** 빨개진다. 다리를 늘릴 계획이면 여기부터 봐라.

### 이 저장소가 반복해서 당한 병 — **잣대가 재려는 것과 다른 것을 잰다**
같은 형태로 **세 번** 새어 나갔다. 전부 "테스트는 초록인데 그림/뜻은 틀렸다" 였다:
1. `gate.test.ts` 의 `STRUCTURE_RING = 1.0` 이 구조물 **중심 고리**를 마을 바깥끝으로 착각
   (실제 바깥끝은 `WALL_R` 1.28 · `BASECAMP_MAX_RADIUS` 1.45).
2. `standoffFor` 가 `e.radius`(충돌 반지름)를 메시 앞 도달로 착각. 실측 배율 **0.96~2.51**
   이고 **단조도 아니다**(golem 0.96 · ptera 2.51) — 곧 "반경에 상수를 곱하면 된다"가 거짓.
3. `tests/data/stages.test.ts` 의 `MAX_STANDOFF = 1.95` 하드코딩이 정지선이 옮겨간 뒤에도
   그대로여서 엉뚱한 자리를 쟀다.
⇒ **새 계약을 쓸 때 상수를 베끼지 말고 원본에서 import 해라.** 그리고 잠금 테스트는
  식을 베끼지 말고 **실제 결과를 되읽어라** — `tests/render/gatepose.test.ts` 가
  `EnemyView` 를 돌려 인스턴스 행렬에서 자세를 되읽는 것이 그 이유다(초안은 뷰의 식을
  베꼈고, 그러면 뷰만 고치는 회귀가 조용히 통과한다).

### 캡처할 때의 함정
`__wgd.pause(true)` 는 **적 포즈까지 얼린다**(`stepFx` 는 파티클/카메라만 민다).
문 앞 자세를 찍으려면 sim 을 돌린 채 `gateTicks` 를 매 프레임 되돌려 붙들어라.
확대 훅이 없으므로 4배(`deviceScaleFactor: 4`)로 찍고 PIL 로 잘라 봐야 한다.

## 3. 롤백 복구 절차 (이 컨테이너는 롤백이 잦다 — **15회**)

증상: `git log --oneline -1` 이 `00e997c` 다. 작업이 통째로 과거로 돌아간다.

```bash
cd /home/user/Wogawoga-Defense
git reset --hard -q HEAD && git clean -fdq
git fetch -q origin
git checkout -q -B main origin/claude/gate2-wip   # 최신 작업분
# 배포본만 필요하면: origin/claude/primitive-defense-game-7covq4
npm ci        # node_modules 가 없으면
```

### 롤백 감지 지문 (HEAD 해시보다 이쪽이 확실하다)

| 확인 | 정상 | 롤백 트리 |
|---|---|---|
| `wc -l src/sim/combat.ts` | **311** | 151 |
| `ls src/sim/gather.ts` | 있다 | **없다** |
| `grep GATHER_REGROW_MAX src/data/balance.ts` | `= 1` | 없다 |
| `grep restReach src/data/types.ts` | **있다** | 없다 |
| `grep GATE_BITE_DEPTH src/data/balance.ts` | **있다** | 없다 |
| `grep allyCap src/data/hometown.ts` | 있다 | **없다** |

⚠ 함정: `src/sim/siege.ts` 는 롤백 트리에서도 똑같이 생겼다 — 그걸로 판단하지 마라.

### 작업 중 습관

- **셸 작업 디렉터리가 자꾸 `/home/user` 로 초기화된다.** 모든 명령을
  `cd /home/user/Wogawoga-Defense || exit 1;` 로 시작해라. 저장소 밖에서 vitest 를 돌리면
  "전부 실패"처럼 보인다.
- 오래 걸리는 작업은 **중간에도 원격에 푸시**해라. 원격만 살아남는다.
- 미검증 작업은 배포 브랜치가 아니라 `claude/*-wip` 로 푸시해라.
- ⚠ **`git add -A` 로 스냅샷하면 에이전트의 임시 계측 파일(`zz*`)까지 쓸어 담는다.**
  실제로 `tests/render/zztmp-probe.test.ts` 가 그렇게 커밋에 들어갔다. 배포 전에
  `git ls-files | grep zz` 로 확인해라.
- ⚠ CI(`ci.yml`)는 `branches-ignore: []` 라 **모든 푸시에서 돈다.** 곧 WIP 스냅샷마다
  빨간 CI 가 하나씩 남는다 — 정상이다. 배포(`pages.yml`)는 배포 브랜치에서만 돈다.

---

## 4. 원격 가지 목록

| 가지 | 커밋 | 무엇 |
|---|---|---|
| **`claude/primitive-defense-game-7covq4`** | `71ce393` | **배포 브랜치.** 검증 완료본만 올린다 |
| `claude/gate-wip` | `10e1187` | 접어둔 문간 공성 1차 시도 (클리어율 1.25%로 무너짐). **위 §2 가 쓸 재료** |
| **`claude/gate2-wip`** | | **문간 공성 라운드 전체.** 배포 전 최신 작업분이 여기 있다 |
| `claude/regrow-wip` | `46363d6` | 자원 제거·재생 미검증 스냅샷 (검증 에이전트가 API 끊김으로 죽었을 때의 백업) |
| `claude/aoe-wip` | `b4d933d` | 우클릭·자동 행동 중간 백업 |
| `claude/gold-wip` · `claude/envelope-wip` · `claude/wip-raiders` | | 더 오래된 백업들 |

---

## 5. 이 저장소에서 절대 하면 안 되는 것

1. **난이도 문턱을 낮추지 마라.** `tests/sim/autoplay.probes.ts` 의 숫자 문턱은 어느 방향으로도
   안 내린다. 봉투가 빨개지면 **게임 쪽 수치를 고친다.** 이 규칙을 어긴 적이 없다.
2. **`tests/sim/__ledger__/autoplay.json` 을 손으로 고치지 마라.** `AUTOPLAY_LEDGER=1` 로
   다시 뽑고, **어느 키가 왜 움직였는지 감사해라**(`18.*` 만 움직였는가 등).
3. **저장 키 `wogawoga.save`(`src/core/save.ts`)를 바꾸지 마라** — 기존 플레이어 진행도가
   전부 날아간다. 마이그레이션 없이는 금지.
4. **저장소 이름/배포 URL 을 바꾸지 마라** — 지금 링크가 죽는다.
5. **실패 불가능한 계약을 만들지 마라.** 새 테스트를 넣으면 그 기능을 무력화하는 최소 패치로
   **실제로 빨개지는지 확인**해라. 이 저장소는 그걸 여러 번 잡았다.
6. `src/sim/**` 에서 `Math.random` 금지. `AllySim`/`EnemySim` 에 필드를 더하면
   `entities.ts` 의 `resetAlly`/`resetEnemy` 초기화와 `battle.ts hash()` 접기가 **필수**다.

---

## 6. 알려진 미해결 (급하지 않음)

- 명령을 적이 선 칸·남이 예약한 칸에 내면 처리 방식이 아직 완전하지 않다(일부 개선됨)
- `18.strongGather` 는 계약이 아니라 판단이다 — 근거는 `autoplay.probes.ts` 의 `judge18` 주석
- 화산 스테이지 가독성이 6개 바이옴 중 가장 낮다
- 무한 모드 밸런스는 채집·재생 도입 후 다시 안 쟀다
