/**
 * 타워 렌더 뷰 — 배치 타워 개별 Mesh(main+glow) 관리.
 * 발사 반동(recoil), drum 상시 펄스, 배치 고스트 프리뷰(초록/빨강)를 처리한다.
 */
import * as THREE from 'three';
import type { TowerId } from '@/data/types';
import { easeOutCubic } from '@/core/mathx';
import { flatMat, glowMat } from '../palette';
import { buildTower } from '../meshlib/towers';
import type { CellToWorld } from '../meshlib/terrain';

interface TowerEntry {
  root: THREE.Group;
  defId: TowerId;
  tier: number;
  /** 반동 진행 (0=없음, 1→0 감쇠) */
  recoilT: number;
  /** 업그레이드 팝 진행 */
  popT: number;
}

const RECOIL_TIME = 0.22;
const POP_TIME = 0.3;

export class TowerView {
  private group = new THREE.Group();
  private towers = new Map<number, TowerEntry>();
  private ghost: THREE.Group | null = null;
  private ghostMatValid: THREE.MeshBasicMaterial;
  private ghostMatInvalid: THREE.MeshBasicMaterial;
  private time = 0;

  constructor(
    scene: THREE.Scene,
    private cellToWorld: CellToWorld,
  ) {
    this.group.name = 'towers';
    scene.add(this.group);
    this.ghostMatValid = new THREE.MeshBasicMaterial({
      color: 0x4ade64,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    this.ghostMatInvalid = new THREE.MeshBasicMaterial({
      color: 0xe84a3a,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
  }

  private makeMeshes(defId: TowerId, tier: number): THREE.Group {
    const model = buildTower(defId, tier);
    const root = new THREE.Group();
    const main = new THREE.Mesh(model.main, flatMat());
    main.castShadow = true;
    main.receiveShadow = true;
    root.add(main);
    if (model.glow) root.add(new THREE.Mesh(model.glow, glowMat()));
    return root;
  }

  add(id: number, defId: TowerId, tier: number, cellX: number, cellZ: number): void {
    this.remove(id);
    const root = this.makeMeshes(defId, tier);
    const v = this.cellToWorld(cellX, cellZ);
    root.position.set(v.x, 0.1, v.z); // 슬롯 패드 위
    this.group.add(root);
    this.towers.set(id, { root, defId, tier, recoilT: 0, popT: 1 });
  }

  upgrade(id: number, tier: number): void {
    const entry = this.towers.get(id);
    if (!entry || entry.tier === tier) return;
    const pos = entry.root.position.clone();
    this.group.remove(entry.root);
    const root = this.makeMeshes(entry.defId, tier);
    root.position.copy(pos);
    this.group.add(root);
    entry.root = root;
    entry.tier = tier;
    entry.popT = 1; // 팝 애니 재생
  }

  remove(id: number): void {
    const entry = this.towers.get(id);
    if (!entry) return;
    this.group.remove(entry.root);
    this.towers.delete(id);
  }

  /** 발사 반동 재생 */
  recoil(id: number): void {
    const entry = this.towers.get(id);
    if (entry) entry.recoilT = 1;
  }

  /** 타워 월드 위치 (파티클/이펙트 스폰용) */
  positionOf(id: number, out: THREE.Vector3): boolean {
    const entry = this.towers.get(id);
    if (!entry) return false;
    out.copy(entry.root.position);
    return true;
  }

  /** 배치 프리뷰 고스트 — 반투명 초록(가능)/빨강(불가) */
  setGhost(defId: TowerId, cellX: number, cellZ: number, valid: boolean): void {
    this.clearGhost();
    const model = buildTower(defId, 0);
    const ghost = new THREE.Group();
    const mat = valid ? this.ghostMatValid : this.ghostMatInvalid;
    const main = new THREE.Mesh(model.main, mat);
    ghost.add(main);
    if (model.glow) ghost.add(new THREE.Mesh(model.glow, mat));
    const v = this.cellToWorld(cellX, cellZ);
    ghost.position.set(v.x, 0.1, v.z);
    this.group.add(ghost);
    this.ghost = ghost;
  }

  clearGhost(): void {
    if (this.ghost) {
      this.group.remove(this.ghost);
      this.ghost = null;
    }
  }

  update(dt: number): void {
    this.time += dt;
    for (const entry of this.towers.values()) {
      let sx = 1;
      let sy = 1;
      // 반동: 세로 스쿼시 + 살짝 뒤로 튐
      if (entry.recoilT > 0) {
        entry.recoilT = Math.max(0, entry.recoilT - dt / RECOIL_TIME);
        const k = entry.recoilT * entry.recoilT;
        sy *= 1 - 0.14 * k;
        sx *= 1 + 0.1 * k;
      }
      // 업그레이드/배치 팝
      if (entry.popT > 0) {
        entry.popT = Math.max(0, entry.popT - dt / POP_TIME);
        const t = 1 - entry.popT;
        const pop = 0.6 + 0.4 * easeOutCubic(t);
        const over = 1 + Math.sin(t * Math.PI) * 0.12;
        sx *= pop * over;
        sy *= pop * over;
      }
      // drum 상시 펄스 (버프 오라 시각화)
      if (entry.defId === 'drum') {
        const pulse = 1 + Math.sin(this.time * 3.4) * 0.035;
        sx *= pulse;
        sy *= 2 - pulse;
      }
      entry.root.scale.set(sx, sy, sx);
    }
    if (this.ghost) {
      // 고스트 호흡 애니
      const b = 1 + Math.sin(this.time * 6) * 0.03;
      this.ghost.scale.setScalar(b);
    }
  }

  dispose(): void {
    this.group.parent?.remove(this.group);
    this.towers.clear();
    this.ghost = null;
    this.ghostMatValid.dispose();
    this.ghostMatInvalid.dispose();
  }
}
