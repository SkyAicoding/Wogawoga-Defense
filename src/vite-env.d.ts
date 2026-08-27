/// <reference types="vite/client" />

/**
 * 빌드 시각 (ISO 8601) — `vite.config.ts` 의 `define` 이 빌드 때 문자열 리터럴로 박는다.
 * 런타임 값이 아니라 **컴파일 타임 상수**라, 배포본에서는 배포 시각으로 굳어 있다.
 */
declare const __BUILD_TIME__: string;
