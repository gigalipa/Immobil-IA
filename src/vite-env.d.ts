/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_IMMOBILIA_DATA_MODE?: "demo" | "real";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
