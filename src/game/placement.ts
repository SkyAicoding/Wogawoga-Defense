/**
 * 배치/선택 입력 — 탭·호버를 셀 좌표로 변환해 시뮬레이션 커맨드로.
 * 카드 선택 → 슬롯 발광 + 고스트 프리뷰 → 탭 배치.
 * 타워 탭 → 선택 + 사거리 링. 홈타운(기지 셀) 탭 → 선택 + 사거리 링(레벨업 패널).
 * 소품(나무·바위) 탭 → 선택 + 링(제거 패널).
 * 빈 곳 탭 / 같은 대상 재탭 → 해제. 카드 선택 중에는 배치 흐름이 우선이다.
 *
 * 셋(타워·홈타운·소품)은 상호배타다. 기지 셀은 경로 셀이라 타워가 설 수 없으므로
 * 타워와 겹칠 일이 없고, 소품도 건설 가능 셀에만 놓이므로 겹치지 않는다.
 */
import * as THREE from 'three';
import type { BattleSim, StageDef, TowerId, Vec2 } from '@/data/types';
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
  /** 탭해서 고른 소품 셀 (제거 패널 대상) */
  private selectedSceneryCell: Vec2 | null = null;
  /** 홈타운(기지 셀)이 선택되어 있는가 — 레벨업 패널 대상 */
  private baseSelected = false;
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
    // 모바일 드래그 배치: 카드 선택 중 드래그는 조준(고스트는 move로 갱신),
    // 릴리즈 지점에 배치. battlecontroller는 카드 선택 중 카메라 팬을 스킵한다.
    // 우드래그/Shift+드래그는 카메라 궤도 회전 — 배치로 소비하면 안 된다
    this.input.events.on('dragEnd', (p) => {
      if (p.button !== 0 || p.shiftKey) return;
      this.onDragEnd(p.x, p.y);
    });
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

  /** 카드 선택 상태에서 드래그 릴리즈 → 마지막 고스트 셀에 배치 시도 */
  private onDragEnd(px: number, py: number): void {
    if (this.selectedCardIndex === null) return;
    const idx = this.selectedCardIndex;
    const cell = this.cellAt(px, py) ?? this.ghostCell;
    if (
      cell &&
      this.sim.applyCommand({ type: 'placeTower', handIndex: idx, cellX: cell.x, cellZ: cell.z })
    ) {
      this.selectCard(null);
    }
    // 불가 셀이면 배치 모드 유지 — 다시 조준할 수 있게 취소하지 않는다
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
      // 슬롯 밖 탭 → 배치 모드 해제.
      // 그 자리가 타워/소품이면 같은 탭으로 바로 그 대상을 고른다 — 배치 자리를
      // 찾다가 "여긴 나무네" 하고 누르는 동선에서 탭 하나를 버리지 않게 한다.
      if (!cell || !this.sim.canPlaceAt(cell.x, cell.z)) {
        this.selectCard(null);
        if (cell) this.selectAt(cell);
      }
      return;
    }
    this.selectAt(cell);
  }

  /** 셀 하나에 대한 선택 규칙 — 타워 > 홈타운 > 소품 > 해제 (셋은 상호배타) */
  private selectAt(cell: { x: number; z: number } | null): void {
    // 타워 선택/해제
    const tower = cell ? this.sim.towerAt(cell.x, cell.z) : null;
    if (tower) {
      this.clearScenerySelection();
      this.clearBaseSelection();
      this.selectedTowerId = tower.id;
      this.showRangeFor(tower.id);
      audio.play('uiTap');
      return;
    }
    // 홈타운(기지 셀) 선택/해제 — 같은 셀을 다시 탭하면 닫힌다
    const bc = this.stage.baseCell;
    if (cell && cell.x === bc.x && cell.z === bc.z) {
      if (this.baseSelected) {
        this.clearBaseSelection();
        return;
      }
      this.clearTowerSelection();
      this.clearScenerySelection();
      this.baseSelected = true;
      this.showBaseRange();
      audio.play('uiTap');
      return;
    }
    // 소품(나무·바위) 선택/해제 — 같은 셀을 다시 탭하면 닫힌다
    if (cell && this.sim.hasScenery(cell.x, cell.z)) {
      const cur = this.selectedSceneryCell;
      if (cur && cur.x === cell.x && cur.z === cell.z) {
        this.clearScenerySelection();
        return;
      }
      this.clearTowerSelection();
      this.clearBaseSelection();
      this.selectedSceneryCell = { x: cell.x, z: cell.z };
      // 소품은 셀 중심에서 흩어져 있다 — 링을 실제 밑동에 맞춘다
      const off = this.stage3d.sceneryOffset(cell.x, cell.z);
      this.stage3d.decals.showCellMarker(cell.x, cell.z, off?.dx ?? 0, off?.dz ?? 0);
      audio.play('uiTap');
      return;
    }
    // 빈 곳 탭 → 전부 해제
    if (this.selectedTowerId !== null) this.clearTowerSelection();
    if (this.selectedSceneryCell !== null) this.clearScenerySelection();
    if (this.baseSelected) this.clearBaseSelection();
  }

  /** 홈타운 사거리 링 — 레벨업으로 사거리가 늘면 그 자리에서 넓어지는 게 보인다 */
  private showBaseRange(): void {
    const bc = this.stage.baseCell;
    this.stage3d.decals.showRange(bc.x, bc.z, this.sim.baseRange());
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
    if (index !== null) {
      this.clearTowerSelection();
      this.clearScenerySelection();
      this.clearBaseSelection();
    }
  }

  selectedCard(): number | null {
    return this.selectedCardIndex;
  }

  selectedTower(): number | null {
    return this.selectedTowerId;
  }

  selectedScenery(): Vec2 | null {
    return this.selectedSceneryCell;
  }

  selectedBase(): boolean {
    return this.baseSelected;
  }

  clearBaseSelection(): void {
    if (!this.baseSelected) return;
    this.baseSelected = false;
    this.stage3d.decals.hideRange();
  }

  /** 레벨업 후 사거리 링 갱신 — 선택 중이 아니면 아무 일도 하지 않는다 */
  refreshBaseSelection(): void {
    if (this.baseSelected) this.showBaseRange();
  }

  clearScenerySelection(): void {
    if (this.selectedSceneryCell === null) return;
    this.selectedSceneryCell = null;
    this.stage3d.decals.hideCellMarker();
  }

  /** 제거 성공/셀 상태 변화 후 정합성 유지 — 더 이상 소품이 아니면 선택 해제 */
  refreshScenerySelection(): void {
    const c = this.selectedSceneryCell;
    if (c && !this.sim.hasScenery(c.x, c.z)) this.clearScenerySelection();
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
