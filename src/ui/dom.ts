/**
 * DOM 헬퍼 — UI 트랙 공용 최소 유틸.
 * 프레임워크 없이 요소 생성(h) / 클래스 토글(cls) / 장착(mount/unmount)만 제공한다.
 * 화면(screens/*)과 위젯(widgets/*)은 전부 이 헬퍼로 DOM을 구성한다.
 */

export type Child = Node | string | null | undefined | false;

export interface HProps {
  /** class 속성 (공백 구분) */
  class?: string;
  /** textContent 지정 */
  text?: string;
  /** 신뢰된 내부 마크업(인라인 SVG 등) 전용 — 외부 입력 절대 금지 */
  html?: string;
  attrs?: Record<string, string>;
  onClick?: (ev: MouseEvent) => void;
  onInput?: (ev: Event) => void;
  onChange?: (ev: Event) => void;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: HProps | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    if (props.class !== undefined) el.className = props.class;
    if (props.text !== undefined) el.textContent = props.text;
    if (props.html !== undefined) el.innerHTML = props.html;
    if (props.attrs) {
      for (const [k, v] of Object.entries(props.attrs)) el.setAttribute(k, v);
    }
    if (props.onClick) el.addEventListener('click', props.onClick);
    if (props.onInput) el.addEventListener('input', props.onInput);
    if (props.onChange) el.addEventListener('change', props.onChange);
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

export function cls(el: Element, name: string, on: boolean): void {
  el.classList.toggle(name, on);
}

export function mount(parent: Element, el: Element): void {
  parent.appendChild(el);
}

export function unmount(el: Element): void {
  el.parentElement?.removeChild(el);
}

/** #ui-root — 모든 화면이 이 아래에 장착된다 */
export function uiRoot(): HTMLElement {
  const root = document.getElementById('ui-root');
  if (!root) throw new Error('#ui-root 없음');
  return root;
}

export function clearChildren(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** 1234 → "1,234" (골드/호박 표기) */
export function fmt(n: number): string {
  return Math.floor(n).toLocaleString('en-US');
}

/**
 * textContent diff 갱신 — 매 프레임 폴링하는 HUD에서 불필요한 DOM 쓰기를 막는다.
 * 이전 값은 dataset에 저장한다.
 */
export function setText(el: HTMLElement, text: string): void {
  if (el.dataset['v'] !== text) {
    el.dataset['v'] = text;
    el.textContent = text;
  }
}
