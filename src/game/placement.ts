/**
 * 배치/선택 입력 — 탭·호버를 셀 좌표로 변환해 시뮬레이션 커맨드로.
 * 카드 선택 → 슬롯 발광 + 고스트 프리뷰 → 탭 배치.
 * 타워 탭 → 선택 + 사거리 링. 빈 곳 탭 → 해제.
 */
import * as THREE from 'three';
import type { BattleSim, StageDef, TowerId } from '@/data/types';
import { TOWER_DEFS } from '@/data';
import { InputManager } from '@/core/input';
import { audio } from '@/audio';
import type { Stage3D } from '@/render/stage3d';
import type { DioramaCamera } from '@/render/camera';

const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

export class PlacementController {
  /** 전투 컨트롤러가 카메라 제스처(핀치/휠/드래그 팬)를 함께 구독한다 */
  readonly input: InputManager;
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private hit = new THREE.Vector3();
  private selectedCardIndex: number | null = null;
  private selectedTowerId: number | null = null;
  private ghostCell: { x: number; z: number } | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: DioramaCamera,
    private sim: BattleSim,
    private stage: StageDef,
    private stage3d: Stage3D,
    private stars: Partial<Record<TowerId, number>>,
  ) {
    this.input = new InputManager(canvas);
    this.input.events.on('tap', (p) => this.onTap(p.x, p.y));
    this.input.events.on('move', (p) => this.onMove(p.x, p.y));
  }

  /** 화면 좌표 → 그리드 셀 (지면 밖이면 null) */
  private cellAt(px: number, py: number): { x: number; z: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set((px / rect.width) * 2 - 1, -(py / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera.camera);
    if (!this.raycaster.ray.intersectPlane(GROUND, this.hit)) return null;
    const x = Math.round(this.hit.x + (this.stage.gridW - 1) / 2);
    const z = Math.round(this.hit.z + (this.stage.gridH - 1) / 2);
    if (x < 0 || z < 0 || x >= this.stage.gridW || z >= this.stage.gridH) return null;
    return { x, z };
  }

  private onMove(px: number, py: number): void {
    if (this.selectedCardIndex === null) return;
    const card = this.sim.state.hand[this.selectedCardIndex];
    if (!card) return;
    const cell = this.cellAt(px, py);
    if (!cell) {
      this.stage3d.towers.clearGhost();
      this.ghostCell = null;
      return;
    }
    if (this.ghostCell && this.ghostCell.x === cell.x && this.ghostCell.z === cell.z) return;
    this.ghostCell = cell;
    const ok = this.sim.canPlaceAt(cell.x, cell.z) && this.sim.state.gold >= card.cost;
    this.stage3d.towers.setGhost(card.towerId, cell.x, cell.z, ok);
  }

  private onTap(px: number, py: number): void {
    const cell = this.cellAt(px, py);
    // 카드 배치 모드
    if (this.selectedCardIndex !== null) {
      const idx = this.selectedCardIndex;
      if (cell && this.sim.applyCommand({ type: 'placeTower', handIndex: idx, cellX: cell.x, cellZ: cell.z })) {
        this.selectCard(null);
        return;
      }
      // 슬롯 밖 탭 → 배치 모드 해제
      if (!cell || !this.sim.canPlaceAt(cell.x, cell.z)) this.selectCard(null);
      return;
    }
    // 타워 선택/해제
    const tower = cell ? this.sim.towerAt(cell.x, cell.z) : null;
    if (tower) {
      this.selectedTowerId = tower.id;
      this.showRangeFor(tower.id);
      audio.play('uiTap');
    } else if (this.selectedTowerId !== null) {
      this.clearTowerSelection();
    }
  }

  private showRangeFor(towerId: number): void {
    const t = this.sim.state.towers.find((tw) => tw.id === towerId);
    if (!t) return;
    const def = TOWER_DEFS[t.defId];
    const tier = def.tiers[t.tier];
    if (!tier) return;
    const stars = this.stars[t.defId] ?? 0;
    const range = tier.range * (1 + stars * (def.starBonus.rangePct ?? 0));
    this.stage3d.decals.showRange(t.cellX, t.cellZ, range);
  }

  /** HUD 카드 탭 → 배치 모드 진입/해제 */
  selectCard(index: number | null): void {
    this.selectedCardIndex = index;
    this.ghostCell = null;
    this.stage3d.towers.clearGhost();
    this.stage3d.decals.setSlotsVisible(index !== null);
    if (index !== null) this.clearTowerSelection();
  }

  selectedCard(): number | null {
    return this.selectedCardIndex;
  }

  selectedTower(): number | null {
    return this.selectedTowerId;
  }

  /** 업그레이드/판매/틱 후 선택 상태 정합성 유지 */
  refreshSelection(): void {
    if (this.selectedTowerId === null) return;
    const t = this.sim.state.towers.find((tw) => tw.id === this.selectedTowerId);
    if (!t) this.clearTowerSelection();
    else this.showRangeFor(t.id);
  }

  clearTowerSelection(): void {
    this.selectedTowerId = null;
    this.stage3d.decals.hideRange();
  }

  dispose(): void {
    this.input.dispose();
  }
}
