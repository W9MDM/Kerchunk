import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { Overlay } from './components/Overlay';
import './styles.css';

// The same bundle powers two windows: the main app, and the tiny always-on-top
// PTT overlay (loaded with a #overlay hash). Branch on the hash at boot.
const isOverlay = window.location.hash === '#overlay';

// The overlay window is frameless + transparent — clear the page background so
// only the rounded PTT card shows (not a full-window rectangle).
if (isOverlay) {
  document.documentElement.style.background = 'transparent';
  document.body.style.background = 'transparent';
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isOverlay ? <Overlay /> : <App />}</React.StrictMode>,
);
