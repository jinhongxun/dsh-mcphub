/**
 * dsh-mcphub — host half.
 *
 * MCP management panel backend. Reads every DSH profile's cordis.patch.yml,
 * derives per-server connection status from the live tool registry
 * (`mcp__<server>__*` tool registrations), detects pip/npx-managed local
 * stdio servers, checks PyPI/npm for newer versions, upgrades them on
 * request, probes streamable-http servers with a real MCP `initialize`
 * handshake, and appends new server entries to the profile patch file.
 *
 * Host RPC is exposed through the client-connection channel `/dsh-mcphub`
 * (loopback authority): endpoints `list`, `check-upgrades`, `probe`,
 * `upgrade`, `create`. Secrets read from profile configs (header/env values)
 * never leave the host: the client only receives key names.
 */
import { existsSync, readFileSync, writeFileSync, readdirSync, rmSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'

/** Plugin identity for cordis.yml rows / client-modules keying. */
export const name = 'dsh-mcphub'

/** Hard dependency: the tool registry that mirrors live MCP servers. */
export const inject = ['tools']

/** Channel path for the client RPC. */
const CHANNEL = '/dsh-mcphub'

const SERVER_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/
const MCP_TOOL_RE = /^mcp__([A-Za-z0-9_-]{1,32})__(.+)$/
const PIP_LIST_TTL_MS = 5 * 60_000
const REMOTE_VERSION_TTL_MS = 5 * 60_000
const PIP_UPGRADE_TIMEOUT_MS = 10 * 60_000
const PIP_LIST_TIMEOUT_MS = 60_000
const PROBE_TIMEOUT_MS = 12_000

function errMsg(e) {
  return String(e && e.message ? e.message : e)
}

/** POSIX single-quote for embedding a path in a sh -c command line. */
function shellQuote(v) {
  return "'" + String(v).replace(/'/g, "'\\''") + "'"
}

/* ------------------------------------------------------------------ */
/* YAML (subset) parsing for cordis.patch.yml                          */
/* ------------------------------------------------------------------ */

function unquote(v) {
  const s = String(v == null ? '' : v).trim()
  if (s === '' || s.startsWith('#')) return ''
  const q = s.charAt(0)
  if (q === "'" || q === '"') {
    const end = s.lastIndexOf(q)
    if (end > 0) return s.slice(1, end)
    return s.slice(1)
  }
  return s.replace(/\s+#.*$/, '').trim()
}

function indentOf(line) {
  return line.length - line.trimStart().length
}

function parseInlineArray(v) {
  const s = String(v == null ? '' : v).trim()
  if (!s.startsWith('[') || !s.endsWith(']')) return null
  const inner = s.slice(1, -1).trim()
  if (inner === '') return []
  const items = []
  let cur = ''
  let q = ''
  for (const ch of inner) {
    if (q) {
      cur += ch
      if (ch === q) q = ''
      continue
    }
    if (ch === "'" || ch === '"') {
      q = ch
      cur += ch
      continue
    }
    if (ch === ',') {
      items.push(unquote(cur))
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.trim() !== '') items.push(unquote(cur))
  return items
}

/**
 * Occurrence-based extraction of every `@deepseek-ai/dsh-mcp-client` row in
 * a patch file, whether the row sits at the top level or inside `- insert:`
 * list nesting. Each `name:` line with a deeper-indented `config:` map is one
 * MCP server record.
 */
function parsePatch(text) {
  const out = []
  const lines = String(text == null ? '' : text).split(/\r?\n/)
  // Pre-pass: top-level `- id: X` + `disabled: true` override rows (the
  // loader's id-targeted disable). Inserted MCP rows can be paused this way
  // without touching their nested block.
  const disabledIds = new Set()
  for (let i = 0; i < lines.length; i++) {
    if (!/^-\s/.test(lines[i])) continue
    const im = /^-\s*id:\s*(.*)$/.exec(lines[i].trim())
    if (!im) continue
    const oid = unquote(im[1])
    for (let j = i + 1; j < lines.length; j++) {
      if (/^-\s/.test(lines[j])) break
      if (/^\s*disabled:\s*true\s*$/.test(lines[j])) {
        disabledIds.add(oid)
        break
      }
    }
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const t = line.trim()
    if (!/^name:\s*['"]@deepseek-ai\/dsh-mcp-client['"]\s*$/.test(t)) continue
    const n = indentOf(line)
    let id = null
    let itemStart = i
    for (let j = i - 1; j >= 0; j--) {
      const lt = lines[j].trim()
      if (lt === '' || lt.startsWith('#')) continue
      if (indentOf(lines[j]) < n) {
        const m = /^(?:-\s*)?id:\s*(.*)$/.exec(lt)
        if (m) {
          id = unquote(m[1])
          itemStart = j
        }
        break
      }
    }
    let end = lines.length
    for (let j = i + 1; j < lines.length; j++) {
      const lt = lines[j].trim()
      if (lt === '' || lt.startsWith('#')) continue
      if (indentOf(lines[j]) < n) {
        end = j
        break
      }
    }
    const body = lines.slice(i + 1, end)
    const inlineDisabled = body.some((l) => /^\s*disabled:\s*true\s*$/.test(l))
    let cfgIdx = -1
    for (let j = 0; j < body.length; j++) {
      const lt = body[j].trim()
      const li = indentOf(body[j])
      if (lt.startsWith('config:') && li >= n - 2 && li <= n + 2) {
        cfgIdx = j
        break
      }
    }
    if (cfgIdx === -1) continue
    const c = indentOf(body[cfgIdx])
    let m = -1
    for (let j = cfgIdx + 1; j < body.length; j++) {
      const lt = body[j].trim()
      if (lt === '' || lt.startsWith('#')) continue
      const li = indentOf(body[j])
      if (li <= c) break
      m = li
      break
    }
    if (m === -1) continue
    const rec = {
      id,
      serverName: null,
      transport: null,
      url: null,
      command: null,
      args: [],
      env: {},
      headers: {},
      cwd: null,
      inlineDisabled,
      disabled: inlineDisabled || disabledIds.has(id),
      entryStart: itemStart,
      entryEnd: end,
    }
    let mapMode = null
    for (let j = cfgIdx + 1; j < body.length; j++) {
      const lt = body[j].trim()
      if (lt === '' || lt.startsWith('#')) continue
      const li = indentOf(body[j])
      if (li <= c) break
      if (li === m) {
        mapMode = null
        const km = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lt)
        if (!km) continue
        const k = km[1]
        const v = km[2]
        if (k === 'serverName') rec.serverName = unquote(v)
        else if (k === 'transport') rec.transport = unquote(v)
        else if (k === 'url') rec.url = unquote(v)
        else if (k === 'command') rec.command = unquote(v)
        else if (k === 'cwd') rec.cwd = unquote(v)
        else if ((k === 'headers' || k === 'env') && v.trim() === '') {
          rec[k] = {}
          mapMode = k
        } else if (k === 'args') {
          const arr = parseInlineArray(v)
          if (arr !== null) rec.args = arr
          else if (v.trim() === '') mapMode = 'args'
          else rec.args = [unquote(v)]
        }
        continue
      }
      if (li >= m + 2 && mapMode !== null) {
        if (mapMode === 'args') {
          const am = /^-\s*(.*)$/.exec(lt)
          if (am) rec.args.push(unquote(am[1]))
        } else {
          const hm = /^('[^']*'|"[^"]*"|[A-Za-z0-9_.-]+):\s*(.*)$/.exec(lt)
          if (hm) rec[mapMode][unquote(hm[1])] = unquote(hm[2])
        }
      }
    }
    if (rec.serverName !== null && rec.serverName !== '') out.push(rec)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Environment helpers                                                 */
/* ------------------------------------------------------------------ */

function dshHome() {
  const env = process.env.DSH_HOME
  if (typeof env === 'string' && env.trim() !== '') return env.trim()
  return join(homedir(), '.dsh')
}

function normPath(p) {
  return String(p).replace(/\\/g, '/')
}

let profilesCache = null
let profilesDirty = true

function loadProfiles() {
  if (!profilesDirty && profilesCache !== null) return profilesCache
  const root = join(dshHome(), 'profiles')
  const list = []
  let entries = []
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    entries = []
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const p = join(root, e.name, 'cordis.patch.yml')
    try {
      const text = readFileSync(p, 'utf8')
      list.push({ name: e.name, path: p, text, servers: parsePatch(text) })
    } catch {}
  }
  profilesCache = list
  profilesDirty = false
  return list
}

/* ------------------------------------------------------------------ */
/* Live status from the tool registry                                  */
/* ------------------------------------------------------------------ */

let liveCache = null

function liveMap(ctx) {
  if (liveCache !== null) return liveCache
  const map = new Map()
  try {
    for (const s of ctx.tools.schemas()) {
      const nm = s && s.name
      if (typeof nm !== 'string') continue
      const m = MCP_TOOL_RE.exec(nm)
      if (!m) continue
      if (!map.has(m[1])) map.set(m[1], [])
      const arr = map.get(m[1])
      if (arr.length < 100) {
        arr.push({
          name: nm,
          description: typeof s.description === 'string' ? s.description.slice(0, 140) : '',
        })
      }
    }
  } catch {}
  liveCache = map
  return map
}

/* ------------------------------------------------------------------ */
/* Package-manager detection                                           */
/* ------------------------------------------------------------------ */

const IS_WINDOWS = process.platform === 'win32'

function detectPip(command) {
  try {
    const p = normPath(String(command == null ? '' : command))
    if (IS_WINDOWS) {
      // Windows venv/install: <python-root>\Scripts\tool.exe, python.exe beside.
      const idx = p.toLowerCase().lastIndexOf('/scripts/')
      if (idx <= 0) return null
      const exe = p.slice(idx + 9)
      if (!/\.exe$/i.test(exe)) return null
      if (exe.includes('/')) return null
      return {
        pythonExe: p.slice(0, idx) + '/python.exe',
        packageName: exe.replace(/\.exe$/i, ''),
      }
    }
    // POSIX: <python-root>/bin/tool (no extension), python3 beside.
    const idx = p.toLowerCase().lastIndexOf('/bin/')
    if (idx <= 0) return null
    const tool = p.slice(idx + 5)
    if (tool === '' || tool.includes('/')) return null
    if (tool.includes('.')) return null // scripts from pip carry no extension
    const pythonExe = existsSync(p.slice(0, idx) + '/python3')
      ? p.slice(0, idx) + '/python3'
      : p.slice(0, idx) + '/python'
    return { pythonExe, packageName: tool }
  } catch {
    return null
  }
}

function detectNpm(rec) {
  const tokens = [String(rec.command == null ? '' : rec.command)].concat(
    (rec.args == null ? [] : rec.args).map(String),
  )
  const lower = tokens.map((t) => t.toLowerCase())
  const i = lower.indexOf('npx')
  if (i === -1) return null
  let j = i + 1
  while (j < tokens.length && tokens[j].charAt(0) === '-') j++
  if (j >= tokens.length) return null
  const raw = tokens[j]
  // An explicit `@latest` spec re-resolves the newest version by intent: no
  // upgrade prompt is useful for it. A bare `pkg` spec gets pinned by the npx
  // cache, so it keeps the upgrade badge + cache-refresh action.
  const latestTag = /@latest\s*$/.test(raw)
  let pkg = raw
  const m = /^(@[^/@]+\/[^/@]+)(@.*)?$/.exec(pkg)
  if (m) pkg = m[1]
  else pkg = pkg.replace(/@[^/@]*$/, '')
  if (pkg === '' || pkg.charAt(0) === '-') return null
  return { packageName: pkg, latestTag }
}

function pep503(s) {
  return String(s).toLowerCase().replace(/[-_.]+/g, '-')
}

/** npm cache root, resolved once (npm config beats the platform guess). */
let npmCachePathCache = null
async function npmCacheDir() {
  if (npmCachePathCache !== null) return npmCachePathCache
  let dir = ''
  const r = await run(
    IS_WINDOWS ? 'cmd' : 'sh',
    IS_WINDOWS ? ['/c', 'npm', 'config', 'get', 'cache'] : ['-c', 'npm config get cache'],
    15_000,
  )
  if (r.code === 0) dir = r.out.trim().split(/\r?\n/).pop().trim()
  if (dir === '') {
    dir = IS_WINDOWS
      ? join(process.env.LOCALAPPDATA == null ? '' : process.env.LOCALAPPDATA, 'npm-cache')
      : join(homedir(), '.npm')
  }
  npmCachePathCache = dir
  return dir
}

/**
 * Version of a package actually sitting in the npx cache, or null when no
 * cached copy exists (cache cleared / never spawned). npx reuses the cached
 * copy without checking the registry, so THIS is the "installed version" for
 * npx-type MCP servers — the registry's latest alone cannot decide upgrades.
 */
async function npmCachedVersion(pkg) {
  const base = join(await npmCacheDir(), '_npx')
  let entries = []
  try {
    entries = readdirSync(base, { withFileTypes: true })
  } catch {
    return null
  }
  const parts = pkg.split('/')
  let best = null
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const p = join(base, e.name, 'node_modules', ...parts, 'package.json')
    try {
      const j = JSON.parse(readFileSync(p, 'utf8'))
      if (typeof j.version === 'string' && (best === null || cmpVersion(j.version, best) > 0)) {
        best = j.version
      }
    } catch {}
  }
  return best
}

function run(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    try {
      const child = execFile(
        cmd,
        args,
        { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
        (error, stdout, stderr) => {
          resolve({
            code: error && typeof error.code === 'number' ? error.code : error ? -1 : 0,
            out: String(stdout == null ? '' : stdout),
            err: String(stderr == null ? '' : stderr),
          })
        },
      )
      child.on('error', () => resolve({ code: -1, out: '', err: 'spawn failed' }))
    } catch (e) {
      resolve({ code: -1, out: '', err: errMsg(e) })
    }
  })
}

const pipListCache = new Map()

async function pipMap(pythonExe, force) {
  const hit = pipListCache.get(pythonExe)
  if (!force && hit !== undefined && Date.now() - hit.ts < PIP_LIST_TTL_MS) return hit.map
  const python = normPath(pythonExe)
  if (!existsSync(python)) return null
  const r = await run(
    python,
    ['-m', 'pip', 'list', '--format', 'json', '--disable-pip-version-check'],
    PIP_LIST_TIMEOUT_MS,
  )
  let map = null
  if (r.code === 0 && r.out.trim() !== '') {
    try {
      const arr = JSON.parse(r.out)
      if (Array.isArray(arr)) {
        map = new Map()
        for (const item of arr) {
          if (item && typeof item.name === 'string') {
            map.set(pep503(item.name), String(item.version == null ? '' : item.version))
          }
        }
      }
    } catch {}
  }
  if (map !== null) pipListCache.set(pythonExe, { ts: Date.now(), map })
  return map
}

const remoteVersionCache = new Map()

async function pypiLatest(pkg) {
  const key = 'pip:' + pkg
  const hit = remoteVersionCache.get(key)
  if (hit !== undefined && Date.now() - hit.ts < REMOTE_VERSION_TTL_MS) return hit.version
  let version = null
  try {
    const res = await fetch(`https://pypi.org/pypi/${encodeURIComponent(pkg)}/json`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (res.ok) {
      const j = await res.json()
      if (j && j.info && typeof j.info.version === 'string') version = j.info.version
    }
  } catch {}
  remoteVersionCache.set(key, { ts: Date.now(), version })
  return version
}

async function npmLatest(pkg) {
  const key = 'npm:' + pkg
  const hit = remoteVersionCache.get(key)
  if (hit !== undefined && Date.now() - hit.ts < REMOTE_VERSION_TTL_MS) return hit.version
  let version = null
  const r = await run(IS_WINDOWS ? 'cmd' : 'sh', IS_WINDOWS ? ['/c', 'npm', 'view', pkg, 'version'] : ['-c', 'npm view ' + shellQuote(pkg) + ' version'], 45_000)
  if (r.code === 0 && r.out.trim() !== '') {
    version = r.out.trim().split(/\r?\n/).pop().trim()
  }
  remoteVersionCache.set(key, { ts: Date.now(), version })
  return version
}

function cmpVersion(a, b) {
  const pa = String(a).split(/[.-]/)
  const pb = String(b).split(/[.-]/)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i]
    const y = pb[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xn = /^\d+$/.test(x) ? parseInt(x, 10) : null
    const yn = /^\d+$/.test(y) ? parseInt(y, 10) : null
    if (xn !== null && yn !== null) {
      if (xn !== yn) return xn < yn ? -1 : 1
    } else {
      const c = String(x).localeCompare(String(y))
      if (c !== 0) return c < 0 ? -1 : 1
    }
  }
  return 0
}

/* ------------------------------------------------------------------ */
/* Server rows                                                         */
/* ------------------------------------------------------------------ */

async function buildServerRows(ctx) {
  const profiles = loadProfiles()
  const live = liveMap(ctx)
  let active = null
  let best = -1
  for (const p of profiles) {
    let overlap = 0
    for (const s of p.servers) if (live.has(s.serverName)) overlap++
    const score = overlap * 100 + p.servers.length
    if (score > best) {
      best = score
      active = p
    }
  }
  const rows = []
  const seen = new Set()
  for (const p of profiles) {
    for (const rec of p.servers) {
      if (seen.has(rec.serverName)) continue
      seen.add(rec.serverName)
      const lt = live.get(rec.serverName) == null ? [] : live.get(rec.serverName)
      const row = {
        name: rec.serverName,
        transport: rec.transport == null ? 'unknown' : rec.transport,
        target:
          rec.transport === 'streamable-http'
            ? String(rec.url == null ? '' : rec.url)
            : [String(rec.command == null ? '' : rec.command)]
                .concat(rec.args == null ? [] : rec.args)
                .filter((x) => x !== '')
                .join(' '),
        connected: lt.length > 0,
        toolCount: lt.length,
        sampleTools: lt.slice(0, 8),
        headerKeys: Object.keys(rec.headers == null ? {} : rec.headers),
        envKeys: Object.keys(rec.env == null ? {} : rec.env),
        profile: p.name,
        source: 'config',
        disabled: rec.disabled === true,
      }
      if (rec.transport === 'stdio') {
        const pip = detectPip(rec.command)
        if (pip !== null) {
          row.managedKind = 'pip'
          row.packageName = pip.packageName
          row.pythonExe = pip.pythonExe
          const pm = await pipMap(pip.pythonExe, false)
          if (pm !== null) {
            const v = pm.get(pep503(pip.packageName))
            if (v !== undefined) {
              row.installedVersion = v
              row.packageRecognized = true
            } else row.packageRecognized = false
          } else row.packageRecognized = false
        } else {
          const npm = detectNpm(rec)
          if (npm !== null) {
            row.managedKind = 'npm'
            row.packageName = npm.packageName
            if (npm.latestTag) row.latestTag = true
            else row.installedVersion = await npmCachedVersion(npm.packageName)
          }
        }
      }
      rows.push(row)
    }
  }
  for (const entry of Array.from(live.keys())) {
    if (seen.has(entry)) continue
    rows.push({
      name: entry,
      transport: 'unknown',
      target: '',
      connected: true,
      toolCount: (live.get(entry) == null ? [] : live.get(entry)).length,
      sampleTools: (live.get(entry) == null ? [] : live.get(entry)).slice(0, 8),
      headerKeys: [],
      envKeys: [],
      profile: null,
      source: 'live',
    })
  }
  rows.sort((a, b) => a.name.localeCompare(b.name))
  return { profiles, active, rows }
}

function findRecWithProfile(name) {
  for (const p of loadProfiles()) {
    for (const r of p.servers) if (r.serverName === name) return { rec: r, profile: p }
  }
  return null
}

function findRec(name) {
  const hit = findRecWithProfile(name)
  return hit === null ? null : hit.rec
}

/** Rewrite one profile's patch file from a line array (shared write path). */
function writeProfileLines(profile, lines) {
  const text = lines.join('\n')
  writeFileSync(profile.path, text, 'utf8')
  profile.text = text
  profile.servers = parsePatch(text)
  profilesDirty = true
}

/** Remove the top-level disable-override row for an entry id, if present. */
function removeOverrideRow(lines, entryId) {
  for (let i = 0; i < lines.length; i++) {
    if (!/^-\s/.test(lines[i])) continue
    const im = /^-\s*id:\s*(.*)$/.exec(lines[i].trim())
    if (!im || unquote(im[1]) !== entryId) continue
    // An override row is `- id: X` immediately followed by `disabled:` (and
    // nothing else). The ENTRY's own `- id: X` line is followed by `name:` —
    // it must never be touched.
    let j = i + 1
    while (
      j < lines.length &&
      !/^-\s/.test(lines[j]) &&
      !/^name:/.test(lines[j].trim()) &&
      !/^\s*disabled:\s/.test(lines[j])
    ) {
      j++
    }
    if (j >= lines.length || !/^\s*disabled:\s/.test(lines[j])) continue
    lines.splice(i, j - i)
    return true
  }
  return false
}

/**
 * Pause/resume one MCP server via the loader's id-targeted disable:
 * pause appends a top-level `- id: X / disabled: true` override row (the
 * proven pattern already used in shipped patch files); resume removes that
 * row, plus any inline `disabled: true` inside the entry itself.
 */
async function epSetDisabled(_ctx, args) {
  const name = args && args.name
  const wantDisabled = !!(args && args.disabled)
  const hit = findRecWithProfile(name)
  if (hit === null) return { ok: false, error: '未在配置中找到该服务器' }
  const { rec, profile } = hit
  const entryId = rec.id !== null && rec.id !== '' ? rec.id : 'mcp-' + name
  const lines = (profile.text == null ? '' : profile.text).split(/\r?\n/)

  // Remove any existing top-level override row for this entry id.
  removeOverrideRow(lines, entryId)

  if (wantDisabled) {
    // Append the override row (matches the shipped disable-row style).
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
    lines.push('- id: ' + yamlScalar(entryId))
    lines.push('  disabled: true')
    lines.push('')
  } else if (rec.inlineDisabled) {
    // Also strip an inline `disabled: true` from the entry block itself.
    for (let i = rec.entryStart; i < Math.min(rec.entryEnd, lines.length); i++) {
      if (/^\s*disabled:\s*true\s*$/.test(lines[i])) {
        lines.splice(i, 1)
        break
      }
    }
  }

  try {
    writeProfileLines(profile, lines)
  } catch (e) {
    return { ok: false, error: '写入失败：' + errMsg(e) }
  }
  return {
    ok: true,
    restartRequired: true,
    message: wantDisabled
      ? '已暂停 ' + name + '：重启 DSH 后其工具将不再加载（配置保留，可随时恢复）'
      : '已恢复 ' + name + '：重启 DSH 后重新连接',
  }
}

/**
 * Delete one MCP server: remove its entry block (plus its leading comment
 * lines and trailing blanks) and any disable-override row for its id.
 */
async function epDelete(_ctx, args) {
  const name = args && args.name
  const hit = findRecWithProfile(name)
  if (hit === null) return { ok: false, error: '未在配置中找到该服务器' }
  const { rec, profile } = hit
  const entryId = rec.id !== null && rec.id !== '' ? rec.id : 'mcp-' + name
  const lines = (profile.text == null ? '' : profile.text).split(/\r?\n/)

  // Remove the override row first (indices shift otherwise).
  removeOverrideRow(lines, entryId)

  // Re-locate the entry block in the CURRENT line array by serverName (the
  // parse indices belonged to the pre-splice text).
  let start = -1
  let end = -1
  for (let i = 0; i < lines.length; i++) {
    if (!/^name:\s*['"]@deepseek-ai\/dsh-mcp-client['"]\s*$/.test(lines[i].trim())) continue
    // Walk back to the item's `- id:` line.
    let s = i
    for (let j = i - 1; j >= 0; j--) {
      const lt = lines[j].trim()
      if (lt === '' || lt.startsWith('#')) continue
      if (indentOf(lines[j]) < indentOf(lines[i])) {
        s = j
        break
      }
    }
    // Boundary: next non-blank non-comment line with indent < name indent.
    let e = lines.length
    for (let j = i + 1; j < lines.length; j++) {
      const lt = lines[j].trim()
      if (lt === '' || lt.startsWith('#')) continue
      if (indentOf(lines[j]) < indentOf(lines[i])) {
        e = j
        break
      }
    }
    // Confirm this block is OUR serverName.
    const seg = lines.slice(s, e).join('\n')
    if (new RegExp('serverName:\\s*' + escapeReg(yamlScalar(name)) + '\\s*$', 'm').test(seg)) {
      start = s
      end = e
      break
    }
  }
  if (start === -1) return { ok: false, error: '未能定位该服务器的配置块' }

  // Trim trailing blank/comment lines out of the removal range.
  while (end > start) {
    const lt = lines[end - 1].trim()
    if (lt !== '' && !lt.startsWith('#')) break
    end--
  }
  // Extend upward over the entry's own leading comment lines (same-or-deeper
  // indent only, so file-level headers survive).
  const itemIndent = indentOf(lines[start])
  while (start > 0) {
    const prev = lines[start - 1]
    const pt = prev.trim()
    if (pt.startsWith('#') && indentOf(prev) >= itemIndent) start--
    else break
  }

  lines.splice(start, end - start)
  try {
    writeProfileLines(profile, lines)
  } catch (e) {
    return { ok: false, error: '写入失败：' + errMsg(e) }
  }
  return {
    ok: true,
    restartRequired: true,
    message: '已删除 ' + name + ' 的配置条目：重启 DSH 后彻底卸载（其工具在此之前可能仍可用）',
  }
}

/* ------------------------------------------------------------------ */
/* Endpoints                                                           */
/* ------------------------------------------------------------------ */

async function epList(ctx) {
  const built = await buildServerRows(ctx)
  return {
    ok: true,
    home: normPath(dshHome()),
    activeProfile: built.active !== null ? built.active.name : null,
    profiles: built.profiles.map((p) => ({ name: p.name, path: normPath(p.path) })),
    servers: built.rows,
  }
}

async function epCheckUpgrades(ctx, args) {
  const built = await buildServerRows(ctx)
  const wantedNames = Array.isArray(args && args.names) ? args.names : null
  const wanted = built.rows.filter(
    (r) =>
      (r.managedKind === 'pip' || (r.managedKind === 'npm' && !r.latestTag)) &&
      (wantedNames === null || wantedNames.includes(r.name)),
  )
  const results = await Promise.all(
    wanted.map(async (r) => {
      if (r.managedKind === 'pip') {
        const latest = await pypiLatest(r.packageName)
        const installed = typeof r.installedVersion === 'string' ? r.installedVersion : null
        const upgradable = latest !== null && installed !== null && cmpVersion(installed, latest) < 0
        return [
          r.name,
          { kind: 'pip', latestVersion: latest, installedVersion: installed, upgradable },
        ]
      }
      const latest = await npmLatest(r.packageName)
      const installed = typeof r.installedVersion === 'string' ? r.installedVersion : null
      const refreshed = npmRefreshed.has(r.name)
      // Only claim "upgradable" when the cached copy is provably older than
      // the registry latest. Unknown cached version (cache cleared / absent)
      // or a just-refreshed cache renders the badge neutral instead of
      // crying "upgradable" forever.
      const upgradable =
        !refreshed && latest !== null && installed !== null && cmpVersion(installed, latest) < 0
      return [
        r.name,
        { kind: 'npm', latestVersion: latest, installedVersion: installed, upgradable, refreshed },
      ]
    }),
  )
  const map = {}
  for (const pair of results) map[pair[0]] = pair[1]
  return { ok: true, upgrades: map }
}

async function epProbe(_ctx, args) {
  const name = args && args.name
  const rec = findRec(name)
  if (rec === null) return { ok: false, detail: '未在配置中找到该服务器' }
  const started = Date.now()
  if (rec.transport === 'streamable-http') {
    if (!rec.url) return { ok: false, detail: '配置缺少 url' }
    let res = null
    let errText = ''
    try {
      res = await fetch(rec.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...(rec.headers == null ? {} : rec.headers),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'dsh-mcphub', version: '0.0.1' },
          },
        }),
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      })
    } catch (e) {
      errText = errMsg(e)
    }
    const ms = Date.now() - started
    if (res === null) return { ok: false, ms, detail: '请求失败：' + errText }
    const code = res.status
    let serverInfo = null
    try {
      const text = await res.text()
      for (const rawLine of text.split(/\r?\n/)) {
        let l = rawLine.trim()
        if (l.startsWith('data:')) l = l.slice(5).trim()
        if (l.charAt(0) !== '{') continue
        try {
          const j = JSON.parse(l)
          const si = j && j.result && j.result.serverInfo
          if (si) {
            serverInfo = {
              name: String(si.name == null ? '' : si.name),
              version: String(si.version == null ? '' : si.version),
            }
            break
          }
        } catch {}
      }
    } catch {}
    if (code >= 200 && code < 300) {
      return {
        ok: true,
        httpCode: code,
        ms,
        serverInfo,
        detail:
          serverInfo !== null
            ? ('握手成功：' + serverInfo.name + ' ' + serverInfo.version).trim()
            : '握手成功（HTTP ' + code + '）',
      }
    }
    return { ok: false, httpCode: code, ms, detail: 'HTTP ' + code }
  }
  if (rec.transport === 'stdio') {
    const cmd = String(rec.command == null ? '' : rec.command)
    if (cmd === '') return { ok: false, detail: '配置缺少 command' }
    const abs = /^[a-zA-Z]:[\\/]/.test(cmd) || cmd.startsWith('/') || cmd.startsWith('\\')
    if (abs) {
      const exists = existsSync(cmd)
      return {
        ok: exists,
        ms: Date.now() - started,
        detail: (exists ? '可执行文件已找到：' : '可执行文件不存在：') + cmd,
      }
    }
    const r = await run(IS_WINDOWS ? 'cmd' : 'sh', IS_WINDOWS ? ['/c', 'where', cmd] : ['-c', 'command -v ' + shellQuote(cmd)], 15_000)
    const found = r.code === 0 && r.out.trim() !== ''
    return {
      ok: found,
      ms: Date.now() - started,
      detail: found
        ? '已在 PATH 中找到：' + r.out.trim().split(/\r?\n/)[0]
        : '未在 PATH 中找到：' + cmd,
    }
  }
  return { ok: false, detail: '未知传输类型：' + String(rec.transport) }
}

const upgrading = new Set()
/** npx servers whose cache was cleared this session: pending restart to take effect. */
const npmRefreshed = new Set()

async function epUpgrade(_ctx, args) {
  const name = args && args.name
  const pkgOverride =
    args && typeof args.packageName === 'string' && args.packageName.trim() !== ''
      ? args.packageName.trim()
      : null
  const rec = findRec(name)
  if (rec === null) return { ok: false, message: '未在配置中找到该服务器' }
  if (upgrading.has(name)) return { ok: false, message: '该服务器正在升级中' }
  upgrading.add(name)
  try {
    if (rec.transport === 'stdio') {
      const pip = detectPip(rec.command)
      if (pip !== null) {
        const pkg = pkgOverride !== null ? pkgOverride : pip.packageName

        // Windows: a running stdio server locks its own .exe image, and pip's
        // uninstall step then dies with "Access is denied". Worse, the harness
        // mcp-client would immediately RESPAWN the old exe after we kill it
        // (reconnect policy) and re-lock the file mid-upgrade. So: stop every
        // process running from that exact path, then park the exe aside — the
        // respawn attempts fail harmlessly (file absent) until pip has placed
        // the new version, and the next reconnect spawns the NEW binary.
        const exePath = normPath(rec.command)
        const parkedPath = exePath + '.mcphub-parked'
        let killed = 0
        let parked = false
        try {
          if (existsSync(parkedPath)) rmSync(parkedPath, { force: true })
        } catch {}
        if (IS_WINDOWS) {
          const exeWin = exePath.replace(/\//g, '\\').toLowerCase()
          const ps =
            "$hits = Get-Process | Where-Object { $_.Path -and $_.Path.ToLower() -eq '" +
            exeWin.replace(/'/g, "''") +
            "' }; $hits | ForEach-Object { Write-Output $_.Id }; $hits | Stop-Process -Force -ErrorAction SilentlyContinue"
          const kr = await run(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-Command', ps],
            30_000,
          )
          killed = (kr.out.match(/\d+/g) || []).length
        } else {
          // POSIX: no image lock, but stop the server anyway so the old code
          // unloads before pip swaps it (a running server would keep serving
          // the old version until restart regardless).
          const kr = await run(
            'sh',
            ['-c', 'pkill -f ' + shellQuote(exePath) + ' 2>/dev/null; pkill -f ' + shellQuote(exePath) + '; true'],
            15_000,
          )
          killed = 0 // pkill gives no per-pid output; count is unknown here
        }
        try {
          if (existsSync(exePath)) {
            renameSync(exePath, parkedPath)
            parked = true
          }
        } catch {}

        const before = await pipMap(pip.pythonExe, true)
        const fromVersion = before !== null ? before.get(pep503(pkg)) || null : null
        const r = await run(
          normPath(pip.pythonExe),
          ['-m', 'pip', 'install', '--upgrade', pkg, '--disable-pip-version-check', '--no-input'],
          PIP_UPGRADE_TIMEOUT_MS,
        )
        // Un-park: if pip recreated the exe, drop the parked old copy; if pip
        // failed and left no exe behind, restore the parked one so the server
        // can still start.
        let restoreNote = ''
        try {
          if (parked && existsSync(parkedPath)) {
            if (existsSync(exePath)) rmSync(parkedPath, { force: true })
            else {
              renameSync(parkedPath, exePath)
              restoreNote = '（旧版 exe 已还原）'
            }
          }
        } catch {}
        const after = await pipMap(pip.pythonExe, true)
        const toVersion = after !== null ? after.get(pep503(pkg)) || null : null
        const tail = (r.out + '\n' + r.err).trim().slice(-3000)
        const ok = r.code === 0
        return {
          ok,
          kind: 'pip',
          packageName: pkg,
          fromVersion,
          toVersion,
          outputTail: tail,
          restartRequired: true,
          message: ok
            ? 'pip 升级完成' +
              (toVersion !== null ? '，当前版本 ' + toVersion : '') +
              (killed > 0 ? '；已停止占用进程 ' + killed + ' 个' : '') +
              '。服务器会自动重连新版本，若一分钟后工具仍不可用请重启 DSH'
            : 'pip 升级失败（退出码 ' + r.code + '）' + restoreNote,
        }
      }
      const npm = detectNpm(rec)
      if (npm !== null) {
        const cacheRoot = await npmCacheDir()
        const cacheDir = join(cacheRoot, '_npx')
        let cleared = false
        try {
          if (existsSync(cacheDir)) {
            rmSync(cacheDir, { recursive: true, force: true })
            cleared = true
          }
        } catch {}
        npmRefreshed.add(name)
        return {
          ok: true,
          kind: 'npm',
          packageName: npm.packageName,
          outputTail: '',
          restartRequired: true,
          message:
            'npx 缓存已' +
            (cleared ? '清空' : '确认为空') +
            '，重启 DSH 后将拉取 ' +
            npm.packageName +
            ' 最新版',
        }
      }
    }
    return { ok: false, message: '该服务器不是 pip / npx 管理的本地安装，请手动升级' }
  } finally {
    upgrading.delete(name)
  }
}

function yamlScalar(v) {
  return "'" + String(v).replace(/'/g, "''") + "'"
}

function escapeReg(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function epCreate(_ctx, args) {
  if (args === null || typeof args !== 'object') return { ok: false, error: '参数缺失' }
  const serverName = String(args.serverName == null ? '' : args.serverName).trim()
  const transport = String(args.transport == null ? '' : args.transport)
  if (!SERVER_NAME_RE.test(serverName)) {
    return { ok: false, error: 'serverName 只能包含字母、数字、下划线、连字符，长度 1–32' }
  }
  if (transport !== 'stdio' && transport !== 'streamable-http') {
    return { ok: false, error: 'transport 必须是 stdio 或 streamable-http' }
  }
  const noNL = (v) => !/[\r\n]/.test(String(v))
  let block = ''
  if (transport === 'streamable-http') {
    const url = String(args.url == null ? '' : args.url).trim()
    if (!/^https?:\/\//.test(url)) return { ok: false, error: 'url 必须以 http:// 或 https:// 开头' }
    const headers = args.headers && typeof args.headers === 'object' ? args.headers : {}
    const hk = Object.keys(headers).filter((k) => String(k).trim() !== '')
    for (const k of hk) if (!noNL(k) || !noNL(headers[k])) return { ok: false, error: 'headers 含换行符，已拒绝' }
    block += '    url: ' + yamlScalar(url) + '\n'
    if (hk.length > 0) {
      block += '    headers:\n'
      for (const k of hk) block += '      ' + yamlScalar(String(k).trim()) + ': ' + yamlScalar(headers[k]) + '\n'
    }
  } else {
    const command = String(args.command == null ? '' : args.command).trim()
    if (command === '') return { ok: false, error: 'stdio 传输需要 command' }
    if (!noNL(command)) return { ok: false, error: 'command 含换行符，已拒绝' }
    block += '    command: ' + yamlScalar(command) + '\n'
    const argList = Array.isArray(args.args)
      ? args.args.map((a) => String(a == null ? '' : a).trim()).filter((a) => a !== '')
      : []
    if (argList.length > 0) {
      block += '    args:\n'
      for (const a of argList) {
        if (!noNL(a)) return { ok: false, error: 'args 含换行符，已拒绝' }
        block += '      - ' + yamlScalar(a) + '\n'
      }
    }
    const env = args.env && typeof args.env === 'object' ? args.env : {}
    const ek = Object.keys(env).filter((k) => String(k).trim() !== '')
    if (ek.length > 0) {
      block += '    env:\n'
      for (const k of ek) {
        if (!noNL(env[k])) return { ok: false, error: 'env 含换行符，已拒绝' }
        block += '      ' + yamlScalar(String(k).trim()) + ': ' + yamlScalar(env[k]) + '\n'
      }
    }
  }
  const profiles = loadProfiles()
  const allNames = new Set()
  for (const p of profiles) for (const r of p.servers) allNames.add(r.serverName)
  if (allNames.has(serverName)) return { ok: false, error: 'serverName "' + serverName + '" 已存在' }
  let target = null
  if (typeof args.profile === 'string' && args.profile !== '') {
    for (const p of profiles) if (p.name === args.profile) target = p
  }
  if (target === null) target = profiles.length > 0 ? profiles[0] : null
  let entryId = 'mcp-' + serverName
  if (target !== null) {
    let n = 2
    const idTaken = (t) =>
      new RegExp(
        '(^|\\n)\\s*-\\s*id:\\s*(' + escapeReg(t) + '|' + escapeReg(yamlScalar(t)) + ')\\s*(\\n|$)',
      ).test(target.text == null ? '' : target.text)
    while (idTaken(entryId)) {
      entryId = 'mcp-' + serverName + '-' + n
      n++
    }
  }
  const snippet =
    '# Added via MCP panel: ' + serverName + ' (' + transport + ')\n' +
    '- id: ' + yamlScalar(entryId) + '\n' +
    "  name: '@deepseek-ai/dsh-mcp-client'\n" +
    '  config:\n' +
    '    serverName: ' + yamlScalar(serverName) + '\n' +
    '    transport: ' + yamlScalar(transport) + '\n' +
    block
  if (target === null) {
    return { ok: false, error: '未找到任何 DSH profile 目录（检查 $DSH_HOME）', snippet }
  }
  const existing = target.text == null ? '' : target.text
  const content =
    existing.trim() === '' || existing.trim() === '[]'
      ? snippet
      : existing.replace(/\s+$/, '\n') + '\n' + snippet
  try {
    writeFileSync(target.path, content, 'utf8')
  } catch (e) {
    return { ok: false, error: '写入失败：' + errMsg(e), path: normPath(target.path), snippet }
  }
  profilesDirty = true
  return {
    ok: true,
    path: normPath(target.path),
    profile: target.name,
    snippet,
    restartRequired: true,
    message: '已写入 ' + normPath(target.path) + '\n重启 DSH 后新服务器生效',
  }
}

/* ------------------------------------------------------------------ */
/* Plugin entry                                                        */
/* ------------------------------------------------------------------ */

export function apply(ctx) {
  ctx.on('tools/change', () => {
    liveCache = null
  })

  ctx.inject(['connection'], (web) => {
    if (web.connection === undefined) return
    web.connection.rpc.handle(
      CHANNEL,
      async (endpoint, payload) => {
        try {
          switch (endpoint) {
            case 'list':
              return await epList(ctx)
            case 'check-upgrades':
              return await epCheckUpgrades(ctx, payload)
            case 'probe':
              return await epProbe(ctx, payload)
            case 'upgrade':
              return await epUpgrade(ctx, payload)
            case 'set-disabled':
              return await epSetDisabled(ctx, payload)
            case 'delete':
              return await epDelete(ctx, payload)
            case 'create':
              return await epCreate(ctx, payload)
            default:
              return { ok: false, error: '未知 endpoint：' + endpoint }
          }
        } catch (e) {
          return { ok: false, error: errMsg(e) }
        }
      },
      { authority: 'loopback' },
    )
  })

  if (ctx.logger && typeof ctx.logger.info === 'function') ctx.logger.info('dsh-mcphub host half active')
}
