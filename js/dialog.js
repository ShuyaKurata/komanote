// モーダルダイアログとトースト通知

import { h } from './util.js';

/**
 * ダイアログを開く。押されたボタンの value(閉じたら null)で解決する。
 * @param {{title:string, body?:Node|string, buttons?:{label,value,primary?,danger?}[], wide?:boolean, onOpen?:Function}} o
 */
export function showDialog({ title, body, buttons = [{ label: 'OK', value: true, primary: true }], wide = false, onOpen }) {
  return new Promise((resolve) => {
    const vv = window.visualViewport;
    const close = (v) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      vv?.removeEventListener('resize', fit);
      vv?.removeEventListener('scroll', fit);
      // iPad でキーボードを閉じたあとにページがずれたままになるのを戻す
      window.scrollTo(0, 0);
      resolve(v);
    };
    // 画面キーボードが出たら、ダイアログをキーボードの上の見えている範囲に収める
    const fit = () => {
      if (!vv) return;
      overlay.style.top = `${vv.offsetTop}px`;
      overlay.style.height = `${vv.height}px`;
      overlay.style.bottom = 'auto';
      overlay.classList.toggle('kb', vv.height < window.innerHeight * 0.85);
    };
    const onKey = (e) => {
      // 日本語入力の変換中の Enter は、変換の確定なのでボタンを押したことにしない
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
        const p = buttons.find((b) => b.primary);
        if (p) { e.preventDefault(); e.stopPropagation(); close(p.value); }
      }
    };
    const box = h('div', { class: 'dialog' + (wide ? ' wide' : '') },
      h('div', { class: 'dialog-title' }, title),
      h('div', { class: 'dialog-body' }, typeof body === 'string' ? h('p', {}, body) : body),
      h('div', { class: 'dialog-buttons' },
        buttons.map((b) => h('button', {
          class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''),
          onclick: () => close(b.value),
        }, b.label)),
      ),
    );
    const overlay = h('div', { class: 'overlay', onpointerdown: (e) => { if (e.target === overlay) close(null); } }, box);
    document.body.append(overlay);
    document.addEventListener('keydown', onKey, true);
    vv?.addEventListener('resize', fit);
    vv?.addEventListener('scroll', fit);
    fit();
    onOpen?.(box, close);
    // iPad はタップした処理の中で入力欄にフォーカスしたときだけキーボードを出すので、すぐにフォーカスする
    // (少し後でフォーカスすると、キーボードが出ずにもう一度タップが必要になる)
    const first = box.querySelector('textarea,input:not([type=checkbox]),select');
    if (first) {
      first.focus({ preventScroll: true });
      if (first.tagName === 'TEXTAREA') first.setSelectionRange(first.value.length, first.value.length);
      setTimeout(() => { if (document.activeElement !== first) first.focus({ preventScroll: true }); }, 50);
    }
  });
}

export async function confirmDialog(title, message, okLabel = 'OK', danger = false) {
  const v = await showDialog({
    title, body: message,
    buttons: [{ label: 'キャンセル', value: false }, { label: okLabel, value: true, primary: true, danger }],
  });
  return v === true;
}

export async function promptDialog(title, label, value = '') {
  const input = h('input', { type: 'text', class: 'input', value });
  const v = await showDialog({
    title,
    body: h('label', { class: 'field' }, h('span', {}, label), input),
    buttons: [{ label: 'キャンセル', value: false }, { label: 'OK', value: true, primary: true }],
  });
  return v ? input.value : null;
}

let toastTimer = null;
export function toast(msg, ms = 2200) {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast' });
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
