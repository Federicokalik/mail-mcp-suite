import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The approval app is rendered by the MCP host inside a sandboxed iframe with a
// deny-by-default CSP. Everything has to be inlined into a single HTML file,
// otherwise the host blocks the script and stylesheet requests.
export default defineConfig({
  root: 'src/app',
  plugins: [viteSingleFile()],
  build: {
    outDir: '../../dist/app',
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: Number.POSITIVE_INFINITY
  }
});
