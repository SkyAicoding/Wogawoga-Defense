// 와가와가 디펜스 부트스트랩 — ?scene= 랩 라우팅 후 앱 시작.
import './ui/style.css';
import { tryRunLab } from './debug/harness';
import { createApp } from './game/app';

if (!tryRunLab()) {
  createApp();
}
