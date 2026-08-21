import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// One ID per build, baked into the bundle (via `define` below) and also
// dropped in the output as a plain static file -- lets a tab that's been
// open for hours notice a newer deploy has gone out (compare its own
// baked-in ID against a fresh no-store fetch of build-id.txt) without
// needing any server-side infra. See main.jsx for the runtime check.
const BUILD_ID = String(Date.now())

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'write-build-id',
      buildStart() {
        fs.writeFileSync(path.resolve(__dirname, 'public/build-id.txt'), BUILD_ID)
      },
    },
  ],
  envDir: path.resolve(__dirname, '..'),
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
})
