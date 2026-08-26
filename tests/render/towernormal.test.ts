/**
 * **묶기가 음영에 무엇을 했는가** — `BatchedMesh` 의 노멀 근사가 만드는 오차의 상한.
 *
 * ── 무엇이 문제인가 ────────────────────────────────────────────────────────
 * 개별 `Mesh` 는 노멀 행렬을 JS 에서 `transpose(inverse(mat3(M)))` 로 정확히 굽는다.
 * `BatchedMesh` 에는 인스턴스별 노멀 행렬 자리가 없어서 three 가 셰이더에서
 * **근사**한다 (node_modules/three/.../ShaderChunk/defaultnormal_vertex.glsl.js):
 *
 *     // this is in lieu of a per-instance normal-matrix
 *     // shear transforms in the instance matrix are not supported
 *     mat3 bm = mat3( batchingMatrix );
 *     transformedNormal /= vec3( dot(bm[0],bm[0]), dot(bm[1],bm[1]), dot(bm[2],bm[2]) );
 *     transformedNormal = bm * transformedNormal;
 *
 * 열마다 제 길이로 나누는 이 식은 **회전 × 축정렬 스케일**에서는 정확하고 **전단에서는
 * 틀린다.** 그리고 타워 리그는 전단을 만든다: `towerview.ts` 가 루트에
 * `root.scale.set(sx, sy, sx)` 로 **비등방** 스케일을 거는 자리가 셋 있고
 * (반동 sy×(1−0.05k)/sx×(1+0.035k) · 피격 흔들림 sy×(1−0.07k)/sx×(1+0.05k) ·
 *  drum 오라 펄스 ±3.5%), 그 아래에서 action 이 X축으로 돈다(투석기 팔·창 찌르기).
 * 월드 비등방 스케일 × 비Y 회전 = 전단이다.
 * ⚠ 팝(배치/업그레이드)은 sx·sy 를 **같은 값**으로 곱하므로 전단을 안 만든다 — 실측 0.
 *
 * ⚠ 요(Y) 회전만으로는 전단이 안 생긴다 — `diag(sx,sy,sx)` 는 xz 평면에서 등방이라
 *   Y 회전과 **교환된다**. 그래서 조준만 하는 타워는 오차가 정확히 0이다.
 *
 * ── 이 파일이 잠그는 것 ────────────────────────────────────────────────────
 * 오차가 **눈에 안 보이는 크기로 묶여 있다**는 것. 실측(이 계기, 전 종·전 티어·발사 전
 * 구간): 최대 3.9° (catapult T5 반동 정점), 태양 방향 램버트 항 |Δdot| 0.063.
 * 앞 라운드의 실제 픽셀 A/B 가 같은 자리에서 **채널당 1~3 레벨**을 쟀다 — 실루엣은
 * 완전히 일치했고 형태·색·그림자는 그대로였다.
 *
 * 새 타워나 새 애니메이션이 **큰 회전 아래에 비등방 스케일**을 넣으면 이 오차가 커진다.
 * 그때 이 파일이 빨개진다 — 그게 이 파일의 존재 이유다.
 *
 * ⚠ 식을 베끼지 않는다: 인스턴스 행렬을 `BatchedMesh` 에서 **되읽고**(그래서 float32
 *   저장까지 포함된다) 노멀도 묶음의 병합 지오메트리에서 되읽는다. 뷰의 애니메이션
 *   식을 베끼면 뷰만 고치는 회귀가 조용히 통과한다(CLAUDE.md 처방).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { build } from '@/render/stage3d';
import { ALL_TOWER_IDS, STAGES } from '@/data';
import type { EnemyState, TowerId, TowerState } from '@/data/types';

const Q = { shadows: true, particles: 1, antialias: true, dpr: 2, groundDetail: 1 } as never;
const IDS = ALL_TOWER_IDS as readonly TowerId[];
/** 씬의 태양 방향 — stage3d.ts `sun.position.set(diag*0.7, diag*1.1, diag*0.4)`, target 원점 */
const SUN = new THREE.Vector3(0.7, 1.1, 0.4).normalize();
/**
 * 라이팅을 받는 묶음만 본다. `towerActionGlow` 는 `MeshBasicMaterial`(무라이팅)이라
 * 노멀이 화면에 안 실린다 — 거기서 오차를 재면 안 보이는 것을 재는 것이다.
 */
const LIT = ['towerBody', 'towerActionFlat'] as const;

function foe(id: number, x: number, z: number): EnemyState {
  return {
    id, defId: 'raptor', hp: 10, maxHp: 10, shieldHitsLeft: 0, dist: 3, pathIndex: 0,
    attackCdLeft: 0, towerTargetId: -1, siegeHoldLeft: 0, attackAnimLeft: 0, attackAnimTicks: 0,
    blockerAllyId: -1, gateTicks: 0, gateBiteCdLeft: 0, gateOwed: 0, flying: false,
    x, z, prevX: x, prevZ: z, heading: 0, statuses: [], bounty: 1, baseDamage: 1,
    radius: 0.3, alive: true, hpMul: 1,
  } as never;
}

function tower(id: number, defId: TowerId, tier: number, cellX: number, cellZ: number): TowerState {
  return {
    id, defId, tier, hp: 9, maxHp: 10, silenceLeft: 0, cellX, cellZ,
    cooldownLeft: 0, targetId: 1, targeting: 'first', invested: 10, buffDmgPct: 0, buffRatePct: 0,
  } as never;
}

/** 개별 Mesh 경로 — three 가 JS 배정밀도로 굽는 정확한 노멀 행렬 */
function exact(M: THREE.Matrix4, n: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  return out.copy(n).applyMatrix3(new THREE.Matrix3().getNormalMatrix(M)).normalize();
}

/** BatchedMesh 경로 — three 의 USE_BATCHING 분기를 그대로 옮긴 것 (위 주석의 GLSL) */
function batched(M: THREE.Matrix4, n: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const e = M.elements;
  const c0 = new THREE.Vector3(e[0]!, e[1]!, e[2]!);
  const c1 = new THREE.Vector3(e[4]!, e[5]!, e[6]!);
  const c2 = new THREE.Vector3(e[8]!, e[9]!, e[10]!);
  const t = n.clone();
  t.x /= c0.dot(c0);
  t.y /= c1.dot(c1);
  t.z /= c2.dot(c2);
  return out
    .set(
      c0.x * t.x + c1.x * t.y + c2.x * t.z,
      c0.y * t.x + c1.y * t.y + c2.y * t.z,
      c0.z * t.x + c1.z * t.y + c2.z * t.z,
    )
    .normalize();
}

interface Worst {
  deg: number;
  dot: number;
  who: string;
}

/**
 * 씬을 세우고 애니메이션 전 구간을 돌면서, 매 프레임 **묶음에서 되읽은** 인스턴스 행렬과
 * 병합 지오메트리 노멀로 두 경로의 노멀 차이를 잰다.
 * @param onlyId 이 종만 본다(null이면 전부)
 */
function sweep(onlyId: TowerId | null): Worst {
  const s3 = build(STAGES[0]!, Q);
  const list: TowerState[] = [];
  const ids = onlyId ? [onlyId] : IDS;
  let k = 0;
  for (const id of ids) {
    for (const tier of [0, 4]) {
      const cx = 2 + (k % 8);
      const cz = 2 + Math.floor(k / 8);
      s3.towers.add(k + 1, id, tier, cx, cz);
      list.push(tower(k + 1, id, tier, cx, cz));
      k++;
    }
  }
  // 적을 한 마리 세워 조준(요 회전)까지 켠다 — 회전 없이는 전단이 안 생긴다
  const foes = [foe(1, 9, 9)];
  const cw = s3.cellToWorld.bind(s3);
  const worst: Worst = { deg: 0, dot: 0, who: '(없음)' };
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const n = new THREE.Vector3();
  const M = new THREE.Matrix4();

  for (let f = 0; f < 130; f++) {
    // 팝(0.3s)이 끝난 뒤 발사를 두 번 — 반동(0.22s) 구간을 통째로 지난다
    if (f === 30 || f === 90) for (const t of list) s3.towers.recoil(t.id);
    if (f === 60) for (const t of list) s3.towers.hit(t.id);
    s3.towers.aim(list, foes, 1);
    s3.enemies.update(foes, 1, cw, 1 / 60, []);
    s3.update(1 / 60);

    for (const name of LIT) {
      const mesh = s3.scene.getObjectByName(name) as THREE.BatchedMesh | undefined;
      if (!mesh || !mesh.visible) continue;
      const nrm = mesh.geometry.getAttribute('normal');
      expect(nrm, `${name} 의 병합 지오메트리에 normal 이 없다`).toBeTruthy();
      let seen = 0;
      for (let i = 0; i < mesh.maxInstanceCount && seen < mesh.instanceCount; i++) {
        let vis: boolean;
        try {
          vis = mesh.getVisibleAt(i);
        } catch {
          continue;
        }
        seen++;
        if (!vis) continue;
        mesh.getMatrixAt(i, M); // ← float32 저장까지 포함해 되읽는다
        const r = mesh.getGeometryRangeAt(mesh.getGeometryIdAt(i));
        if (!r) continue;
        // 면당 한 정점만 봐도 충분하다 (비인덱스 + 면 노멀 = 3정점이 같은 노멀)
        for (let v = r.vertexStart; v < r.vertexStart + r.vertexCount; v += 3) {
          n.set(nrm!.getX(v), nrm!.getY(v), nrm!.getZ(v));
          if (n.lengthSq() < 1e-9) continue;
          exact(M, n, a);
          batched(M, n, b);
          const deg = (Math.acos(Math.min(1, Math.max(-1, a.dot(b)))) * 180) / Math.PI;
          const dd = Math.abs(Math.max(0, a.dot(SUN)) - Math.max(0, b.dot(SUN)));
          if (deg > worst.deg) {
            worst.deg = deg;
            worst.dot = dd;
            worst.who = `${name} inst${i} f${f}`;
          }
        }
      }
    }
  }
  s3.dispose();
  return worst;
}

describe('묶기의 노멀 근사 오차', () => {
  it('전 종·전 티어·발사 전 구간에서 5° 이하다 (실측 최대 3.9°)', () => {
    const w = sweep(null);
    expect(
      w.deg,
      `최악 ${w.deg.toFixed(3)}° (${w.who}) · 태양 램버트 |Δdot| ${w.dot.toFixed(4)}`,
    ).toBeLessThanOrEqual(5);
  });

  it('램버트 항의 어긋남이 0.08 이하다 (실측 0.063)', () => {
    const w = sweep(null);
    expect(w.dot, `|Δdot| ${w.dot.toFixed(4)} (${w.who}, ${w.deg.toFixed(3)}°)`).toBeLessThanOrEqual(
      0.08,
    );
  });

  /**
   * **이 계기가 실제로 전단을 밟는가** — 안 밟으면 위 두 계약이 공허하다.
   * 투석기는 반동(루트 비등방) 중에 팔이 X축으로 돌아 전단이 확실히 생긴다.
   *
   * ⚠ 이 it 이 빨개지는 정상적인 경우가 하나 있다: 위 비등방 스케일 **셋을 전부**
   *   등방으로 바꿔 전단 자체를 지웠을 때다(하나만 지우면 나머지가 남아 계속 초록이다 —
   *   실측: 반동만 등방으로 바꾸면 피격 흔들림 + 잔여 팔 각도가 전단을 계속 만든다).
   *   그때는 위 두 계약이 지킬 것이 없어진 것이므로 이 파일을 지우면 된다 —
   *   **값을 낮춰서 통과시키지 마라.**
   *
   * 판별력 실측: `sy *= 1 - 0.05*k` 를 `1 - 0.5*k` 로 키우는 최소 패치를 넣으면
   * 위 첫 계약이 **30.071°** 로 빨개진다(문턱 5).
   */
  it('공허하지 않다 — 투석기 발사 중에는 오차가 실제로 0이 아니다', () => {
    const w = sweep('catapult');
    expect(
      w.deg,
      `투석기 최악 ${w.deg.toFixed(4)}° — 0이면 이 잣대가 전단을 안 밟은 것이다(${w.who})`,
    ).toBeGreaterThan(0.5);
  });
});
