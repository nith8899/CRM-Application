import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { build as buildTokens, MD_PATH } from './scripts/build-tokens.mjs';

// design-tokens.md is the source of the app's style. This plugin rebuilds src/styles/tokens.css
// whenever the MD file is saved, so the open app restyles itself. A broken MD file shows an
// error overlay and leaves the last good tokens.css in place.
function designTokens() {
  const run = (server) => {
    const res = buildTokens({ quiet: !server });
    if (!res.ok) {
      const message = `design-tokens.md has ${res.errors.length} problem(s):\n- ${res.errors.join('\n- ')}`;
      if (server) server.ws.send({ type: 'error', err: { message, stack: '', plugin: 'design-tokens', id: MD_PATH } });
      else throw new Error(message);
    }
    return res;
  };
  return {
    name: 'design-tokens',
    buildStart() { run(null); },
    configureServer(server) {
      server.watcher.add(MD_PATH);
      server.watcher.on('change', (file) => { if (file === MD_PATH) { const r = run(server); if (r.ok && r.changed) server.config.logger.info('design-tokens.md changed → tokens.css rebuilt', { timestamp: true }); } });
    },
  };
}

export default defineConfig({
  plugins: [designTokens(), react()],
  server: { port: 5173, proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } } },
  build: { chunkSizeWarningLimit: 1200 },
});
