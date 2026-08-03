# 와가와가 디펜스 (Wogawoga Defense)

원시부족과 함께 마을 화덕을 지켜라! 공룡과 야수 무리에 맞서는 **원시시대 로우폴리 3D 타워 디펜스**.

- 광고 없음 · 결제 없음 · 서버 없음 — 완전 무료 웹게임
- 모든 그래픽·사운드를 코드로 자체 제작 (Three.js 프로시저럴 로우폴리 + WebAudio 합성)
- 아이폰/안드로이드 모바일 브라우저 + 데스크톱 지원 (세로/가로 자동 대응)

## 실행

```bash
npm install
npm run dev        # 개발 서버
npm run build      # 프로덕션 빌드 → dist/
npm run preview    # 빌드 미리보기
npm test           # 시뮬레이션 단위 테스트 (vitest)
npm run e2e        # Playwright 스모크 테스트
```

## 배포

`claude/primitive-defense-game-7covq4` 브랜치에 push하면 GitHub Actions가 자동으로 GitHub Pages에 배포합니다 (`.github/workflows/pages.yml`).

## 아키텍처

```
src/core/    엔진 유틸 — 고정 타임스텝 루프, 시드 PRNG, 이벤트, 풀링, FSM, 입력, 저장
src/render/  Three.js 렌더링 — 프로시저럴 메시 팩토리, 인스턴싱 뷰, 파티클
src/sim/     결정론적 전투 시뮬레이션 (three/DOM 의존 없음 — vitest로 테스트)
src/data/    타입 계약 + 밸런스 데이터 (타워/적/스테이지/웨이브)
src/meta/    영구 진행 (프로필, 보상)
src/game/    통합 글루 (앱 FSM, 전투 컨트롤러, 배치, 연출)
src/ui/      DOM 오버레이 UI (i18n ko/en)
src/audio/   WebAudio 프로시저럴 사운드 (SFX 합성 + 생성 음악)
```

- 시뮬레이션은 30Hz 고정 틱 + 렌더 보간, 커맨드 in / 이벤트 out 구조로 완전 결정론적
- 전투 드로우콜 예산 ≤60 (지형 병합 + 적/투사체/파티클/체력바 인스턴싱)
