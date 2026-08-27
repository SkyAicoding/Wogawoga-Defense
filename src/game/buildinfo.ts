/**
 * **빌드 표식** — 첫 화면에 "무엇을 · 언제 · 어디서 만들었나"를 적는다.
 *
 * 사용자 요구 두 건이 이 파일의 전부다:
 *  · "여기 버전을 실제 배포 할때마다 버전도 올려줘. 버전 표시와 날짜 시간 같이
 *     표시해서 언제 업데이트 되었는지 알 수 있게 해줘."
 *  · "버전 표시 할때 하나 더 추가할거는 어디서 한건지도 표시해줘 — 회사노트북 · 집노트북 · 아이폰"
 *
 * 왜 이 셋이 같이 있어야 하는가: 사용자는 **여러 기기에서 한 작업을 이어서 한다**
 * (CLAUDE.md 「여러 기기에서 이어 하기」). 그래서 배포본을 열었을 때 알고 싶은 것이
 * "이게 내가 방금 회사에서 민 그건가, 아니면 어젯밤 집에서 민 건가"이고, 버전 번호
 * 하나로는 그 답이 안 나온다. 시각이 '언제'를, 기기가 '어디서'를 답한다.
 *
 * ⚠ **시뮬레이션은 이 파일을 읽으면 안 된다.** 값이 빌드마다 달라지므로 `src/sim/**`
 *   이 참조하는 순간 같은 시드가 빌드마다 다른 판을 밟는다(결정론이 1순위).
 */

/**
 * **배포할 때마다 올린다** (사용자 요구). 규칙:
 *  · 버그 수정·작은 UX 손질 → 패치 자리 (1.0.**1**)
 *  · 새 기능·밸런스 구조 변경 → 마이너 자리 (1.**1**.0)
 * 올리는 것을 잊지 않게 `docs/HANDOFF.md` 의 배포 절차에 적어 뒀다.
 */
export const APP_VERSION = '1.3.1';

/** 어느 기기에서 만든 배포인가 — 사용자가 쓰는 세 자리 */
export type BuildOrigin = '회사노트북' | '집노트북' | '아이폰';

/**
 * **이 배포를 만든 기기.**
 *
 * ⚠ 자동으로 알아낼 방법이 없다 — 실제 빌드는 GitHub Actions(`pages.yml`) 안에서
 *   돌고, 그 컨테이너는 사용자가 어느 기기 앞에 앉아 있는지 모른다. 세션이 그것을
 *   아는 유일한 주체라서 **배포를 준비할 때 이 한 줄을 손으로 맞춘다.**
 *   (환경변수로 빼도 값을 아는 쪽은 결국 세션이라 자리만 옮기는 셈이다.)
 */
export const BUILD_ORIGIN: BuildOrigin = '회사노트북';

/** 빌드 시각 (ISO 8601) — `vite.config.ts` 의 define 이 박는다 */
export const BUILD_TIME: string = __BUILD_TIME__;

/**
 * 빌드 시각을 **한국 시간 고정**으로 적는다 (`2026-08-27 14:32`).
 *
 * ⚠ 보는 사람의 시간대가 아니라 **KST 고정**인 이유: 이 줄이 답해야 하는 질문은
 *   "내가 아까 민 그거 맞나"이고, 사용자는 한국에 있다. 보는 기기의 시간대를 따르면
 *   같은 배포가 기기마다 다른 시각으로 보여서 대조가 안 된다.
 *
 * ⚠ 값이 비었거나 깨졌으면 **빈 문자열**을 돌려준다 — 첫 화면이 `Invalid Date` 를
 *   그리느니 시각을 안 적는 편이 낫다(정보가 없는 것과 거짓말은 다르다).
 */
export function formatBuildTime(iso: string = BUILD_TIME): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  const y = get('year'), mo = get('month'), da = get('day');
  const h = get('hour'), mi = get('minute');
  if (!y || !mo || !da || !h || !mi) return '';
  // Intl 이 24시 자정을 '24' 로 줄 수 있다 (ko-KR + hour12:false) — '00' 으로 되돌린다
  return `${y}-${mo}-${da} ${h === '24' ? '00' : h}:${mi}`;
}

/**
 * 첫 화면 한 줄 — `v1.0.1 · 2026-08-27 14:32 · 회사노트북`.
 * 시각을 못 읽으면 그 조각만 빠지고 나머지는 그대로 나온다.
 */
export function buildStamp(): string {
  const when = formatBuildTime();
  return [`v${APP_VERSION}`, when, BUILD_ORIGIN].filter(Boolean).join(' · ');
}
