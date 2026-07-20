/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RECEPTIONIST_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
