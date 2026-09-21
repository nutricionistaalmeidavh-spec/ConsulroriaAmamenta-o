import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const rootDir = realpathSync(process.cwd());

export default defineConfig({
  root: rootDir,
  build: {
    rollupOptions: {
      input: {
        main: resolve(rootDir, 'index.html'),
        app: resolve(rootDir, 'app/index.html'),
      },
    },
  },
});
