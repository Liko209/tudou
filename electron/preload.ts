import { contextBridge } from 'electron';

// Phase 0 preload — empty API surface. Real IPC arrives with M4.
contextBridge.exposeInMainWorld('agentDashboard', {
  version: '0.1.0-scaffold',
});

declare global {
  interface Window {
    agentDashboard: { version: string };
  }
}
