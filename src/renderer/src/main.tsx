import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { Overlay } from './components/Overlay';
import './styles.css';

// The same bundle powers two windows: the main app, and the tiny always-on-top
// PTT overlay (loaded with a #overlay hash). Branch on the hash at boot.
const isOverlay = window.location.hash === '#overlay';

// The overlay is a solid dark frameless window; match the page to it so there's
// no light flash or mismatched corners.
if (isOverlay) {
  document.documentElement.style.background = '#171719';
  document.body.style.background = '#171719';
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isOverlay ? <Overlay /> : <App />}</React.StrictMode>,
);
