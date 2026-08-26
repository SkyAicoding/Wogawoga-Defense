/**
 * **씬 그래프 잣대** — WebGL 없이 "three 가 이 프레임에 무엇을 그리게 되는가"를 센다.
 *
 * 원래 `tests/render/gatebudget.test.ts` 안에 있던 함수다. 비전투 배경 예산
 * (`warmup.test.ts`)이 **같은 잣대**를 써야 두 파일의 실측값을 나란히 읽을 수 있어서
 * 여기로 뺐다 — 사본을 두면 한쪽만 고쳐지는 날 두 파일의 숫자가 조용히 다른 것을 뜻하게 된다.
 *
 * ⚠ 이 잣대가 세는 것은 씬 그래프이지 실제 렌더러가 아니다. 절대값은 실제 프레임보다
 *   작다(포스트 패스·클리어가 빠진다). 실측 대조: s1 배경 정지 프레임이 여기서 10콜,
 *   같은 프레임을 크로미움(swiftshader)에서 `gl.draw*` 로 세면 11콜이다 — 상수 +1 차이라
 *   **증감을 읽는 데는 같은 값**이다.
 */
import * as THREE from 'three';

/** three 가 실제로 그리게 되는 것 = visible 한 Mesh 중 InstancedMesh 는 count > 0 인 것 */
export function drawables(scene: THREE.Object3D): { calls: number; tris: number } {
  let calls = 0;
  let tris = 0;
  forEachDrawn(scene, (_m, t, shadow) => {
    calls += shadow ? 2 : 1;
    tris += shadow ? t * 2 : t;
  });
  return { calls, tris: Math.round(tris) };
}

/**
 * 그려질 메시 하나하나를 훑는다. 그림자 캐스터는 **컬러 패스 + 그림자 패스 두 번**
 * 그려지므로 `shadow=true` 로 알린다 (enemyview.ts UNIT_SHADOW 주석이 같은 잣대를 쓴다).
 */
export function forEachDrawn(
  scene: THREE.Object3D,
  fn: (mesh: THREE.Mesh, tris: number, shadow: boolean) => void,
): void {
  scene.traverseVisible((o) => {
    const m = o as THREE.Mesh & { isMesh?: boolean; isInstancedMesh?: boolean; count?: number };
    if (m.isMesh !== true) return;
    const n = m.isInstancedMesh === true ? (m.count ?? 0) : 1;
    if (n <= 0) return;
    const g = m.geometry;
    const idx = g.getIndex();
    const t = ((idx ? idx.count : (g.getAttribute('position')?.count ?? 0)) / 3) * n;
    fn(m, t, m.castShadow);
  });
}
