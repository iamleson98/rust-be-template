// Launch a long-running dev server detached (survives between bash tool
// calls — see spawn-detached.js experiment). Reads the backend .env and
// applies it OVER the ambient environment (the sandbox exports a bogus
// DATABASE_URL that must not win over the file).
//
// Usage: node launch-server.js <name> <logfile> <cwd> <cmd> [args...]
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const [name, logfile, cwd, cmd, ...args] = process.argv.slice(2)

// Start from the ambient env, then overlay .env entries (ours win).
const env = { ...process.env }
const envFile = '/home/z/rust-be-template/.env'
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/)
    if (m) env[m[1]] = m[2]
  }
}

const out = fs.openSync(logfile, 'a')
const child = spawn(cmd, args, {
  cwd,
  env,
  detached: true,
  stdio: ['ignore', out, out],
})
child.unref()
console.log(`[${name}] spawned pid ${child.pid}: ${cmd} ${args.join(' ')}`)
