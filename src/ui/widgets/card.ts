/**
 * 타워 카드 위젯 + 공용 아이콘.
 * 타워 아이콘은 src/assets/towers 의 일러스트를 쓰고, 없으면 인라인 SVG로 폴백한다
 * (SVG 폴백은 8종이 형태/색으로 확실히 구분되도록 유지).
 */
import type { AllyId, EnemyId, TowerId, TraitTag } from '@/data/types';
import { h, cls, fmt, setText } from '../dom';
import { t } from '../i18n';

/** 번들된 타워 일러스트 (파일명 = TowerId) */
const TOWER_ART = import.meta.glob<string>('../../assets/towers/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});

function towerArtUrl(id: TowerId): string | null {
  for (const [path, url] of Object.entries(TOWER_ART)) {
    if (path.endsWith(`/${id}.webp`)) return url;
  }
  return null;
}

const SVG = (body: string): string =>
  `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;

/** 타워별 상징 아이콘 — 일러스트 우선, 없으면 viewBox 48×48 SVG 폴백 */
export function towerIconSvg(id: TowerId): string {
  const art = towerArtUrl(id);
  if (art) return `<img class="tw-art" src="${art}" alt="" draggable="false" />`;
  return towerFallbackSvg(id);
}

function towerFallbackSvg(id: TowerId): string {
  switch (id) {
    case 'spear': // 창 + 짚 움막 지붕
      return SVG(
        `<path d="M6 30 L24 14 L42 30 Z" fill="#c9a35a" stroke="#5e3a1e" stroke-width="2.5"/>
         <rect x="12" y="30" width="24" height="10" rx="2" fill="#8a5a33" stroke="#5e3a1e" stroke-width="2.5"/>
         <line x1="14" y1="40" x2="38" y2="8" stroke="#a97e4f" stroke-width="3.4" stroke-linecap="round"/>
         <path d="M38 8 L44 4 L41 12 Z" fill="#b9c4c9" stroke="#4a5559" stroke-width="2"/>`,
      );
    case 'catapult': // 투석기 팔 + 바위
      return SVG(
        `<rect x="8" y="34" width="32" height="7" rx="3" fill="#8a5a33" stroke="#5e3a1e" stroke-width="2.5"/>
         <circle cx="14" cy="40" r="4" fill="#6b4a2f" stroke="#4a3220" stroke-width="2"/>
         <circle cx="34" cy="40" r="4" fill="#6b4a2f" stroke="#4a3220" stroke-width="2"/>
         <line x1="14" y1="36" x2="34" y2="14" stroke="#a97e4f" stroke-width="4" stroke-linecap="round"/>
         <circle cx="36" cy="11" r="7" fill="#9aa3a8" stroke="#4a5559" stroke-width="2.5"/>
         <circle cx="33.5" cy="9" r="2" fill="#c3ccd1"/>`,
      );
    case 'lightning': // 토템 + 번개
      return SVG(
        `<rect x="18" y="16" width="12" height="26" rx="3" fill="#7a5230" stroke="#4a3220" stroke-width="2.5"/>
         <rect x="15" y="10" width="18" height="8" rx="3" fill="#a97e4f" stroke="#4a3220" stroke-width="2.5"/>
         <circle cx="21.5" cy="24" r="1.8" fill="#2c1c0e"/><circle cx="26.5" cy="24" r="1.8" fill="#2c1c0e"/>
         <path d="M28 4 L18 22 L25 22 L20 36 L34 17 L26 17 Z" fill="#ffd94a" stroke="#a56a00" stroke-width="2" stroke-linejoin="round"/>`,
      );
    case 'brazier': // 장작 + 불꽃
      return SVG(
        `<line x1="12" y1="42" x2="36" y2="34" stroke="#6b4a2f" stroke-width="5" stroke-linecap="round"/>
         <line x1="12" y1="34" x2="36" y2="42" stroke="#8a5a33" stroke-width="5" stroke-linecap="round"/>
         <path d="M24 4 C30 12 34 16 34 24 a10 10 0 0 1 -20 0 C14 16 20 12 24 4 Z" fill="#ff7a2f" stroke="#a53d00" stroke-width="2.5"/>
         <path d="M24 16 C27 20 29 22 29 26 a5 5 0 0 1 -10 0 C19 22 22 20 24 16 Z" fill="#ffd94a"/>`,
      );
    case 'frost': // 얼음 결정
      return SVG(
        `<path d="M24 3 L33 12 L33 30 L24 43 L15 30 L15 12 Z" fill="#9fdcf7" stroke="#2c7ea6" stroke-width="2.5" stroke-linejoin="round"/>
         <path d="M24 10 L28 14 L28 28 L24 35 L20 28 L20 14 Z" fill="#e3f6ff"/>
         <line x1="24" y1="10" x2="24" y2="35" stroke="#6ebfe3" stroke-width="1.6"/>`,
      );
    case 'poison': // 가시 덩굴 + 독액
      return SVG(
        `<path d="M10 42 C16 30 14 20 24 14 C34 8 38 12 40 8" fill="none" stroke="#3f7d33" stroke-width="4.5" stroke-linecap="round"/>
         <path d="M18 28 l-6 -2 M22 20 l-6 -4 M30 12 l-3 -6 M34 11 l2 -6" stroke="#3f7d33" stroke-width="3" stroke-linecap="round"/>
         <path d="M33 26 C36 31 39 33 39 37 a6 6 0 0 1 -12 0 C27 33 30 31 33 26 Z" fill="#8bd44a" stroke="#3c6b1c" stroke-width="2.5"/>`,
      );
    case 'ballista': // 활대 + 상아 화살
      return SVG(
        `<path d="M8 34 A22 22 0 0 1 40 34" fill="none" stroke="#8a5a33" stroke-width="4.5" stroke-linecap="round"/>
         <line x1="8" y1="34" x2="40" y2="34" stroke="#d9c9a3" stroke-width="2"/>
         <line x1="24" y1="42" x2="24" y2="12" stroke="#f2e6c9" stroke-width="4" stroke-linecap="round"/>
         <path d="M24 4 L18 14 L30 14 Z" fill="#f2e6c9" stroke="#8a7a55" stroke-width="2"/>`,
      );
    case 'drum': // 전쟁북 + 북채
      return SVG(
        `<ellipse cx="24" cy="16" rx="14" ry="6" fill="#e8d9b8" stroke="#5e3a1e" stroke-width="2.5"/>
         <path d="M10 16 V34 a14 6 0 0 0 28 0 V16" fill="#b3502e" stroke="#5e3a1e" stroke-width="2.5"/>
         <path d="M12 20 l8 8 m8 0 l8 -8 m-16 6 l8 -6" stroke="#f2e0c0" stroke-width="2"/>
         <line x1="10" y1="6" x2="20" y2="13" stroke="#6b4a2f" stroke-width="3" stroke-linecap="round"/>
         <line x1="38" y1="6" x2="28" y2="13" stroke="#6b4a2f" stroke-width="3" stroke-linecap="round"/>
         <circle cx="9" cy="5" r="3" fill="#e8d9b8" stroke="#5e3a1e" stroke-width="1.6"/>
         <circle cx="39" cy="5" r="3" fill="#e8d9b8" stroke="#5e3a1e" stroke-width="1.6"/>`,
      );
  }
}

/**
 * 서 있는 타워 수 아이콘 (HUD) — 통나무 움막 실루엣.
 * '타워를 잃었다'는 사건이 3D 파티클 말고는 어디에도 안 남던 문제의 UI 층이다.
 */
export const towerCountSvg = SVG(
  `<path d="M24 5 L42 20 L38 20 L38 43 L10 43 L10 20 L6 20 Z"
     fill="#c49a5e" stroke="#4a3018" stroke-width="3" stroke-linejoin="round"/>
   <rect x="19" y="28" width="10" height="15" fill="#6b4a2f" stroke="#3a2512" stroke-width="2.5"/>`,
);

/** 골드(조개 화폐) 아이콘 */
export const goldSvg = SVG(
  `<circle cx="24" cy="24" r="17" fill="#ffd04a" stroke="#a56a00" stroke-width="3"/>
   <circle cx="24" cy="24" r="10" fill="#ffe9a3" stroke="#d9a520" stroke-width="2"/>`,
);

/** 호박(메타 재화) 아이콘 — 벌레 든 호박 보석 */
export const amberSvg = SVG(
  `<path d="M24 4 C36 4 42 14 42 24 C42 36 34 44 24 44 C14 44 6 36 6 24 C6 14 12 4 24 4 Z"
     fill="#ff9d2e" stroke="#a04c00" stroke-width="3"/>
   <path d="M24 9 C32 9 37 16 37 24 C37 33 31 39 24 39" fill="none" stroke="#ffd94a" stroke-width="3" stroke-linecap="round"/>
   <ellipse cx="22" cy="26" rx="4" ry="5.5" fill="#7a3c00"/>`,
);

/**
 * 홈타운(기지) 아이콘 — 움막 + 목책 + 활.
 * 타워 아이콘(towerCountSvg)과 실루엣이 겹치지 않게 **모닥불과 활**을 넣었다:
 * 이 패널이 파는 것이 "구조물 한 기"가 아니라 "마을이 스스로 쏜다"이기 때문이다.
 */
export const hometownIconSvg = SVG(
  `<path d="M24 6 L41 19 L37 19 L37 42 L11 42 L11 19 L7 19 Z"
     fill="#c49a5e" stroke="#4a3018" stroke-width="3" stroke-linejoin="round"/>
   <path d="M17 42 L17 30 C17 26 21 24 24 24 C27 24 31 26 31 30 L31 42 Z"
     fill="#6b4a2f" stroke="#3a2512" stroke-width="2.5" stroke-linejoin="round"/>
   <path d="M31 12 C37 16 37 24 31 28" fill="none" stroke="#e8d9b8" stroke-width="3" stroke-linecap="round"/>
   <line x1="33" y1="11" x2="33" y2="29" stroke="#a8763f" stroke-width="2.4" stroke-linecap="round"/>`,
);

/** 방해 지형지물(나무+바위) — 골드로 치우는 대상 */
export const sceneryIconSvg = SVG(
  `<path d="M6 40 C6 32 11 26 17 26 C23 26 28 32 28 40 Z" fill="#4f9440" stroke="#25502a" stroke-width="3" stroke-linejoin="round"/>
   <rect x="14.5" y="36" width="5" height="8" fill="#7a5230" stroke="#3d2a18" stroke-width="2.5"/>
   <path d="M28 44 L31 30 L38 26 L44 32 L43 44 Z" fill="#9aa39a" stroke="#3f4640" stroke-width="3" stroke-linejoin="round"/>`,
);

/**
 * 아군 부족원 아이콘 4종 (출동 바).
 * 타워 아이콘과 달리 **사람 실루엣**을 공통으로 두고 무기만 바꾼다 —
 * 3D 모델도 몸통을 공유하므로(meshlib/enemies.ts allyVariant) 아이콘과 화면이 일치한다.
 *
 * 넷째(채집꾼)만 규칙이 하나 다르다: **손에 무기가 아니라 등에 짐이 붙는다.**
 * 3D도 같은 자리에서 갈린다(kitGatherer — 전투 3종은 부피가 손·머리 위에, 채집꾼만 등에).
 * 28px 띠에서 "무기 실루엣이 없는 하나"가 그대로 "싸우지 않는 카드"로 읽힌다.
 */
const ALLY_BODY = `<circle cx="20" cy="13" r="7" fill="#e0a878" stroke="#7a4a28" stroke-width="2.5"/>
   <path d="M20 20 L20 34 M20 24 L13 30 M20 34 L14 43 M20 34 L26 43"
     fill="none" stroke="#e0a878" stroke-width="5" stroke-linecap="round"/>`;

/** 몽둥이꾼 — 굵은 나무 몽둥이를 든 근접 */
export const allyClubberSvg = SVG(
  `${ALLY_BODY}
   <path d="M27 26 L38 12" stroke="#8a5a30" stroke-width="4.5" stroke-linecap="round"/>
   <circle cx="40" cy="9" r="6" fill="#a06a38" stroke="#4a2c14" stroke-width="2.5"/>`,
);

/** 돌팔매꾼 — 돌리는 가죽끈 + 돌 (원거리) */
export const allySlingerSvg = SVG(
  `${ALLY_BODY}
   <path d="M27 24 Q40 18 38 32" fill="none" stroke="#c9a06a" stroke-width="3" stroke-linecap="round"/>
   <circle cx="38" cy="35" r="5.5" fill="#9aa39a" stroke="#3f4640" stroke-width="2.5"/>`,
);

/** 방패 파수꾼 — 큰 나무 방패 (탱커) */
export const allyGuardianSvg = SVG(
  `${ALLY_BODY}
   <path d="M32 12 L45 16 L45 30 C45 37 38 42 38 42 C38 42 31 37 31 30 Z"
     fill="#c49a5e" stroke="#4a3018" stroke-width="3" stroke-linejoin="round"/>
   <path d="M38 18 L38 36" stroke="#7a5230" stroke-width="2.5"/>`,
);

/**
 * 채집꾼 — 등에 진 광주리 + 짧은 뒤지개 (비전투).
 * 몸을 살짝 앞으로 기울인 것도 3D와 같다(짐을 진 사람은 상체를 숙인다).
 * 광주리는 마른 풀색(#dcb562 = palette C.straw)이라 파랑·회색뿐인 나머지 셋 사이에서
 * **띠에서 유일하게 따뜻한 조각**이 된다 — 3D 등짐과 같은 색이다.
 */
export const allyGathererSvg = SVG(
  `<path d="M8 30 L14 15 L27 15 L30 30 Z"
     fill="#dcb562" stroke="#7a5a24" stroke-width="2.6" stroke-linejoin="round"/>
   <path d="M12 17 L29 17" stroke="#a8792f" stroke-width="2.4"/>
   <circle cx="20" cy="12" r="6.4" fill="#e0a878" stroke="#7a4a28" stroke-width="2.5"/>
   <path d="M21 19 L22 33 M22 33 L17 43 M22 33 L28 43"
     fill="none" stroke="#e0a878" stroke-width="4.6" stroke-linecap="round"/>
   <path d="M25 23 L38 31" stroke="#8a5a30" stroke-width="4" stroke-linecap="round"/>
   <path d="M37 30 L43 36" stroke="#666e75" stroke-width="4.4" stroke-linecap="round"/>`,
);

/**
 * 집결 아이콘 — 움막 지붕 + 안쪽으로 모이는 화살 셋.
 *
 * 부족 아이콘 4종과 **일부러 실루엣을 겹치지 않게** 잡았다: 저 넷은 "누구를 뽑는가"이고
 * 이건 "어디로 모으는가"다. 사람 몸이 들어가면 다섯 번째 종족으로 읽힌다.
 * 지붕은 `hometownIconSvg` 와 같은 형태·같은 색이라 "마을로"가 낱말 없이 읽힌다.
 */
export const rallySvg = SVG(
  `<path d="M24 5 L42 20 L38 20 L38 27 L10 27 L10 20 L6 20 Z"
     fill="#c49a5e" stroke="#4a3018" stroke-width="3" stroke-linejoin="round"/>
   <path d="M5 40 L17 40 M17 40 L12 35 M17 40 L12 45"
     fill="none" stroke="#ffd04a" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
   <path d="M43 40 L31 40 M31 40 L36 35 M31 40 L36 45"
     fill="none" stroke="#ffd04a" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
   <path d="M24 31 L24 43 M24 43 L19 38 M24 43 L29 38"
     fill="none" stroke="#ffd04a" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`,
);

export const ALLY_ICON_SVG: Record<AllyId, string> = {
  clubber: allyClubberSvg,
  slinger: allySlingerSvg,
  guardian: allyGuardianSvg,
  gatherer: allyGathererSvg,
};

// ---------------------------------------------------------------------------
// 적 아이콘 16종 — **전부 코드로 그린다** (웨이브 미리보기 띠·상세가 쓴다)
//
// 규약 셋:
//  1. **28px에서 읽히는 실루엣.** 판별은 색이 아니라 형태가 한다 — 색각 이상에서도
//     뿔(트리케)·엄니(멧돼지)·펼친 날개(프테라)·활(궁수)이 그대로 갈린다.
//     그래서 어느 아이콘도 "같은 몸에 색만 다른" 형태를 쓰지 않는다.
//  2. **색은 3D 모델에서 그대로 가져온다** (render/meshlib/enemies.ts의 body/dark).
//     띠에서 본 것과 판 위에서 만나는 것이 같은 색이어야 두 화면이 이어진다.
//  3. **옆모습은 전부 오른쪽을 본다** (3D가 +x로 걷는 것과 같은 방향). 정면을 쓰는 것은
//     프테라(펼친 날개가 정면에서만 읽힌다) 하나뿐이다.
// ---------------------------------------------------------------------------

/**
 * 습격대·부족 공용 몸 — 아군 아이콘(ALLY_BODY)과 **일부러 다른 실루엣**이다.
 * 아군은 맨몸에 무기만 들지만, 적 부족은 **염색한 조끼**를 입는다(3D의 raiderVest와 같다).
 * 그 한 겹이 15px에서 아군/적을 가르는 유일한 형태 신호다.
 */
const FOE_BODY = (dye: string): string =>
  `<path d="M18 21 L18 33 M18 24 L11 29 M18 33 L12 43 M18 33 L24 43"
     fill="none" stroke="#e0a878" stroke-width="4.6" stroke-linecap="round"/>
   <path d="M12 20 L24 20 L23 32 L13 32 Z" fill="${dye}" stroke="#3a2a1c" stroke-width="2.2" stroke-linejoin="round"/>
   <circle cx="18" cy="12" r="6.4" fill="#e0a878" stroke="#7a4a28" stroke-width="2.4"/>
   <path d="M11.6 10.5 C13 5 23 5 24.4 10.5" fill="#3a2a1c"/>`;

const ENEMY_ICONS: Record<EnemyId, string> = {
  // 랩터 — 낫발톱 옆모습. 꼬리가 뒤로 곧게 뻗어 '빠름'을 말한다
  raptor: SVG(
    `<path d="M3 13 L19 25" stroke="#b84a22" stroke-width="5" stroke-linecap="round"/>
     <ellipse cx="24" cy="27" rx="11" ry="7.5" fill="#e8763a" stroke="#8f3a18" stroke-width="2.5"/>
     <path d="M20 33 L16 41 L23 43" fill="none" stroke="#b84a22" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
     <path d="M29 33 L31 41 L38 42" fill="none" stroke="#b84a22" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
     <path d="M30 24 L34 14" stroke="#e8763a" stroke-width="6" stroke-linecap="round"/>
     <path d="M30 10 L46 13 L45 19 L32 18 Z" fill="#e8763a" stroke="#8f3a18" stroke-width="2.5" stroke-linejoin="round"/>
     <circle cx="35" cy="13.6" r="1.7" fill="#2c1c0e"/>`,
  ),
  // 콤피 떼 — **두 마리**를 겹쳐 그린다. 한 마리로는 '떼'가 아니다
  compy: SVG(
    `<path d="M3 30 L11 34" stroke="#4f9130" stroke-width="3.4" stroke-linecap="round"/>
     <ellipse cx="15" cy="35" rx="6.5" ry="4.6" fill="#4f9130" stroke="#2f5c1c" stroke-width="2.2"/>
     <path d="M18 31 L21 27 L28 29 L27 33 Z" fill="#4f9130" stroke="#2f5c1c" stroke-width="2.2" stroke-linejoin="round"/>
     <path d="M13 39 L11 44 M18 39 L20 44" stroke="#2f5c1c" stroke-width="2.6" stroke-linecap="round"/>
     <path d="M8 14 L18 21" stroke="#4f9130" stroke-width="3.8" stroke-linecap="round"/>
     <ellipse cx="24" cy="23" rx="8.5" ry="6" fill="#7ac74a" stroke="#2f5c1c" stroke-width="2.4"/>
     <path d="M29 18 L32 12 L44 15 L42 21 L31 22 Z" fill="#7ac74a" stroke="#2f5c1c" stroke-width="2.4" stroke-linejoin="round"/>
     <circle cx="35" cy="16.5" r="1.7" fill="#2c1c0e"/>
     <path d="M21 28 L19 35 M27 28 L29 35" stroke="#2f5c1c" stroke-width="3" stroke-linecap="round"/>`,
  ),
  // 원시 멧돼지 — 갈기(등의 톱니)와 위로 휜 엄니. 낮고 뭉툭하다
  boar: SVG(
    `<path d="M4 22 C6 18 8 20 8 24" fill="none" stroke="#4f3220" stroke-width="3" stroke-linecap="round"/>
     <path d="M10 20 l3 -6 l3 6 l3 -7 l3 7 l3 -6 l3 6" fill="none" stroke="#4f3220" stroke-width="3" stroke-linejoin="round"/>
     <ellipse cx="21" cy="27" rx="13" ry="9" fill="#8a5a3a" stroke="#4f3220" stroke-width="2.6"/>
     <path d="M32 22 C40 22 43 26 43 29 C43 32 39 34 34 33" fill="#a8734a" stroke="#4f3220" stroke-width="2.6" stroke-linejoin="round"/>
     <circle cx="35" cy="26" r="1.8" fill="#2c1c0e"/>
     <path d="M41 31 C44 30 45 26 43 23" fill="none" stroke="#f2e6c9" stroke-width="3.2" stroke-linecap="round"/>
     <path d="M14 35 L13 43 M20 36 L20 44 M27 35 L28 43" stroke="#5f3d24" stroke-width="3.4" stroke-linecap="round"/>`,
  ),
  // 트리케라톱스 — **프릴 + 세 뿔**. 이 종의 전부가 머리에 있어 머리를 크게 잡는다
  trike: SVG(
    `<path d="M3 26 L14 29" stroke="#6f7a38" stroke-width="4.4" stroke-linecap="round"/>
     <ellipse cx="20" cy="30" rx="12" ry="8.5" fill="#92a04c" stroke="#59632a" stroke-width="2.6"/>
     <path d="M13 37 L12 44 M20 38 L20 44 M27 37 L28 44" stroke="#6f7a38" stroke-width="3.6" stroke-linecap="round"/>
     <path d="M30 30 C30 18 36 12 40 12 C45 12 47 20 46 28 C45 34 38 37 32 35 Z"
       fill="#d9873a" stroke="#8f4f18" stroke-width="2.6" stroke-linejoin="round"/>
     <path d="M40 30 C44 30 46 27 46 24" fill="none" stroke="#92a04c" stroke-width="6" stroke-linecap="round"/>
     <path d="M36 12 L33 3 M44 14 L45 4" stroke="#f2e6c9" stroke-width="3.4" stroke-linecap="round"/>
     <path d="M45 26 L47 21" stroke="#f2e6c9" stroke-width="3" stroke-linecap="round"/>
     <circle cx="41" cy="24" r="1.7" fill="#2c1c0e"/>`,
  ),
  // 프테라노돈 — **유일한 정면**. 펼친 날개는 정면에서만 읽힌다 (하늘 = 형태로 구분)
  ptera: SVG(
    `<path d="M2 16 C12 12 18 16 22 24 C18 22 10 22 4 26 Z" fill="#c06a3e" stroke="#7e401f" stroke-width="2.5" stroke-linejoin="round"/>
     <path d="M46 16 C36 12 30 16 26 24 C30 22 38 22 44 26 Z" fill="#c06a3e" stroke="#7e401f" stroke-width="2.5" stroke-linejoin="round"/>
     <ellipse cx="24" cy="27" rx="5" ry="8" fill="#d98a5a" stroke="#7e401f" stroke-width="2.5"/>
     <path d="M20 12 L28 12 L26 19 L22 19 Z" fill="#d98a5a" stroke="#7e401f" stroke-width="2.4" stroke-linejoin="round"/>
     <path d="M20 12 L11 6 L22 8 Z" fill="#e8c060" stroke="#8f6a10" stroke-width="2.2" stroke-linejoin="round"/>
     <path d="M24 19 L24 26" stroke="#7e401f" stroke-width="2.2"/>
     <circle cx="26" cy="12.5" r="1.5" fill="#2c1c0e"/>`,
  ),
  // 안킬로사우루스 — 등딱지 판 + 꼬리 곤봉. 가장 낮고 넓은 실루엣
  ankylo: SVG(
    `<path d="M8 30 C8 20 16 16 25 16 C34 16 41 21 41 30 Z" fill="#6a5a38" stroke="#41371f" stroke-width="2.6" stroke-linejoin="round"/>
     <path d="M13 24 l4 -4 M22 19 l4 -4 M31 21 l4 -4" stroke="#7d6c44" stroke-width="3.4" stroke-linecap="round"/>
     <path d="M6 30 L42 30 C42 35 38 37 30 37 L16 37 C10 37 6 35 6 30 Z" fill="#9a824a" stroke="#41371f" stroke-width="2.6" stroke-linejoin="round"/>
     <path d="M41 31 C46 30 47 27 45 25" fill="none" stroke="#9a824a" stroke-width="5" stroke-linecap="round"/>
     <circle cx="8" cy="34" r="6" fill="#6a5a38" stroke="#41371f" stroke-width="2.6"/>
     <path d="M14 38 L13 44 M24 38 L24 44 M34 37 L35 43" stroke="#5f5232" stroke-width="3.4" stroke-linecap="round"/>
     <circle cx="41" cy="28" r="1.6" fill="#2c1c0e"/>`,
  ),
  // 부족 전사 — **둥근 방패**가 정체성 (아군 파수꾼의 긴 널방패와 형태로 갈린다)
  warrior: SVG(
    `${FOE_BODY('#b85c2e')}
     <path d="M28 18 L40 15 L44 25 L38 36 L28 32 Z" fill="#8a4a2e" stroke="#4a2c14" stroke-width="2.6" stroke-linejoin="round"/>
     <circle cx="36" cy="25.5" r="4" fill="#e8d9b8" stroke="#4a2c14" stroke-width="2.2"/>`,
  ),
  // 부족 주술사 — 깃털 관 + 치유의 그릇 (같은 사람 몸이라도 머리 장식이 갈라 준다)
  shaman: SVG(
    `${FOE_BODY('#8a4a9e')}
     <path d="M12 7 L9 2 M18 5 L18 1 M24 7 L27 2" stroke="#e8d2a0" stroke-width="2.6" stroke-linecap="round"/>
     <path d="M26 26 C26 21 32 18 36 18 C41 18 44 22 44 26" fill="none" stroke="#6ff2c8" stroke-width="3" stroke-linecap="round"/>
     <ellipse cx="35" cy="30" rx="9" ry="4.5" fill="#e8d2a0" stroke="#4a2c14" stroke-width="2.4"/>`,
  ),
  // 부족 투창병 — 짧은 창을 **머리 위로** 치켜든 던지기 자세 (가장 자주 던지는 종)
  blade: SVG(
    `${FOE_BODY('#d2492f')}
     <path d="M24 24 L33 15" stroke="#e0a878" stroke-width="4.6" stroke-linecap="round"/>
     <path d="M27 21 L43 10" stroke="#a8703f" stroke-width="3.4" stroke-linecap="round"/>
     <path d="M43 10 L47 4 L43 15 Z" fill="#e8d9b8" stroke="#4a2c14" stroke-width="1.8" stroke-linejoin="round"/>`,
  ),
  // 부족 큰창잡이 — **길고 낮게 겨눈** 장창 + 가죽 어깨판(장갑 3)
  lancer: SVG(
    `${FOE_BODY('#2f8a94')}
     <path d="M10 19 L26 19" stroke="#7d5230" stroke-width="3" stroke-linecap="round"/>
     <path d="M24 25 L32 25" stroke="#e0a878" stroke-width="4.6" stroke-linecap="round"/>
     <path d="M6 30 L44 22" stroke="#a8703f" stroke-width="3.4" stroke-linecap="round"/>
     <path d="M44 22 L48 21 L43 27 Z" fill="#e8d9b8" stroke="#4a2c14" stroke-width="1.8" stroke-linejoin="round"/>`,
  ),
  // 부족 궁수 — **당긴 활**. 곡선 하나로 전 종과 갈린다
  archer: SVG(
    `${FOE_BODY('#5f8f3a')}
     <path d="M34 8 C44 16 44 30 34 38" fill="none" stroke="#a8703f" stroke-width="3.4" stroke-linecap="round"/>
     <path d="M34 8 L34 38" stroke="#e8d9b8" stroke-width="1.8"/>
     <path d="M22 23 L42 23" stroke="#e8d9b8" stroke-width="2.4" stroke-linecap="round"/>
     <path d="M42 23 L46 23" stroke="#e8d9b8" stroke-width="2.4" stroke-linecap="round"/>`,
  ),
  // 부족 저주사 — 지팡이 끝의 룬 (침묵). 위로 솟은 한 점이 실루엣의 전부다
  hexer: SVG(
    `${FOE_BODY('#a8228c')}
     <path d="M24 24 L31 20" stroke="#e0a878" stroke-width="4.6" stroke-linecap="round"/>
     <path d="M33 40 L37 12" stroke="#7d5230" stroke-width="3.4" stroke-linecap="round"/>
     <path d="M37 12 L33 6 L38 2 L43 6 L40 12 Z" fill="#c86ae0" stroke="#5b2a6e" stroke-width="2.2" stroke-linejoin="round"/>
     <path d="M36.5 7.5 L39.5 7.5 M38 5 L38 10" stroke="#f2d9ff" stroke-width="1.8" stroke-linecap="round"/>`,
  ),
  // 매머드 — 늘어진 코 + 큰 엄니. 털이 실루엣 아래로 흘러내린다
  mammoth: SVG(
    `<path d="M6 20 C6 13 12 9 20 9 C29 9 35 14 35 22 L35 34 L8 34 Z"
       fill="#a06a3a" stroke="#5f3d20" stroke-width="2.6" stroke-linejoin="round"/>
     <path d="M8 34 l4 8 M17 34 l-1 9 M26 34 l2 9" stroke="#7a4c28" stroke-width="3.6" stroke-linecap="round"/>
     <path d="M33 14 C41 14 44 19 44 24 C44 28 41 31 38 31" fill="#b8804a" stroke="#5f3d20" stroke-width="2.6" stroke-linejoin="round"/>
     <path d="M40 30 C42 36 40 41 36 43" fill="none" stroke="#b8804a" stroke-width="4.4" stroke-linecap="round"/>
     <path d="M36 28 C42 30 46 36 45 42" fill="none" stroke="#f2e6c9" stroke-width="3.4" stroke-linecap="round"/>
     <circle cx="38" cy="20" r="1.7" fill="#2c1c0e"/>`,
  ),
  // 스피노사우루스 — **등돛**. 미니보스는 실루엣 위쪽이 크다
  spino: SVG(
    `<path d="M8 26 C10 10 22 6 30 10 C26 14 24 20 24 26 Z" fill="#2f6a7a" stroke="#1b4653" stroke-width="2.5" stroke-linejoin="round"/>
     <path d="M3 30 L12 28" stroke="#2f6a7a" stroke-width="4.4" stroke-linecap="round"/>
     <ellipse cx="20" cy="30" rx="12" ry="7.5" fill="#4a8a9a" stroke="#1b4653" stroke-width="2.5"/>
     <path d="M15 36 L13 44 M25 36 L27 44" stroke="#2f6a7a" stroke-width="3.8" stroke-linecap="round"/>
     <path d="M29 26 L34 20" stroke="#4a8a9a" stroke-width="6" stroke-linecap="round"/>
     <path d="M30 16 L47 20 L46 25 L32 24 Z" fill="#4a8a9a" stroke="#1b4653" stroke-width="2.5" stroke-linejoin="round"/>
     <circle cx="35" cy="19.5" r="1.6" fill="#2c1c0e"/>`,
  ),
  // 티라노사우루스 — 거대한 턱과 짧은 앞발. 머리 하나가 몸의 절반이다
  trex: SVG(
    `<path d="M2 16 L16 26" stroke="#4f2c20" stroke-width="5.4" stroke-linecap="round"/>
     <ellipse cx="20" cy="29" rx="11" ry="8" fill="#7a4636" stroke="#3d2118" stroke-width="2.6"/>
     <path d="M15 36 L12 44 L20 45" fill="none" stroke="#4f2c20" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
     <path d="M26 34 L30 42" stroke="#4f2c20" stroke-width="4" stroke-linecap="round"/>
     <path d="M27 24 L30 9 L46 8 L46 16 L34 18 Z" fill="#7a4636" stroke="#3d2118" stroke-width="2.6" stroke-linejoin="round"/>
     <path d="M34 18 L46 17 L45 23 L33 21 Z" fill="#d9b382" stroke="#3d2118" stroke-width="2.2" stroke-linejoin="round"/>
     <path d="M36 18 L37 21 M40 18 L41 21 M44 18 L44.5 21" stroke="#3d2118" stroke-width="1.6"/>
     <path d="M28 26 L33 30" stroke="#7a4636" stroke-width="3.4" stroke-linecap="round"/>
     <circle cx="34" cy="12.5" r="1.9" fill="#2c1c0e"/>`,
  ),
  // 화산 골렘 — 각진 바위 덩어리 + 용암 균열. 곡선이 하나도 없는 유일한 종
  golem: SVG(
    `<path d="M14 8 L34 8 L38 20 L34 24 L36 42 L12 42 L14 24 L10 20 Z"
       fill="#584641" stroke="#2b201d" stroke-width="2.8" stroke-linejoin="round"/>
     <path d="M6 18 L12 14 L14 30 L7 32 Z" fill="#43332f" stroke="#2b201d" stroke-width="2.6" stroke-linejoin="round"/>
     <path d="M42 18 L36 14 L34 30 L41 32 Z" fill="#43332f" stroke="#2b201d" stroke-width="2.6" stroke-linejoin="round"/>
     <path d="M20 10 L18 20 L26 22 L22 34 L30 26 L23 24 L28 14 Z" fill="#ff7a2f" stroke="#a53d00" stroke-width="1.8" stroke-linejoin="round"/>
     <path d="M17 13 h5 M28 13 h5" stroke="#ffd94a" stroke-width="3" stroke-linecap="round"/>`,
  ),
};

/** 적 상징 아이콘 (viewBox 48×48 인라인 SVG) — 16종 전부 있다 */
export function enemyIconSvg(id: EnemyId): string {
  return ENEMY_ICONS[id];
}

// ---------------------------------------------------------------------------
// 특성 배지 아이콘 6종 — **단색**(currentColor)이라 CSS가 색을 정한다.
// 배지는 색만으로 구분되지 않는다: 형태 + 옆의 한 단어(i18n)가 항상 함께 간다.
// ---------------------------------------------------------------------------
const BADGE = (body: string): string =>
  `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;

const TRAIT_ICONS: Record<TraitTag, string> = {
  // 하늘 — 위로 뻗은 두 날개
  air: BADGE(
    `<path d="M2 14 C7 7 11 8 12 13 C13 8 17 7 22 14 C17 12 13 13 12 17 C11 13 7 12 2 14 Z" fill="currentColor"/>`,
  ),
  // 방패 — 겹 방패(피해를 통째로 버린다)
  shield: BADGE(
    `<path d="M12 2 L21 5 V12 C21 17 17 21 12 22 C7 21 3 17 3 12 V5 Z" fill="currentColor"/>
     <path d="M12 6 L17 7.6 V12 C17 15 15 17.5 12 18.4 Z" fill="rgba(0,0,0,0.35)"/>`,
  ),
  // 장갑 — 비늘판 세 겹(타격을 깎는다)
  armor: BADGE(
    `<path d="M4 6 h16 v4 H4 Z M6 11 h12 v4 H6 Z M8 16 h8 v4 H8 Z" fill="currentColor"/>`,
  ),
  // 가죽 — 두꺼운 판 위로 튕겨 나가는 큰 타격(한 방의 상한). 장갑의 '겹'과 반대로
  // **한 겹의 두꺼운 판** + 위쪽 화살표라 15~20px에서도 장갑과 헷갈리지 않는다.
  hide: BADGE(
    `<path d="M3 14 h18 v6 H3 Z" fill="currentColor"/>
     <path d="M12 3 L18 11 H6 Z" fill="currentColor" opacity="0.75"/>`,
  ),
  // 정화 — 네 갈래 반짝임(✧). 치유의 십자와 달리 **대각선**이고 가운데가 비어 있어
  // 15~20px에서도 십자와 안 헷갈린다. 상태이상이 "벗겨져 흩어진다"는 뜻이다.
  purge: BADGE(
    `<path d="M12 2 L13.8 9.2 L21 11 L13.8 12.8 L12 20 L10.2 12.8 L3 11 L10.2 9.2 Z" fill="currentColor"/>
     <circle cx="12" cy="11" r="2.1" fill="rgba(0,0,0,0.45)"/>`,
  ),
  // 흩어짐 — 중심에서 사방으로 흩어지는 파편(폭발만 깎는다)
  splash: BADGE(
    `<circle cx="12" cy="12" r="3.2" fill="currentColor"/>
     <path d="M12 2 l1.6 3.6 h-3.2 Z M12 22 l-1.6 -3.6 h3.2 Z M2 12 l3.6 -1.6 v3.2 Z M22 12 l-3.6 1.6 v-3.2 Z
              M5 5 l3.4 1.4 -2 2 Z M19 19 l-3.4 -1.4 2 -2 Z M19 5 l-1.4 3.4 -2 -2 Z M5 19 l1.4 -3.4 2 2 Z"
           fill="currentColor" opacity="0.8"/>`,
  ),
  // 치유 — 십자
  heal: BADGE(`<path d="M10 3 h4 v7 h7 v4 h-7 v7 h-4 v-7 H3 v-4 h7 Z" fill="currentColor"/>`),
  // 습격 — 부러진 기둥(내 타워를 부순다)
  raid: BADGE(
    `<path d="M5 21 L8 9 L13 10 L11 21 Z" fill="currentColor"/>
     <path d="M9 7 L20 2 L21 6 L11 10 Z" fill="currentColor"/>
     <path d="M15 14 l3 3 l-3 3 l6 0 l0 -6 Z" fill="currentColor"/>`,
  ),
  // 격노 — 위로 튀는 쐐기(저체력에서 빨라진다)
  enrage: BADGE(`<path d="M13 2 L4 13 h6 l-2 9 l11 -13 h-7 Z" fill="currentColor"/>`),
};

/** 특성 배지 아이콘 (viewBox 24×24, 단색) */
export function traitIconSvg(tag: TraitTag): string {
  return TRAIT_ICONS[tag];
}

/*
 * heartSvg(기지 HP 하트)는 삭제됐다 — 유일한 사용처였던 HUD 둘째 줄(.hud-hp)이
 * 사용자 요청으로 사라졌고, 기지 HP는 홈타운 지붕 위 3D 바가 맡는다.
 * 3D로 다시 만들지 않은 이유는 render/views/healthbars.ts 헤더에 있다
 * (15~20px 화면에서 안 읽히고 드로우콜만 먹는다).
 */

/** 별 (채움/빈칸) */
export function starSvg(filled: boolean): string {
  const fill = filled ? '#ffd94a' : '#4d4438';
  const stroke = filled ? '#a56a00' : '#332c22';
  return SVG(
    `<path d="M24 3 L30 17 L45 18 L34 28 L37 43 L24 35 L11 43 L14 28 L3 18 L18 17 Z"
       fill="${fill}" stroke="${stroke}" stroke-width="3" stroke-linejoin="round"/>`,
  );
}

/** 자물쇠 */
export const lockSvg = SVG(
  `<rect x="10" y="20" width="28" height="22" rx="5" fill="#8a8073" stroke="#3c352b" stroke-width="3"/>
   <path d="M15 20 v-4 a9 9 0 0 1 18 0 v4" fill="none" stroke="#3c352b" stroke-width="4"/>
   <circle cx="24" cy="30" r="3.4" fill="#3c352b"/>`,
);

// ---------------------------------------------------------------------------
// 전투 카드 컴포넌트
// ---------------------------------------------------------------------------
export interface TowerCardOpts {
  towerId: TowerId;
  cost: number;
  onTap: () => void;
}

export interface TowerCard {
  el: HTMLElement;
  towerId: TowerId;
  setSelected(on: boolean): void;
  setDisabled(on: boolean): void;
  setCost(cost: number): void;
  /**
   * 이번 웨이브의 상성 표시.
   *  · `counter` = 이 카드를 무력하게 만드는 특성(없으면 null) → 회색 오버레이 + 배지
   *  · `favored` = 이 카드가 잘 듣는다 → 옅은 테두리
   * **둘 다 판정은 data/balance.counteredBy·favoredAgainst가 한다** — 화면은 그리기만 하고
   * 판정을 흉내 내지 않는다(테스트가 같은 함수를 잠근다).
   */
  setCounter(counter: TraitTag | null, favored: boolean): void;
}

/** 전투 HUD 하단의 타워 카드. 선택/골드 부족 상태는 매 프레임 diff 갱신된다. */
export function createTowerCard(opts: TowerCardOpts): TowerCard {
  const costEl = h('span', { class: 'tcard-cost-num', text: fmt(opts.cost) });
  // 상성 배지 — 회색 오버레이만으로는 "왜 약한가"를 말하지 못한다.
  // 색(회색)과 형태(특성 아이콘)를 함께 주는 것이 색각 대응의 최소 형태다.
  const warn = h('span', { class: 'tcard-warn', attrs: { style: 'display:none' } });
  const el = h(
    'button',
    { class: 'tcard', attrs: { type: 'button' }, onClick: opts.onTap },
    h('span', { class: 'tcard-icon', html: towerIconSvg(opts.towerId) }),
    h('span', { class: 'tcard-name', text: t(`tower.${opts.towerId}.name`) }),
    h('span', { class: 'tcard-cost', html: goldSvg }, costEl),
    warn,
  );
  let lastCounter: TraitTag | null | undefined;
  let lastFavored: boolean | undefined;
  return {
    el,
    towerId: opts.towerId,
    setSelected(on) {
      cls(el, 'is-selected', on);
    },
    setDisabled(on) {
      cls(el, 'is-disabled', on);
    },
    setCost(cost) {
      setText(costEl, fmt(cost));
    },
    setCounter(counter, favored) {
      if (counter !== lastCounter) {
        lastCounter = counter;
        cls(el, 'is-countered', counter !== null);
        warn.style.display = counter ? '' : 'none';
        if (counter) {
          warn.innerHTML = traitIconSvg(counter);
          warn.className = `tcard-warn tcard-warn--${counter}`;
          const label = t('battle.preview.weakVs', { n: t(`trait.${counter}.name`) });
          warn.setAttribute('title', label);
          warn.setAttribute('aria-label', label);
        }
      }
      if (favored !== lastFavored) {
        lastFavored = favored;
        cls(el, 'is-favored', favored);
      }
    },
  };
}
