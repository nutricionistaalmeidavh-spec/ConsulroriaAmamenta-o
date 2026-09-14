import { defineConfig } from 'vite';

export default defineConfig({
    base: './',
    build: {
        outDir: 'dist',
        sourcemap: false,
        rollupOptions: {
            maxParallelFileOps: 128,
        },
    },
});
