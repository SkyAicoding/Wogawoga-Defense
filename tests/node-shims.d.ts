/**
 * 테스트 전용 Node 표면의 최소 선언.
 *
 * 왜 `@types/node` 를 넣지 않았나: 이 저장소는 런타임 의존이 three 하나뿐이고 타입 의존도
 * 얇게 유지해 왔다. 봉투가 쓰는 Node 표면은 **원장 파일 읽고 쓰기와 환경변수 넷**뿐이라
 * 패키지를 하나 더 다는 것보다 여기 네 줄이 정직하다. 더 넓게 쓰게 되면 그때 @types/node 로 옮겨라.
 */
declare const process: {
  env: Record<string, string | undefined>;
  stdout: { write(s: string): void };
};

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function writeFileSync(path: string, data: string, encoding: 'utf8'): void;
  /** 문간 실측(tests/sim/gatemeasure.test.ts)이 표를 파일로 낸다 — 통과한 it 의 stdout 은 접힌다 */
  export function appendFileSync(path: string, data: string, encoding: 'utf8'): void;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function existsSync(path: string): boolean;
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
  export function dirname(path: string): string;
}
declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}
