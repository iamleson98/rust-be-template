/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_ADSENSE_CLIENT?: string
  readonly VITE_GOOGLE_ADSENSE_SLOT_HOME?: string
  readonly VITE_GOOGLE_ADSENSE_SLOT_SEARCH?: string
  readonly VITE_AD_DISMISSIBLE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
