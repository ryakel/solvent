// main.js — entry point. Keeps the boot surface tiny.
import { initApp } from './app.js';

window.addEventListener('DOMContentLoaded', () => {
  try {
    initApp();
  } catch (err) {
    // Surface a fatal init error visibly instead of a blank page.
    console.error('Solvent failed to start:', err);
    const main = document.getElementById('main');
    if (main) {
      const p = document.createElement('p');
      p.style.color = '#e5484d';
      p.style.padding = '16px';
      p.textContent = 'Solvent failed to start: ' + (err && err.message ? err.message : err);
      main.prepend(p);
    }
  }
});
