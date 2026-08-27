#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# SessionStart — 여러 기기(회사/집/폰)에서 세션을 열 때마다 **지금 상태**를 띄우고,
#                롤백이면 **구조해서 되돌린다**.
#
# 왜 필요한가: 이 컨테이너는 작업 트리를 자주 잃는다. HEAD 가 옛 커밋(00e997c)으로
# 돌아가고 그 위에 옛 작업 잔재가 얹힌 상태로 세션이 열린다 — 하루에 두 번 겪었고,
# 두 번 다 **같은 673줄짜리 잔재**였다. **원격 브랜치만 살아남는다.**
#
# ── 설계에서 바뀐 것 (v2) ────────────────────────────────────────────────────
# v1 은 사실만 인쇄하고 복구는 사람에게 맡겼다. 근거는 "훅이 제멋대로 checkout 하면
# 커밋 안 된 작업이 조용히 날아간다" 였고, 그 자체는 옳다. 그런데 그 위험은
# **없앨 수 있다** — 잔재를 먼저 **원격으로** 밀어 두면 된다.
#   · /tmp 백업은 소용없다. 롤백/회수에서 같이 사라지는 자리다.
#   · 원격에 올라간 순간 그 작업은 컨테이너가 죽어도 살아남는다.
# 그래서 v2 는 **구조가 성공했을 때만** 복구한다. 하나라도 어긋나면 v1 처럼 인쇄만 한다.
#
# 자동 복구의 안전 조건 **둘 다** 만족해야 한다:
#   (A) HEAD 가 원격 wip 의 **조상**이다 (= 로컬에만 있는 커밋이 0). 아니면 그 커밋들이
#       진짜 작업일 수 있으므로 손대지 않는다.
#   (B) 커밋 안 된 변경이 있으면 **원격 구조 브랜치로 푸시에 성공**했다.
#
# 설계 원칙 (v1 에서 유지)
#  · **세션을 절대 죽이지 않는다.** 네트워크·git 실패는 전부 삼키고 계속 간다.
#  · 멱등 — 몇 번 돌려도 같다. 비대화형 — 입력을 안 받는다.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

DEPLOY_BRANCH="claude/primitive-defense-game-7covq4"
WIP_BRANCH="claude/gate2-wip"
WORK_BRANCH="main"          # 복구 후 체크아웃할 로컬 이름 (푸시는 항상 명시 refspec 이라 무관)
ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT" || exit 0

echo "═══ Age of Wogawoga — 세션 시작 점검 ═══"

# ── 1) 의존성 ───────────────────────────────────────────────────────────────
# `npm ci` 가 아니라 `npm install` 인 이유: 훅이 끝나면 컨테이너 상태가 캐시되는데
# `ci` 는 node_modules 를 매번 통째로 지워 그 캐시를 못 쓴다. 잠금 파일이 바뀌면
# install 도 그것을 따라가므로 재현성 손실은 없다.
if [ -x node_modules/.bin/vitest ] && [ -x node_modules/.bin/tsc ]; then
  echo "· 의존성 OK (건너뜀)"
else
  echo "· 의존성 설치 중…"
  if npm install --no-audit --no-fund >/tmp/npm-session-start.log 2>&1; then
    echo "· 의존성 설치 완료"
  else
    echo "‼ npm install 실패 — /tmp/npm-session-start.log 를 봐라"
    tail -5 /tmp/npm-session-start.log 2>/dev/null | sed 's/^/    /'
  fi
fi

# ── 2) 원격과 견준다 (롤백 감지) ────────────────────────────────────────────
git fetch -q origin "$DEPLOY_BRANCH" "$WIP_BRANCH" 2>/dev/null || \
  git fetch -q origin 2>/dev/null || echo "· ⚠ git fetch 실패 — 아래 비교는 낡은 정보다"

HEAD_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo '?')"
HEAD_MSG="$(git log -1 --pretty=%s 2>/dev/null || echo '?')"
echo "· HEAD   ${HEAD_SHA}  ${HEAD_MSG}"

STALE=0
BEHIND_WIP=0
AHEAD_WIP=0
for B in "$DEPLOY_BRANCH" "$WIP_BRANCH"; do
  R="origin/$B"
  git rev-parse --verify -q "$R" >/dev/null 2>&1 || continue
  BEHIND="$(git rev-list --count "HEAD..$R" 2>/dev/null || echo 0)"
  AHEAD="$(git rev-list --count "$R..HEAD" 2>/dev/null || echo 0)"
  SHORT="$(git rev-parse --short "$R" 2>/dev/null)"
  LABEL="$B"; [ "$B" = "$DEPLOY_BRANCH" ] && LABEL="$B (배포)"
  if [ "$B" = "$WIP_BRANCH" ]; then BEHIND_WIP="$BEHIND"; AHEAD_WIP="$AHEAD"; fi
  if [ "$BEHIND" -gt 0 ]; then
    echo "· ⚠ ${LABEL}  ${SHORT}  — 이 트리가 **${BEHIND}커밋 뒤처져 있다**"
    STALE=1
  else
    echo "· ${LABEL}  ${SHORT}  — 뒤처짐 없음 (앞선 커밋 ${AHEAD})"
  fi
done

# ── 3) 인수인계 문서 ────────────────────────────────────────────────────────
if [ -f docs/HANDOFF.md ]; then
  echo "· 인수인계: docs/HANDOFF.md ($(wc -l < docs/HANDOFF.md 2>/dev/null || echo '?')줄) — **먼저 읽어라**"
else
  echo "· ⚠ docs/HANDOFF.md 가 없다 — 트리가 옛 커밋일 가능성이 크다"
  STALE=1
fi

[ "$STALE" -eq 0 ] && { echo "═══════════════════════════════════════"; exit 0; }

# ── 4) 롤백이다 — 구조하고 되돌린다 ─────────────────────────────────────────
DIRTY="$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
echo ""
echo "  ⚠⚠ 트리가 원격보다 뒤처졌다 — 롤백이다."

manual_hint() {
  echo "  ⇒ 자동 복구를 **하지 않았다**: $1"
  echo "  손으로 복구하려면:"
  echo "    git reset --hard -q HEAD && git clean -fdq"
  echo "    git fetch -q origin && git checkout -q -B ${WORK_BRANCH} origin/${WIP_BRANCH}"
  echo "    npm install"
  echo "═══════════════════════════════════════"
  exit 0
}

# (A) 로컬에만 있는 커밋이 있으면 손대지 않는다 — 진짜 작업일 수 있다
if [ "${AHEAD_WIP:-0}" -gt 0 ]; then
  manual_hint "이 트리에 원격에 없는 커밋이 ${AHEAD_WIP}개 있다 (잃으면 안 되는 것일 수 있다)"
fi
if ! git rev-parse --verify -q "origin/${WIP_BRANCH}" >/dev/null 2>&1; then
  manual_hint "origin/${WIP_BRANCH} 를 못 찾았다 (fetch 실패?)"
fi

# (B) 커밋 안 된 변경이 있으면 **원격으로** 구조한다.
#     /tmp 백업은 소용없다 — 롤백/회수에서 같이 사라지는 자리다.
if [ "${DIRTY:-0}" -gt 0 ]; then
  echo "  · 커밋 안 된 변경 ${DIRTY}건 — 원격 구조 브랜치로 먼저 밀어 둔다"
  # 작업 트리와 HEAD 를 건드리지 않고 커밋 객체만 만든다 (commit-tree).
  # `git add -A` 는 .gitignore 를 존중하므로 node_modules/dist 는 안 들어간다.
  if git add -A >/dev/null 2>&1 && TREE="$(git write-tree 2>/dev/null)"; then
    # 구조 ref 이름을 **트리 해시**로 짓는다 — 같은 잔재는 같은 ref 라 멱등이고,
    # 브랜치가 무한히 쌓이지 않는다. (오늘 두 번의 잔재는 실제로 동일했다)
    # ⚠ 이 컨테이너에서는 원격 브랜치 **삭제**가 거부된다(권한). 그래서 브랜치가 쌓이지
    #   않게 만드는 것이 이름 규칙의 몫이다 — 같은 잔재 = 같은 트리 = 같은 ref = 재푸시 무해.
    #   정리가 필요하면 GitHub UI 에서 `claude/rescue/*` 를 지우면 된다.
    RESCUE="claude/rescue/${TREE:0:12}"
    MSG="rescue: 롤백 잔재 ${DIRTY}건 (HEAD ${HEAD_SHA} 위) — 자동 구조"
    if C="$(git commit-tree "$TREE" -p HEAD -m "$MSG" 2>/dev/null)" \
       && git push -q origin "$C:refs/heads/${RESCUE}" 2>/dev/null; then
      echo "  · ✅ 구조 완료 → origin/${RESCUE}  (커밋 ${C:0:12})"
      echo "       되살리려면:  git cherry-pick ${C:0:12}   또는  git diff HEAD ${C:0:12}"
      git reset -q >/dev/null 2>&1   # 인덱스만 되돌린다 (작업 트리는 그대로)
    else
      git reset -q >/dev/null 2>&1
      manual_hint "구조 브랜치 푸시에 실패했다 — 잔재를 잃을 수 없으므로 아무것도 안 건드린다"
    fi
  else
    git reset -q >/dev/null 2>&1
    manual_hint "잔재를 커밋 객체로 만들지 못했다"
  fi
fi

# (A)·(B) 통과 — 이제 잃을 것이 없다. 되돌린다.
echo "  · 복구 중… origin/${WIP_BRANCH} 로 되돌린다"
if git reset --hard -q HEAD 2>/dev/null \
   && git clean -fdq 2>/dev/null \
   && git checkout -q -f -B "$WORK_BRANCH" "origin/${WIP_BRANCH}" 2>/dev/null; then
  echo "  · ✅ 복구 완료 — HEAD $(git rev-parse --short HEAD) ($(git rev-list --count HEAD)커밋)"
  [ -f docs/HANDOFF.md ] && echo "  · docs/HANDOFF.md 돌아옴 — **먼저 읽어라**"
  if [ ! -x node_modules/.bin/vitest ]; then
    echo "  · 의존성 재설치 중…"
    npm install --no-audit --no-fund >/tmp/npm-session-start.log 2>&1 \
      && echo "  · 의존성 OK" || echo "  ‼ npm install 실패 — /tmp/npm-session-start.log"
  fi
else
  manual_hint "checkout 이 실패했다"
fi

echo "═══════════════════════════════════════"
exit 0
