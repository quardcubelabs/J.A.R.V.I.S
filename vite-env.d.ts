/// <reference types="vite/client" />

declare namespace NodeJS {
  interface ProcessEnv {
    AI_PROVIDER: 'local' | 'google';
    LOCAL_AI_URL: string;
    LOCAL_AI_MODEL: string;
    GEMINI_API_KEY: string;
  }
}