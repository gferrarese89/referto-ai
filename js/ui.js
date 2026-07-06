// ui.js — utilità di interfaccia: viste, toast, tema.

export function showView(id) {
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== id; });
  window.scrollTo(0, 0);
}

let toastTimer;
export function toast(message, { error = false, ms = 3200 } = {}) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.toggle('error', error);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

export async function copyPlainText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback per contesti senza Clipboard API
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}
