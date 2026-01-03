import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        'process.env.AI_PROVIDER': JSON.stringify(env.AI_PROVIDER),
        'process.env.LOCAL_AI_URL': JSON.stringify(env.LOCAL_AI_URL),
        'process.env.LOCAL_AI_MODEL': JSON.stringify(env.LOCAL_AI_MODEL),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.SERP_API_KEY': JSON.stringify(env.SERP_API_KEY),
        'process.env.TAVILY_API_KEY': JSON.stringify(env.TAVILY_API_KEY),
        'process.env.DERIV_API_TOKEN': JSON.stringify(env.DERIV_API_TOKEN)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
