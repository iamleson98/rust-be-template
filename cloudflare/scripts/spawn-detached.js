// Test: does a child spawned like agent-browser does (detached + ignore
// stdio + unref) survive between bash tool calls?
// Usage: node spawn-detached.js <logfile> <cmd> [args...]
const [logfile, cmd, ...args] = process.argv.slice(2)
const { spawn } = require('child_process')
const fs = require('fs')
const out = fs.openSync(logfile, 'a')
const child = spawn(cmd, args, {
  detached: true,
  stdio: ['ignore', out, out],
})
child.unref()
console.log('spawned pid', child.pid, 'cmd', cmd, args.join(' '))
