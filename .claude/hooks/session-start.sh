#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# SessionStart — 여러 기기(회사/집/폰)에서 세션을 열 때마다 **지금 상태**를 띄운다.
#
# 왜 필요한가: 이 컨테이너는 작업 트리를 자주 잃는다(한 세션에 16회 관측).
# 원격 브랜치만 살아남으므로, 새 세션이 열렸을 때 가장 먼저 답해야 할 질문은
#   "지금 트리가 원격보다 뒤처져 있는가?" 하나다. 그것만 자동으로 답한다.
#
# 설계 원칙
#  · **세션을 절대 죽이지 않는다.** 네트워크·git 실패는 전부 삼키고 계속 간다.
#  · 멱등 — 몇 번 돌려도 같다. 비대화형 — 입력을 안 받는다.
#  · 판단하지 않는다. 사실만 인쇄하고 **복구 명령은 사람이 실행**한다
#    (훅이 제멋대로 checkout 하면 커밋 안 된 작업이 조용히 날아간다).
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

DEPLOY_BRANCH="claude/primitive-defense-game-7covq4"
WIP_BRANCH="claude/gate2-wip"
ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT" || exit 0

echo "═══ Age of Dinosaurs — 세션 시작 점검 ═══"

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
for B in "$DEPLOY_BRANCH" "$WIP_BRANCH"; do
  R="origin/$B"
  git rev-parse --verify -q "$R" >/dev/null 2>&1 || continue
  BEHIND="$(git rev-list --count "HEAD..$R" 2>/dev/null || echo 0)"
  AHEAD="$(git rev-list --count "$R..HEAD" 2>/dev/null || echo 0)"
  SHORT="$(git rev-parse --short "$R" 2>/dev/null)"
  LABEL="$B"; [ "$B" = "$DEPLOY_BRANCH" ] && LABEL="$B (배포)"
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

# ── 4) 뒤처졌으면 복구 명령을 인쇄한다 (실행은 사람이) ──────────────────────
if [ "$STALE" -ne 0 ]; then
  DIRTY="$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
  echo ""
  echo "  ⚠⚠ 트리가 원격보다 뒤처졌다 — 롤백일 가능성이 높다."
  if [ "${DIRTY:-0}" -gt 0 ]; then
    echo "  ⚠ 커밋 안 된 변경이 ${DIRTY}건 있다. **먼저 살펴라** — 아래 복구는 그것을 지운다."
  fi
  echo "  복구:"
  echo "    git reset --hard -q HEAD && git clean -fdq"
  echo "    git fetch -q origin && git checkout -q -B main origin/${WIP_BRANCH}"
  echo "    npm install"
  echo "  (배포본만 필요하면 ${WIP_BRANCH} 대신 ${DEPLOY_BRANCH})"
fi

echo "═══════════════════════════════════════"
exit 0
