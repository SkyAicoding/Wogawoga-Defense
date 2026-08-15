/**
 * 설정 — 볼륨 슬라이더, 언어, 진동, 품질, 데이터 초기화(2단 확인), 크레딧.
 * 값 변경 즉시 facade.profile.updateSettings + save().
 */
import type { GameFacade, Settings } from '@/data/types';
import type { Screen } from '@/core/fsm';
import { h, cls, mount, unmount, uiRoot, clearChildren } from '../dom';
import { t, setLang } from '../i18n';
import { showDoubleConfirm } from '../widgets/modal';
import { clearSave } from '@/core/save';

export function createSettingsScreen(): Screen<GameFacade> {
  let root: HTMLElement | null = null;

  return {
    enter(facade) {
      root = h('div', { class: 'screen screen--settings' });
      mount(uiRoot(), root);
      render(facade, root);
    },
    exit() {
      if (root) unmount(root);
      root = null;
    },
  };
}

function render(facade: GameFacade, root: HTMLElement): void {
  clearChildren(root);
  const p = facade.profile;
  const s = p.data.settings;

  const apply = (patch: Partial<Settings>): void => {
    p.updateSettings(patch);
    p.save();
  };

  const slider = (label: string, value: number, onSet: (v: number) => void): HTMLElement => {
    const valEl = h('span', { class: 'set-val', text: `${Math.round(value * 100)}%` });
    const input = h('input', {
      class: 'set-slider',
      attrs: { type: 'range', min: '0', max: '100', step: '5', value: String(Math.round(value * 100)) },
      onInput: (e) => {
        const v = Number((e.target as HTMLInputElement).value) / 100;
        valEl.textContent = `${Math.round(v * 100)}%`;
        onSet(v);
      },
    });
    return h('div', { class: 'set-row' },
      h('span', { class: 'set-label', text: label }),
      h('div', { class: 'set-ctrl' }, input, valEl),
    );
  };

  const segmented = <V extends string>(
    label: string,
    options: readonly { v: V; label: string }[],
    current: V,
    onSet: (v: V) => void,
    stack = false,
  ): HTMLElement => {
    const btns = options.map((o) =>
      h('button', {
        class: `seg${o.v === current ? ' is-on' : ''}`,
        attrs: { type: 'button' },
        text: o.label,
        onClick: () => onSet(o.v),
      }),
    );
    return h('div', { class: `set-row${stack ? ' set-row--stack' : ''}` },
      h('span', { class: 'set-label', text: label }),
      h('div', { class: 'set-ctrl seg-group' }, ...btns),
    );
  };

  const toggle = (label: string, on: boolean, onSet: (v: boolean) => void): HTMLElement => {
    const knob = h('button', {
      class: `switch${on ? ' is-on' : ''}`,
      attrs: { type: 'button', role: 'switch', 'aria-checked': String(on) },
      onClick: () => {
        on = !on;
        cls(knob, 'is-on', on);
        knob.setAttribute('aria-checked', String(on));
        onSet(on);
      },
    }, h('span', { class: 'switch-knob' }));
    return h('div', { class: 'set-row' },
      h('span', { class: 'set-label', text: label }),
      h('div', { class: 'set-ctrl' }, knob),
    );
  };

  root.appendChild(
    h('div', { class: 'col' },
      h('div', { class: 'topbar' },
        h('button', {
          class: 'icon-btn',
          attrs: { type: 'button', 'aria-label': t('common.back') },
          text: '←',
          onClick: () => facade.goto('lobby'),
        }),
        h('div', { class: 'topbar-title', text: t('settings.title') }),
        h('div', { class: 'topbar-spacer' }),
      ),
      h('div', { class: 'set-scroll' },
        h('div', { class: 'set-card' },
          slider(t('settings.music'), s.music, (v) => apply({ music: v })),
          slider(t('settings.sfx'), s.sfx, (v) => apply({ sfx: v })),
          toggle(t('settings.vibration'), s.vibration, (v) => apply({ vibration: v })),
        ),
        h('div', { class: 'set-card' },
          segmented(
            t('settings.lang'),
            [{ v: 'ko', label: '한국어' }, { v: 'en', label: 'English' }] as const,
            s.lang,
            (v) => {
              apply({ lang: v });
              setLang(v);
              render(facade, root); // 언어 변경 즉시 재렌더
            },
          ),
          segmented(
            t('settings.quality'),
            [
              { v: 'auto', label: t('settings.quality.auto') },
              { v: 'low', label: t('settings.quality.low') },
              { v: 'med', label: t('settings.quality.med') },
              { v: 'high', label: t('settings.quality.high') },
            ] as const,
            s.quality,
            (v) => {
              apply({ quality: v });
              render(facade, root);
            },
            true, // 4개 옵션 — 라벨 위/버튼 아래 스택 레이아웃
          ),
        ),
        /*
         * 스테이지 잠금 해제 — 로비 카드/무한 토글이 화면에 들어올 때마다 프로필을
         * 다시 읽으므로(lobby.enter가 카드를 새로 만든다) 여기서 값만 바꾸면 즉시 반영된다.
         * 설명 줄은 "진행도는 안 건드린다"를 분명히 해 둔다 — 데이터 초기화 카드 바로
         * 위라서 파괴적인 버튼으로 오해할 자리다.
         */
        h('div', { class: 'set-card' },
          toggle(t('settings.unlockAll'), s.unlockAll, (v) => apply({ unlockAll: v })),
          h('p', { class: 'set-desc', text: t('settings.unlockAllDesc') }),
        ),
        h('div', { class: 'set-card' },
          h('button', {
            class: 'btn btn--danger set-reset',
            attrs: { type: 'button' },
            text: t('settings.reset'),
            onClick: () =>
              showDoubleConfirm({
                title: t('settings.reset'),
                body1: t('settings.resetBody1'),
                body2: t('settings.resetBody2'),
                finalLabel: t('settings.resetFinal'),
                cancelLabel: t('common.cancel'),
                onConfirm: () => {
                  // 계약에 초기화 API가 없어 세이브 삭제 후 리로드 (contractIssues 참고)
                  clearSave();
                  location.reload();
                },
              }),
          }),
        ),
        h('div', { class: 'set-credits', text: t('settings.credits') }),
      ),
    ),
  );
}
