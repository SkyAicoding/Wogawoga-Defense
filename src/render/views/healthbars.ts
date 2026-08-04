/**
 * 체력바 — InstancedMesh 쿼드 빌보드.
 * onBeforeCompile로 카메라 정렬 + 인스턴스 fill 속성 주입.
 * 배경 검정 / 체력 초록→빨강 그라디언트, full HP는 숨김, 보스는 폭 2배.
 */
import * as THREE from 'three';
import type { EnemyState } from '@/data/types';
import { lerp } from '@/core/mathx';
import { BOSS_ENEMIES } from '../meshlib/enemies';
import type { CellToWorld } from '../meshlib/terrain';

const CAPACITY = 128;
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scl = new THREE.Vector3();
const _mat = new THREE.Matrix4();

export class HealthBarView {
  private mesh: THREE.InstancedMesh;
  private fillAttr: THREE.InstancedBufferAttribute;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const fills = new Float32Array(CAPACITY);
    this.fillAttr = new THREE.InstancedBufferAttribute(fills, 1);
    this.fillAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('fill', this.fillAttr);

    const mat = new THREE.MeshBasicMaterial({ toneMapped: false });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute float fill;
varying float vFill;
varying vec2 vBarUv;`,
        )
        .replace(
          '#include <project_vertex>',
          `vFill = fill;
vBarUv = position.xy + 0.5;
// 빌보드: 인스턴스 위치 + 카메라 우/상 벡터 * 로컬 좌표 * 인스턴스 스케일
vec4 ipos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
float bsx = length(vec3(instanceMatrix[0]));
float bsy = length(vec3(instanceMatrix[1]));
vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
vec3 bbWorld = ipos.xyz + camRight * position.x * bsx + camUp * position.y * bsy;
vec4 mvPosition = viewMatrix * vec4(bbWorld, 1.0);
gl_Position = projectionMatrix * mvPosition;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying float vFill;
varying vec2 vBarUv;`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
{
  // 테두리 + 배경 + 초록→빨강 채움
  vec3 hpCol = mix(vec3(0.85, 0.16, 0.1), vec3(0.28, 0.82, 0.2), smoothstep(0.25, 0.6, vFill));
  vec3 barCol = vBarUv.x < vFill ? hpCol : vec3(0.06, 0.05, 0.05);
  float edge = step(0.06, vBarUv.y) * step(vBarUv.y, 0.94);
  diffuseColor.rgb = mix(vec3(0.04), barCol, edge);
}`,
        );
    };

    this.mesh = new THREE.InstancedMesh(geo, mat, CAPACITY);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
  }

  update(enemies: readonly EnemyState[], alpha: number, cellToWorld: CellToWorld): void {
    let n = 0;
    _quat.identity();
    for (const e of enemies) {
      if (!e.alive || e.hp >= e.maxHp || n >= CAPACITY) continue;
      const sx = lerp(e.prevX, e.x, alpha);
      const sz = lerp(e.prevZ, e.z, alpha);
      cellToWorld(sx, sz, _pos);
      const boss = BOSS_ENEMIES.has(e.defId);
      _pos.y = (e.flying ? 2.15 : 0.55) + e.radius * 1.6 + (boss ? 0.45 : 0);
      const w = (boss ? 1.3 : 0.55) * (0.8 + e.radius);
      _mat.compose(_pos, _quat, _scl.set(w, boss ? 0.17 : 0.11, 1));
      this.mesh.setMatrixAt(n, _mat);
      this.fillAttr.setX(n, Math.max(0, e.hp) / e.maxHp);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.fillAttr.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
