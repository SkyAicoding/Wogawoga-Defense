// Age of Wogawoga (와가와가의 시대) 부트스트랩 — ?scene= 랩 라우팅 후 앱 시작.
import './ui/style.css';
import { tryRunLab } from './debug/harness';
import { createApp } from './game/app';

// iOS 사파리 핀치 페이지줌 방지 — 비표준 gesture* 이벤트(iOS 전용)를 통째로 막는다.
// meta viewport의 user-scalable=no는 iOS 10+에서 무시되므로 이 경로가 실효 수단.
const preventGesture = (e: Event): void => {
  e.preventDefault();
};
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(ev, preventGesture, { passive: false });
}

if (!tryRunLab()) {
  createApp();
}
