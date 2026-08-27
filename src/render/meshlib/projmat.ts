/**
 * ══ 티어 마스킹 재질 — "이 티어부터 나타난다" ═══════════════════════════════
 * 사용자 요구:
 *   > "창이 컬러만 바뀌거나 크기만 조금 커지는 그렇게 하지말고, 2~3개의 창이 묶음으로
 *   >  날아가거나, 창에 불이 붙어 날아가거나, 이렇게 5단계 업그레이드에 대해서 좀더
 *   >  창의적으로 만들어봐. 너무 단순해 지금은 컬러+크기 로는 구분이 안되"
 *
 * ⚠⚠ **티어마다 지오메트리를 따로 만들면 안 된다** — 이 뷰는 타워 종마다
 *   `InstancedMesh` 하나이고, 티어를 키로 더하면 메시가 5배(= 드로우콜 5배)다.
 *   전투 예산은 90콜이고 천장을 만드는 것이 이미 타워 수다(smoke.spec.ts).
 *   그래서 **한 지오메트리에 5단계를 다 굽고 정점을 접는다** — 이 저장소가 부족 습격대
 *   4종을 한 메시로 그리는 데 쓰는 바로 그 수법이다(meshlib/gait.ts VARIANT_PARS).
 *
 * ── 다만 규칙이 **다르다**: 배타가 아니라 **누적**이다 ──────────────────────
 * 습격대 쪽은 `태그 == 선택` 인 정점만 남긴다(종이 서로 배타이므로). 여기서는
 * `태그 <= 티어` 인 정점을 남긴다 — 태그가 곧 **"이 파트가 처음 붙는 티어"** 다.
 * 강화는 갈아 끼우는 것이 아니라 **덧붙는 것**이기 때문이고, 그 덕에 정점 비용도
 * 최소가 된다: 배타로 짜면 T1 인스턴스도 5단계 전부의 정점을 지고 다니지만
 * 누적이면 T1 은 1단계 것만 진다(나머지는 축퇴 삼각형이라 래스터 비용 0).
 *
 * 태그 0 = 언제나 보이는 공통 파트(습격대 쪽과 같은 규약).
 */
import * as THREE from 'three';
import { VARIANT_ATTR, VARIANT_SEL_ATTR } from './gait';

const TIER_PARS = /* glsl */ `
attribute float ${VARIANT_ATTR};
#ifdef USE_INSTANCING
attribute float ${VARIANT_SEL_ATTR};
#else
uniform float uVarSel;
#endif
`;

const TIER_MASK = /* glsl */ `
{
#ifdef USE_INSTANCING
  float wgdSel = ${VARIANT_SEL_ATTR};
#else
  float wgdSel = uVarSel;
#endif
  // 태그 0 = 공통. 그 외에는 **이 티어까지 열린 파트만** 남긴다 (누적).
  if (${VARIANT_ATTR} > 0.5 && ${VARIANT_ATTR} > wgdSel + 0.5) transformed = vec3(0.0);
}
`;

const HOOK = '#include <begin_vertex>';
const CACHE_KEY = 'wgd-proj-tier';

function patch(mat: THREE.Material): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms['uVarSel'] = { value: 5 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${TIER_PARS}`)
      .replace(HOOK, `${HOOK}\n${TIER_MASK}`);
  };
  // ⚠ three 는 onBeforeCompile 로 바뀐 소스를 프로그램 캐시 키에 안 넣는다 —
  //   이걸 빠뜨리면 같은 재질 클래스의 다른 메시가 이 셰이더를 물려받는다(gait.ts 와 같은 사정)
  mat.customProgramCacheKey = () => CACHE_KEY;
}

/**
 * **랩 전용** — 티어 하나만 보이는 새 재질을 만든다(인스턴싱 없이 개별 `Mesh` 로 그릴 때).
 * `?scene=meshlab` 이 다섯 단계를 나란히 세워 눈으로 비교하는 데 쓴다.
 * ⚠ 공유 싱글톤이 아니라 **매번 새로 만든다** — 각자 다른 `uVarSel` 을 들어야 하기 때문이다.
 *   게임 경로는 인스턴스 어트리뷰트를 쓰므로 이 함수를 안 부른다.
 */
export function tierPreviewMat(tier: number): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms['uVarSel'] = { value: tier + 1 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${TIER_PARS}`)
      .replace(HOOK, `${HOOK}\n${TIER_MASK}`);
  };
  mat.customProgramCacheKey = () => `${CACHE_KEY}-preview-${tier}`;
  return mat;
}

let _tierFlat: THREE.MeshLambertMaterial | null = null;
let _tierGlow: THREE.MeshBasicMaterial | null = null;

/** 티어 마스킹을 하는 라이팅 재질 (투사체 전용 — 공유 flatMat 을 건드리면 온 세상이 흔들린다) */
export function tierFlatMat(): THREE.MeshLambertMaterial {
  if (!_tierFlat) {
    _tierFlat = new THREE.MeshLambertMaterial({ vertexColors: true });
    patch(_tierFlat);
  }
  return _tierFlat;
}

/** 티어 마스킹을 하는 발광 재질 */
export function tierGlowMat(): THREE.MeshBasicMaterial {
  if (!_tierGlow) {
    _tierGlow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    patch(_tierGlow);
  }
  return _tierGlow;
}
