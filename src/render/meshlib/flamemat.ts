/**
 * **불꽃 재질** — 정점을 흔들어 불이 살아 움직이게 한다. 드로우콜 증가 0.
 *
 * ── 왜 만들었나 (사용자 지적) ────────────────────────────────────────────────
 *   > "거의 마지막 단계 불타는 모습이 좀 어색해, 이부분 좀더 잘 만들어봐"
 *
 * 옛 판본은 마을 불 전체를 담은 메시 하나를 `flameMesh.scale` 로 **통째로** 늘였다 줄였다
 * 했다. 그러면 마을의 모든 불이 **한 몸처럼 같은 박자로 부풀었다 꺼진다** — 풍선이지 불이
 * 아니다. 불이 불로 읽히려면 **혀마다 따로** 흔들려야 한다.
 *
 * ── 어떻게 ───────────────────────────────────────────────────────────────────
 * 위상을 **새 어트리뷰트 없이 정점 위치에서 뽑는다**: 불꽃 혀는 저마다 다른 XZ 에 서 있으므로
 * `x·a + z·b` 가 곧 혀마다 다른 값이다. 어트리뷰트를 더하면 `buildParts` 의 병합 경로와
 * 캐시 키까지 따라 바뀌는데, 여기서 필요한 것은 그저 "서로 다른 수"라 그 값이면 족하다.
 *
 * 흔들림의 크기는 **밑동에서 멀수록** 커진다(`y − BASE_Y`). 밑동이 붙박이라야 불이 장작에서
 * 피어오르는 것으로 읽히고, 안 그러면 통째로 미끄러진다.
 *
 * ⚠ three 는 `onBeforeCompile` 로 바뀐 소스를 **프로그램 캐시 키에 안 넣는다.** 같은 파라미터의
 *   다른 MeshBasicMaterial 과 프로그램을 공유해 버리므로 `customProgramCacheKey` 를 준다
 *   (gait.ts 가 같은 함정에 걸려 남긴 교훈 — 거기 `CACHE_KEY_COLOR` 주석과 같은 사정이다).
 */
import * as THREE from 'three';

/** 이 높이 아래는 안 흔들린다 — 불이 장작에 붙어 있어야 한다 (월드 타일) */
const BASE_Y = 0.06;

const PARS = /* glsl */ `
uniform float wgdFlameTime;
`;

/*
 * 세 축의 뜻이 다르다:
 *  · x·z — 옆으로 눕는 바람. 두 축의 주파수를 어긋내 회전처럼 보이게 한다.
 *  · y   — 혀가 늘었다 줄었다. 옆흔들림보다 **빠르고 작게** 줘야 "타닥거림"이 되고,
 *          크게 주면 불이 통째로 오르내려 다시 풍선이 된다.
 * 진폭은 전부 밑동에서의 높이에 비례한다.
 */
const BODY = /* glsl */ `
  float wgdPh = position.x * 7.3 + position.z * 5.1;
  float wgdUp = max(0.0, position.y - ${BASE_Y.toFixed(3)});
  transformed.x += sin(wgdFlameTime * 3.10 + wgdPh) * wgdUp * 0.13;
  transformed.z += cos(wgdFlameTime * 2.35 + wgdPh * 1.37) * wgdUp * 0.11;
  transformed.y += sin(wgdFlameTime * 6.70 + wgdPh * 0.61) * wgdUp * 0.09;
`;

export interface FlameMaterial {
  mat: THREE.MeshBasicMaterial;
  /** 매 프레임 시간을 넣는다 (초). 안 부르면 불이 얼어붙는다 */
  setTime(t: number): void;
}

/**
 * 불꽃 머티리얼 하나를 만든다. 마을이 하나뿐이라 캐시하지 않는다 —
 * 캐시하면 `dispose()` 의 주인이 모호해지고, 판마다 새로 만드는 비용은 셰이더 컴파일 한 번이다.
 */
export function makeFlameMaterial(): FlameMaterial {
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const uniforms = { wgdFlameTime: { value: 0 } };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${BODY}`);
  };
  mat.customProgramCacheKey = () => 'wgd-flame-1';
  return {
    mat,
    setTime: (t) => {
      uniforms.wgdFlameTime.value = t;
    },
  };
}
