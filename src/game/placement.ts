/**
 * 배치/선택 입력 — 탭·호버를 셀 좌표로 변환해 시뮬레이션 커맨드로.
 * 카드 선택 → 슬롯 발광 + 고스트 프리뷰 → 탭 배치.
 * 부족원 탭 → 그 **종족 전체** 선택 + 각자의 공격 사거리 바운더리 → 셀 탭 → 이동 명령.
 * 타워 탭 → 선택 + 사거리 링.
 * 홈타운(기지 셀) 탭 → 선택 + 사거리 링 + 아군 출격 한계선 봉수대 (마을 패널: 레벨업 + 출동).
 * 소품(나무·바위) 탭 → 선택 + 링(제거 패널).
 * 빈 곳 탭 / 같은 대상 재탭 → 해제. 카드 선택 중에는 배치 흐름이 우선이다.
 *
 * 셋(타워·홈타운·소품)은 상호배타다. 기지 셀은 경로 셀이라 타워가 설 수 없으므로
 * 타워와 겹칠 일이 없고, 소품도 건설 가능 셀에만 놓이므로 겹치지 않는다.
 */
import * as THREE from 'three';
import type { AllyId, AllyState, BattleSim, StageDef, TowerId, Vec2 } from '@/data/types';
import { ALLY_DEFS, TOWER_DEFS } from '@/data';

/**
 * 부족원을 집는 반경 (타일). 유닛 반경이 0.26뿐이라 그것만 보면 손가락이 거의 못 맞힌다.
 * 0.7이면 한 칸의 절반보다 조금 넓어 겨냥한 사람은 잡히고 옆 칸 사람은 안 잡힌다.
 * 집결 대열 간격이 0.6이라 이 값이 그보다 크면 대열 안에서 **누구를 잡아도 같은 종족**이
 * 선택되는데, 선택 단위가 어차피 종족이라(사용자 지시) 그건 문제가 되지 않는다.
 */
const ALLY_PICK_RADIUS = 0.7;
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
  /**
   * 규칙 2) **선택된 부족 종족** (null = 아무도 안 골랐다).
   *
   * 사용자 지시: "생산한 다음 마을 부족을 아무나 선택하면 같은 종류는 모두 선택되게 해서
   * 원하는 블록을 찍으면 그곳으로 이동". 곧 선택 단위는 **한 명이 아니라 종족**이다.
   * 판 위의 부족원을 탭하면 그 종이 통째로 선택되고, 다음 셀 탭이 이동 명령이 된다.
   *
   * 카드 선택(selectedCardIndex)과 **상호 배타**다: 둘 다 "다음 탭이 무엇을 뜻하는가"를
   * 바꾸는 상태라, 동시에 켜지면 탭 하나가 두 가지를 뜻하게 된다.
   */
  private selectedAllyDef: AllyId | null = null;
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
  /**
   * 화면 좌표 → **연속** 셀 좌표 (반올림 전). 격자 밖이어도 그대로 돌려준다.
   * 부족원 집기(pickAllyAt)는 반올림하면 안 된다 — 유닛은 셀 중심이 아니라
   * 아무 소수 좌표에나 서 있고(집결 대열 간격이 0.6타일), 반올림하면 한 칸 안의
   * 서로 다른 두 명이 같은 점으로 뭉개져 "가장 가까운 사람"을 고를 수 없다.
   */
  private pointAt(px: number, py: number): { x: number; z: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set((px / rect.width) * 2 - 1, -(py / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera.camera);
    if (!this.raycaster.ray.intersectPlane(GROUND, this.hit)) return null;
    return {
      x: this.hit.x + (this.stage.gridW - 1) / 2,
      z: this.hit.z + (this.stage.gridH - 1) / 2,
    };
  }

  private cellAt(px: number, py: number): { x: number; z: number } | null {
    const p = this.pointAt(px, py);
    if (!p) return null;
    const x = Math.round(p.x);
    const z = Math.round(p.z);
    if (x < 0 || z < 0 || x >= this.stage.gridW || z >= this.stage.gridH) return null;
    return { x, z };
  }

  /**
   * 탭 지점에서 가장 가까운 **살아 있는 부족원** (ALLY_PICK_RADIUS 안, 없으면 null).
   *
   * 왜 셀이 아니라 반경인가: 부족원은 셀에 붙어 있지 않다. 그리고 손가락은 정확하지 않다 —
   * 유닛 반경이 0.26타일뿐이라 "그 셀"만 보면 대부분의 탭이 빗나간다.
   * 0.7타일이면 한 칸의 절반보다 조금 넓어, 옆 칸의 유닛을 훔쳐 오지 않으면서
   * 겨냥한 사람은 잡힌다. 동점은 낮은 id — 결정론이 아니라 **일관성**을 위해서다
   * (같은 자리를 두 번 탭하면 같은 사람이 잡혀야 한다).
   */
  private pickAllyAt(px: number, py: number): AllyState | null {
    const p = this.pointAt(px, py);
    if (!p) return null;
    let best: AllyState | null = null;
    let bestD2 = ALLY_PICK_RADIUS * ALLY_PICK_RADIUS;
    for (const a of this.sim.state.allies) {
      const dx = a.x - p.x;
      const dz = a.z - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > bestD2) continue;
      if (best === null || d2 < bestD2 || a.id < best.id) {
        best = a;
        bestD2 = d2;
      }
    }
    return best;
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
    /*
     * 규칙 2) 부족 선택/이동 — 카드 배치 **다음**, 나머지 선택보다 **먼저**.
     *
     * 순서가 이런 이유: 카드를 든 채로는 짓는 것이 먼저다(손에 카드가 있으면 그게
     * 지금 하려는 일이다). 카드가 없으면 판 위의 사람이 타워·소품·기지보다 앞선다 —
     * 부족원은 움직이는 물건이라 "지금 저기 있는 저 사람"을 겨냥한 탭일 가능성이 높고,
     * 잘못 집어도 되돌리는 값이 0이다(선택만 바뀐다).
     *
     * 두 갈래:
     *  (a) 부족원을 탭했다 → **그 종족 전체**를 고른다 (다른 종을 고르고 있었어도 갈아탄다)
     *  (b) 이미 고른 종족이 있고 판의 다른 곳을 탭했다 → 그 칸으로 **이동 명령**
     */
    if (this.selectedCardIndex === null) {
      const picked = this.pickAllyAt(px, py);
      if (picked) {
        this.selectAllyDef(picked.defId);
        return;
      }
      if (this.selectedAllyDef !== null) {
        const defId = this.selectedAllyDef;
        if (cell && this.sim.applyCommand({ type: 'moveAlly', allyId: -1, cellX: cell.x, cellZ: cell.z, defId })) {
          // 순서가 중요하다: **먼저** 선택을 풀어 사거리 바운더리를 내리고, 그 자리에
          // 목표 표식을 세운다. 예전에는 둘이 같은 메시라 showAllyOrder가 덮어썼지만
          // 이제는 서로 다른 메시다 — 안 내리면 명령을 내린 뒤에도 원이 그 자리에
          // 얼어붙은 채 남고(유닛은 떠난다) 드로우콜도 하나 더 먹는다.
          this.clearAllySelection();
          this.showAllyOrder(cell.x, cell.z);
          return;
        }
        // 판 밖 탭 → 선택만 푼다 (카드 모드가 슬롯 밖 탭을 다루는 것과 같은 규약)
        this.clearAllySelection();
        return;
      }
    }
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
      this.selectBase();
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

  /**
   * 홈타운 표시 — 사거리 링.
   * 9단계에 **출격 한계선 봉수대가 빠졌다**: 한계선이 없어져 그릴 지점이 없다.
   * 같은 메시(decals.showSortieMarker)는 버리지 않고 **이동 명령 목표 표식**으로
   * 재사용한다(showAllyOrder) — 드로우콜이 늘지 않는 이유도 그대로다.
   */
  private showBaseRange(): void {
    const bc = this.stage.baseCell;
    this.stage3d.decals.showRange(bc.x, bc.z, this.sim.baseRange());
  }

  /**
   * 규칙 2) 이동 명령 목표 표식 — 마지막으로 찍은 자리에 원을 남긴다.
   * 아군이 자유 이동이라 **어디로 가는 중인지가 화면 어디에도 없다**. 표식이 없으면
   * 명령이 먹혔는지조차 알 수 없다(6명이 동시에 출발하면 더 그렇다).
   */
  private showAllyOrder(cellX: number, cellZ: number): void {
    this.stage3d.decals.showSortieMarker([{ x: cellX, z: cellZ }]);
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
    // 사거리 링과 별개로 발밑 링 — 타워가 붙어 있으면 사거리 원 하나가 여러 기를
    // 함께 감싸 "어느 걸 골랐는지"가 안 읽힌다
    this.stage3d.decals.showTowerMarker(t.cellX, t.cellZ);
  }

  /** 지금 고른 부족 종족 (없으면 null) — HUD가 '누구를 고르고 있는지' 표시에 쓴다 */
  selectedAlly(): AllyId | null {
    return this.selectedAllyDef;
  }

  /**
   * 종족 선택 — 살아 있는 같은 종 **전원**의 발밑에 자기 공격 사거리 바운더리를 그린다.
   *
   * 사용자 지시: "우리 부족을 선택하면 공격 가능한 바운더리를 표시해 주고, 선택했을 때
   * 역시 하늘로 올라가는 선은 없애줘". 그 '하늘로 올라가는 선'이 여기서 쓰던
   * 봉수대(decals.showSortieMarker)의 기둥이다. 봉수대 자체는 **이동 목표 표식**으로
   * 남는다 — 거기서는 기둥이 값을 한다(빈 길 위의 한 점이라 링만으로는 안 보인다).
   * 갈아 끼운 것은 **선택 경로뿐**이고, 그 자리에 지면 파선 원(showAllyRanges)이 들어왔다.
   *
   * 드로우콜은 늘지 않는다: 선택 중에는 봉수대 메시가 내려가 있고(바로 아래), 원이
   * 몇 개든 하나로 병합해 굽는다.
   */
  private selectAllyDef(defId: AllyId): void {
    this.selectCard(null);
    this.clearTowerSelection();
    this.clearScenerySelection();
    this.clearBaseSelection();
    // 직전 이동 명령의 목표 표식은 내린다. 새로 고르는 순간 그건 **지난 명령**이고,
    // 무엇보다 켠 채로 두면 메시가 하나 더 살아 그만큼 드로우콜이 는다.
    this.stage3d.decals.hideSortieMarker();
    this.selectedAllyDef = defId;
    this.refreshAllySelection();
    audio.play('uiTap');
  }

  /** 선택된 종족의 지금 위치로 바운더리를 다시 굽는다 — 유닛이 걸어가면 따라가야 한다 */
  refreshAllySelection(): void {
    if (this.selectedAllyDef === null) return;
    const pts = this.sim.state.allies
      .filter((a) => a.defId === this.selectedAllyDef)
      .map((a) => ({ x: a.x, z: a.z }));
    if (pts.length === 0) {
      this.clearAllySelection();
      return;
    }
    // 반경은 종족 사거리 그대로다 — 타일 단위이고 판의 한 칸이 곧 월드 1이라 배율이 없다
    // (terrain.cellToWorld는 중심 이동만 한다). 곧 화면의 원이 실제 사정거리다.
    this.stage3d.decals.showAllyRanges(pts, ALLY_DEFS[this.selectedAllyDef].range);
  }

  clearAllySelection(): void {
    if (this.selectedAllyDef === null) return;
    this.selectedAllyDef = null;
    this.stage3d.decals.hideAllyRanges();
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

  /**
   * 마을을 고른다 — 판 위의 움막 탭과 **완전히 같은 경로**(HUD의 부족 칩도 이걸 부른다).
   * 8단계에서 공개한 이유: 마을 패널이 아군 기능의 유일한 입구인데, 판 위의 움막
   * 한 칸에는 배지도 글로우도 없어 "여기를 눌러라"가 화면 어디에도 없었다.
   */
  selectBase(): void {
    if (this.baseSelected) return;
    this.clearTowerSelection();
    this.clearScenerySelection();
    this.baseSelected = true;
    this.showBaseRange();
    audio.play('uiTap');
  }

  clearBaseSelection(): void {
    if (!this.baseSelected) return;
    this.baseSelected = false;
    this.stage3d.decals.hideRange();
    // 출격선 봉수대는 소품 마커와 같은 메시를 쓴다 — 마을 선택이 풀리면 같이 내린다
    this.stage3d.decals.hideCellMarker();
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
    if (this.selectedTowerId !== null) this.stage3d.decals.hideCellMarker();
    this.selectedTowerId = null;
    this.stage3d.decals.hideRange();
  }

  dispose(): void {
    this.input.dispose();
  }
}
