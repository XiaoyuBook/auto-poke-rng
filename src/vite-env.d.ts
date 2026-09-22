/// <reference types="vite/client" />

interface DesktopApi {
  getMetadata: () => Promise<{ name: string; version: string; platform: string }>;
}

interface Window {
  desktop?: DesktopApi;
}
