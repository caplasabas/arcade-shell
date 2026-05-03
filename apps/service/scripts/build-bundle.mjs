import { build } from 'esbuild'

await build({
  entryPoints: ['input.js'],
  outfile: 'dist/input.bundle.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
  banner: {
    js: '// Generated bundle entry for the TypeScript service runtime.',
  },
})
