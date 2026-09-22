import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { DetachedPanel } from './DetachedPanel';
import './styles.css';

const panel = new URLSearchParams(window.location.search).get('panel');
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {panel === 'video' || panel === 'logs' ? <DetachedPanel tool={panel} /> : <App />}
  </StrictMode>,
);
