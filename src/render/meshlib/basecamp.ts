/**
 * 기지(베이스캠프) — 큰 모닥불 + 원시 움막 2채 + 목책 반원 + 토템.
 * 피해 단계(0=100%/1=60%/2=30%)별 외형 배리에이션을 미리 만들어 visible 토글.
 * 연기 강도 등 동적 연출은 파티클 훅(smokeLevel)으로 상위에서 처리.
 */
import * as THREE from 'three';
import { C, flatMat, glowMat } from '../palette';
import { buildParts, type PartSpec } from './factory';

export interface Basecamp {
  group: THREE.Group;
  /** 0=온전 / 1=파손 / 2=반파 */
  setDamageLevel(level: 0 | 1 | 2): void;
  /** 파티클 훅용: 현재 연기 강도 0~2 */
  readonly smokeLevel: () => number;
  /** 모닥불 월드 오프셋 (파티클 스폰 위치) */
  fireOffset: THREE.Vector3;
  dispose(): void;
}

function hut(x: number, z: number, yaw: number, ruined: boolean): PartSpec[] {
  if (ruined) {
    // 무너진 움막: 기둥 몇 개 + 잔해
    return [
      { kind: 'cyl', pos: [x - 0.15, 0.18, z], rot: [0, yaw, 0.5], scale: [0.07, 0.4, 0.07], color: C.woodDark, seg: 5 },
      { kind: 'cyl', pos: [x + 0.12, 0.12, z + 0.1], rot: [0.9, yaw, 0], scale: [0.07, 0.36, 0.07], color: C.woodDark, seg: 5 },
      { kind: 'ico', pos: [x, 0.08, z], scale: [0.5, 0.18, 0.5], color: 0x6a5236, hueJitter: 0.02 },
      { kind: 'cone', pos: [x + 0.08, 0.16, z - 0.08], rot: [0.6, 0, 0.3], scale: [0.34, 0.2, 0.34], color: 0xa8863e, seg: 6 },
    ];
  }
  return [
    { kind: 'cyl', pos: [x, 0.2, z], scale: [0.52, 0.4, 0.52], color: C.hideDark, seg: 7, hueJitter: 0.015 },
    { kind: 'cone', pos: [x, 0.56, z], rot: [0, yaw, 0], scale: [0.72, 0.42, 0.72], color: C.straw, seg: 7, hueJitter: 0.02 },
    { kind: 'box', pos: [x + Math.cos(yaw) * 0.26, 0.14, z + Math.sin(yaw) * 0.26], rot: [0, -yaw, 0], scale: [0.06, 0.28, 0.24], color: 0x3a2c1c },
  ];
}

function fence(levels: number): PartSpec[] {
  // 목책 반원 (기지 후방 보호) — levels: 남은 말뚝 비율 결정
  const parts: PartSpec[] = [];
  const n = 9;
  for (let i = 0; i < n; i++) {
    if (levels === 1 && i % 3 === 1) continue;
    if (levels === 2 && i % 2 === 0) continue;
    const a = Math.PI * 0.15 + (i / (n - 1)) * Math.PI * 0.7;
    const r = 1.15;
    const h = 0.44 + ((i * 7) % 3) * 0.05;
    parts.push({
      kind: 'cyl',
      pos: [Math.cos(a) * r, h / 2, -Math.sin(a) * r],
      rot: [((i * 13) % 5) * 0.02 - 0.05, 0, ((i * 11) % 5) * 0.02 - 0.05],
      scale: [0.09, h, 0.09],
      color: i % 2 === 0 ? C.wood : C.woodDark,
      seg: 5,
    });
  }
  return parts;
}

function totem(broken: boolean): PartSpec[] {
  const parts: PartSpec[] = [
    { kind: 'cyl', pos: [0.85, 0.2, 0.65], scale: [0.24, 0.4, 0.24], color: C.wood, seg: 6 },
    { kind: 'cyl', pos: [0.85, 0.52, 0.65], scale: [0.28, 0.26, 0.28], color: 0xc9702e, seg: 6 },
  ];
  if (!broken) {
    parts.push(
      { kind: 'cyl', pos: [0.85, 0.78, 0.65], scale: [0.24, 0.26, 0.24], color: 0x3f8a4a, seg: 6 },
      { kind: 'box', pos: [0.85, 0.94, 0.65], scale: [0.4, 0.08, 0.12], color: C.bone },
    );
  }
  return parts;
}

function campfire(level: number): PartSpec[] {
  // 돌 링 + 장작 — 불꽃은 별도 글로우 지오메트리
  const parts: PartSpec[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    parts.push({
      kind: 'ico',
      pos: [Math.cos(a) * 0.42, 0.08, Math.sin(a) * 0.42],
      rot: [i, i * 2, 0],
      scale: 0.18,
      color: level === 2 ? 0x5a5450 : C.stone,
      hueJitter: 0.01,
    });
  }
  parts.push(
    { kind: 'cyl', pos: [0, 0.1, 0], rot: [0, 0.5, 1.35], scale: [0.09, 0.5, 0.09], color: C.woodDark, seg: 5 },
    { kind: 'cyl', pos: [0, 0.12, 0], rot: [1.35, 0.9, 0], scale: [0.09, 0.5, 0.09], color: 0x4a3018, seg: 5 },
  );
  return parts;
}

function flame(level: number): PartSpec[] {
  // 피해 클수록 불꽃 작아짐
  const s = level === 0 ? 1 : level === 1 ? 0.75 : 0.5;
  return [
    { kind: 'cone', pos: [0, 0.3 * s + 0.1, 0], scale: [0.4 * s, 0.6 * s, 0.4 * s], color: C.fire, seg: 6 },
    { kind: 'cone', pos: [0.04, 0.24 * s + 0.1, 0.03], scale: [0.24 * s, 0.42 * s, 0.24 * s], color: 0xffd24a, seg: 5 },
  ];
}

export function createBasecamp(): Basecamp {
  const group = new THREE.Group();
  group.name = 'basecamp';
  const variants: THREE.Group[] = [];
  const geos: THREE.BufferGeometry[] = [];

  for (let level = 0 as 0 | 1 | 2; level <= 2; level++) {
    const parts: PartSpec[] = [
      ...campfire(level),
      ...hut(-0.95, -0.55, 0.6, level >= 1),
      ...hut(0.1, -1.0, -0.4, level >= 2),
      ...fence(level),
      ...totem(level >= 2),
    ];
    const g = new THREE.Group();
    const mainGeo = buildParts(parts, { seed: 42 + level, ao: 0.16 });
    const main = new THREE.Mesh(mainGeo, flatMat());
    main.castShadow = true;
    main.receiveShadow = true;
    const flameGeo = buildParts(flame(level), { seed: 5, ao: 0 });
    const flameMesh = new THREE.Mesh(flameGeo, glowMat());
    g.add(main, flameMesh);
    g.visible = level === 0;
    geos.push(mainGeo, flameGeo);
    variants.push(g);
    group.add(g);
  }

  let current = 0;
  return {
    group,
    setDamageLevel(level) {
      current = level;
      variants.forEach((v, i) => (v.visible = i === level));
    },
    smokeLevel: () => current,
    fireOffset: new THREE.Vector3(0, 0.5, 0),
    dispose: () => geos.forEach((g) => g.dispose()),
  };
}
