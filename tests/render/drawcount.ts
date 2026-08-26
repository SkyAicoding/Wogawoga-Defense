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

/**
 * three 가 실제로 그리게 되는 것 = visible 한 Mesh 중
 *  · InstancedMesh 는 count > 0 인 것
 *  · BatchedMesh 는 **보이는 인스턴스가 하나라도 있는 것**(멀티드로 1콜 = 여기서 1콜)
 */
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
    if ((m as unknown as { isBatchedMesh?: boolean }).isBatchedMesh === true) {
      const t = batchedTris(m as unknown as THREE.BatchedMesh);
      if (t > 0) fn(m, t, m.castShadow);
      return;
    }
    const n = m.isInstancedMesh === true ? (m.count ?? 0) : 1;
    if (n <= 0) return;
    const g = m.geometry;
    const idx = g.getIndex();
    const t = ((idx ? idx.count : (g.getAttribute('position')?.count ?? 0)) / 3) * n;
    fn(m, t, m.castShadow);
  });
}

/**
 * BatchedMesh 가 이 프레임에 실제로 그리는 삼각형 — **보이는 인스턴스의 지오메트리 구간 합.**
 * (three 도 같은 값을 낸다: `renderMultiDraw` 가 `info.update(구간 합, mode, 1)` 을 부른다)
 *
 * 지워진 슬롯은 `getVisibleAt` 이 throw 하므로 걸러 낸다. 살아 있는 인스턴스를
 * `instanceCount` 만큼 다 세면 즉시 멈춘다 — 슬롯 전체를 훑지 않는다.
 */
function batchedTris(b: THREE.BatchedMesh): number {
  let tris = 0;
  let seen = 0;
  const live = b.instanceCount;
  for (let i = 0; i < b.maxInstanceCount && seen < live; i++) {
    let vis: boolean;
    try {
      vis = b.getVisibleAt(i);
    } catch {
      continue; // 발급된 적 없거나 반납된 슬롯
    }
    seen++;
    if (!vis) continue;
    const r = b.getGeometryRangeAt(b.getGeometryIdAt(i));
    if (r) tris += r.count / 3;
  }
  return tris;
}
