/**
 * 확인/일시정지 모달 — 반투명 배경 + 팝 등장 애니메이션.
 * 버튼 탭 시 기본적으로 모달을 닫고 콜백을 호출한다.
 */
import { h, uiRoot, unmount } from '../dom';

export interface ModalButton {
  label: string;
  /** primary(호박 골드) | danger(빨강) | ghost(테두리만). 기본 primary */
  kind?: 'primary' | 'danger' | 'ghost';
  onTap?: () => void;
}

export interface ModalOpts {
  title: string;
  body?: string;
  buttons: ModalButton[];
  /** 배경 탭으로 닫기 허용 (기본 false — 실수 방지) */
  dismissible?: boolean;
  /** 닫힐 때(어떤 경로든) 1회 호출 */
  onClose?: () => void;
}

export interface ModalHandle {
  close(): void;
}

export function showModal(opts: ModalOpts): ModalHandle {
  let closed = false;

  const close = (): void => {
    if (closed) return;
    closed = true;
    backdrop.classList.add('is-closing');
    // 퇴장 애니메이션(0.15s) 후 제거 — 실패해도 타이머로 정리 보장
    setTimeout(() => unmount(backdrop), 160);
    opts.onClose?.();
  };

  const btns = opts.buttons.map((b) =>
    h('button', {
      class: `btn btn--${b.kind ?? 'primary'} modal-btn`,
      attrs: { type: 'button' },
      text: b.label,
      onClick: () => {
        close();
        b.onTap?.();
      },
    }),
  );

  const panel = h(
    'div',
    { class: 'modal', onClick: (e) => e.stopPropagation() },
    h('div', { class: 'modal-title', text: opts.title }),
    opts.body ? h('div', { class: 'modal-body', text: opts.body }) : null,
    h('div', { class: 'modal-btns' }, ...btns),
  );

  const backdrop = h(
    'div',
    {
      class: 'modal-backdrop',
      onClick: () => {
        if (opts.dismissible) close();
      },
    },
    panel,
  );

  uiRoot().appendChild(backdrop);
  return { close };
}

/** 2단 확인 모달 (데이터 초기화 등 파괴적 액션용) */
export function showDoubleConfirm(opts: {
  title: string;
  body1: string;
  body2: string;
  finalLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
}): void {
  showModal({
    title: opts.title,
    body: opts.body1,
    dismissible: true,
    buttons: [
      { label: opts.cancelLabel, kind: 'ghost' },
      {
        label: opts.title,
        kind: 'danger',
        onTap: () => {
          showModal({
            title: opts.title,
            body: opts.body2,
            dismissible: true,
            buttons: [
              { label: opts.cancelLabel, kind: 'ghost' },
              { label: opts.finalLabel, kind: 'danger', onTap: opts.onConfirm },
            ],
          });
        },
      },
    ],
  });
}
