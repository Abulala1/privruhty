import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      input: {
        popup: 'popup.html',
        composer: 'composer.html',
        documents: 'documents.html',
        wordbank: 'wordbank.html',
        settings: 'settings.html',
        content: 'src/content.ts',
        background: 'src/background.ts',
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
