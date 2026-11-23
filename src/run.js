#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const https = require('https');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const RUNTIME = path.join(ROOT, 'runtime', 'envlogger.luau');

function findLuau() {
  const candidates = [
    process.env.ENVLOGGER_LUAU, process.env.DEOB_LUAU, '/tmp/luau',
    path.join(ROOT, 'bin', 'luau'), path.join(ROOT, 'bin', 'luau.linux'), 'luau',
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      if (c === 'luau') {
        const r = spawnSync('luau', ['--help'], { encoding: 'utf8' });
        if (r.status === 0 || (r.stderr || r.stdout || '').includes('Usage')) return 'luau';
      } else if (fs.existsSync(c)) return c;
    } catch (_) {}
  }
  return null;
}

function fetchUrl(url, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'EnvLogger/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchUrl(res.headers.location, timeoutMs));
      }
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode !== 200) reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
        else resolve(buf.toString('utf8'));
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function parseArgs(argv) {
  const args = { input: null, url: null, out: null, budget: 25, maxStmts: 8000, json: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--out') args.out = argv[++i];
    else if (a === '--url') args.url = argv[++i];
    else if (a === '--budget') args.budget = Number(argv[++i]) || 25;
    else if (a === '--max-stmts') args.maxStmts = Number(argv[++i]) || 8000;
    else if (a === '--json') args.json = true;
    else if (a === '-h' || a === '--help') args.help = true;
    else if (!a.startsWith('-') && !args.input) args.input = a;
  }
  return args;
}

function longString(s) {
  let eq = 0;
  while (s.includes(']' + '='.repeat(eq) + ']')) eq += 1;
  return '[' + '='.repeat(eq) + '[' + s + ']' + '='.repeat(eq) + ']';
}

function wrapSource(source, cfg) {
  let runtime = fs.readFileSync(RUNTIME, 'utf8');
  runtime = runtime.replace(
    'local CFG = rawget(_G, "__ENVLOGGER_CFG") or {}',
    'local CFG = __ENVLOGGER_CFG or {}'
  );
  runtime = runtime.replace(
    'local source = rawget(_G, "__ENVLOGGER_SOURCE")',
    'local source = __ENVLOGGER_SOURCE'
  );
  const inject =
    'local __ENVLOGGER_CFG = { max_stmts = ' + cfg.maxStmts +
    ', time_budget = ' + cfg.budget +
    ', capture_loadstring = true, soft_errors = true }\n' +
    'local __ENVLOGGER_SOURCE = ' + longString(source) + '\n';
  return inject + runtime + '\n';
}

function summarize(reportText) {
  const summary = { stmts: 0, status: 'unknown', services: [], urls: [], remotes: [], loadstrings: [], errors: [], unknownGlobals: [] };
  let sec = null;
  for (const line of reportText.split(/\r?\n/)) {
    if (line.startsWith('-- ENVLOGGER report')) {
      const m = line.match(/stmts=(\d+)/);
      if (m) summary.stmts = Number(m[1]);
    } else if (line.startsWith('-- status:')) summary.status = line.slice(11).trim();
    else if (line.startsWith('-- urls:')) sec = 'urls';
    else if (line.startsWith('-- services:')) sec = 'services';
    else if (line.startsWith('-- remotes:')) sec = 'remotes';
    else if (line.startsWith('-- loadstring')) sec = 'loadstrings';
    else if (line.startsWith('-- errors:')) sec = 'errors';
    else if (line.startsWith('-- unknown')) sec = 'unknownGlobals';
    else if (line.startsWith('--   ') && sec && Array.isArray(summary[sec])) {
      summary[sec].push(line.replace(/^--\s+/, '').trim());
    } else if (line.startsWith('-- ')) sec = null;
  }
  return summary;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || (!args.input && !args.url)) {
    console.log('ENVLOGGER\n  node src/run.js <file.lua> [-o out.txt] [--budget 25]\n  node src/run.js --url <raw-url>');
    process.exit(args.help ? 0 : 1);
  }
  const luau = findLuau();
  if (!luau) { console.error('[envlogger] luau binary not found'); process.exit(2); }
  if (!fs.existsSync(RUNTIME)) { console.error('[envlogger] missing runtime'); process.exit(2); }

  let source, label;
  if (args.url) {
    console.error('[envlogger] fetching', args.url);
    source = await fetchUrl(args.url);
    label = args.url;
  } else {
    const p = path.resolve(args.input);
    source = fs.readFileSync(p, 'utf8');
    label = p;
  }

  const wrapped = wrapSource(source, args);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'envlogger-'));
  const tmpScript = path.join(tmpDir, 'run.luau');
  fs.writeFileSync(tmpScript, wrapped, 'utf8');

  const res = spawnSync(luau, [tmpScript], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: (args.budget + 15) * 1000,
    env: { ...process.env },
  });

  const stdout = res.stdout || '';
  const stderr = res.stderr || '';
  const begin = stdout.indexOf('\0EL BEGIN');
  const end = stdout.indexOf('\0EL END');
  let report;
  if (begin >= 0 && end > begin) report = stdout.slice(begin + '\0EL BEGIN'.length, end).trim();
  else report = (stdout + '\n' + stderr).trim() || '(no output)';

  const full = 'ENVLOGGER\nsource: ' + label + '\nbytes: ' + source.length + '\nluau: ' + luau +
    '\nexit: ' + res.status + '\n---\n' + report + '\n';

  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(args.out, full, 'utf8');
    console.error('[envlogger] wrote', args.out);
  }
  if (args.json) {
    const summary = summarize(report);
    summary.source = label;
    summary.bytes = source.length;
    console.log(JSON.stringify(summary, null, 2));
  } else process.stdout.write(full);

  try { fs.unlinkSync(tmpScript); fs.rmdirSync(tmpDir); } catch (_) {}
  process.exit(res.status === 0 ? 0 : 1);
}

main().catch((e) => { console.error('[envlogger] fatal', e); process.exit(1); });
