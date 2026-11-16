// モーダルダイアログとトースト通知

import { h } from './util.js';

/**
 * ダイアログを開く。押されたボタンの value(閉じたら null)で解決する。
 * @param {{title:string, body?:Node|string, buttons?:{label,value,primary?,danger?}[], wide?:boolean, onOpen?:Function}} o
 */
export function showDialog({ title, body, buttons = [{ label: 'OK', value: true, primary: true }], wide = false, onOpen }) {
  return new Promise((resolve) => {
    const close = (v) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(v);
    };
    const onKey = (e) => {
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
    onOpen?.(box, close);
    const first = box.querySelector('input:not([type=checkbox]),textarea,select');
    if (first) setTimeout(() => first.focus(), 30);
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
