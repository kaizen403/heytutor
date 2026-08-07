/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TUTOR_ORIGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
