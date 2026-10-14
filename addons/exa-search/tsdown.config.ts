import { readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const shared = new Set(['react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'])

// Standalone build: the monorepo's preset resolves only workspace manifests.
// Use the same public module-factory format without importing its workspace policy.
export default [
  {
    entry: { index: 'src/index.ts' }, outDir: 'lib', format: 'esm', platform: 'node',
    target: 'es2022', dts: false, clean: false,
    outputOptions: { entryFileNames: manifest.exports['.'].replace('./lib/', '') },
    deps: { neverBundle: (specifier: string) => specifier.startsWith('@deepseek-ai/') },
  },
  {
    entry: { client: 'src/client/index.ts' }, outDir: 'lib', format: 'cjs', platform: 'browser',
    target: 'es2022', dts: false, clean: false, sourcemap: true,
    deps: {
      neverBundle: (specifier: string) => shared.has(specifier),
      alwaysBundle: (specifier: string) => !shared.has(specifier),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory: (require) => {`,
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  },
]
