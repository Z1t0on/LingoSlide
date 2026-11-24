import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

function copyExtensionAssets() {
  return {
    name: 'copy-lingoslide-assets',
    closeBundle() {
      const rootDir = process.cwd();
      const distDir = path.resolve(rootDir, 'dist');
      const itemsToCopy = ['manifest.json', 'extension', 'workbench'];

      for (const item of itemsToCopy) {
        const srcPath = path.resolve(rootDir, item);
        const destPath = path.resolve(distDir, item);
        if (fs.existsSync(srcPath)) {
          fs.cpSync(srcPath, destPath, { recursive: true });
        }
      }
    }
  };
}

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
    strictPort: true,
    hmr: false
  },
  preview: {
    port: 3000,
    host: '0.0.0.0',
    strictPort: true
  },
  plugins: [copyExtensionAssets()]
});
