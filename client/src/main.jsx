import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(<App />);

// Offline support: the service worker caches the app so it opens with no signal.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  {
    window.addEventListener('load', async () => {
      try {
        let wantReload = false;
        const reg = await navigator.serviceWorker.register('/sw.js');
        const offerUpdate = (worker) => {
          const bar = document.createElement('div');
          bar.className = 'update-bar';
          bar.innerHTML = '<span>A new version is ready.</span><button type="button">Reload</button>';
          bar.querySelector('button').onclick = () => { wantReload = true; worker.postMessage('skipWaiting'); };
          document.body.appendChild(bar);
        };
        if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          w?.addEventListener('statechange', () => {
            if (w.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(w);
          });
        });
        // Only reload when the person asked for the update, never on first install.
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (wantReload) { wantReload = false; location.reload(); }
        });
        setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
      } catch { /* service worker unavailable (e.g. private mode); app still works online */ }
    });
  }
}
