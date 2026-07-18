/// <reference types="vite/client" />
import type { KerchunkBridge } from '../../shared/ipc';

declare global {
  interface Window {
    electronAPI: KerchunkBridge;
  }
}

export {};
