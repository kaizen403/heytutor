#!/usr/bin/env node
/** The tutor owns provider selection, voice and delivery settings. */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const tutorRoot = fileURLToPath(new URL('../../tutor/', import.meta.url))
const result = spawnSync('pnpm', ['exec', 'tsx', 'scripts/lecture-lab/generateLandingVoice.ts'], {
  cwd: tutorRoot, stdio: 'inherit', env: process.env,
})
process.exitCode = result.status ?? 1
