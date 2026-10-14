#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir, stat, open, chmod, cp, rename, unlink } from 'node:fs/promises';
import { createReadStream, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseFile } from 'music-metadata';

const HELP = `HanoLab CLI 0.2.2 (Node.js 20+; API access currently requires Starter+)
  hanolab auth login                         Hidden local terminal input
  hanolab auth login --stdin                 Read key from a private pipe
  hanolab auth logout                        Remove locally saved key
  hanolab credits                            Check credit balance
  hanolab generate --prompt TEXT --max-credits N [--tier studio] [--lyrics-file FILE]
  hanolab clone --file FILE --name NAME --consent --max-credits N [--kind flash|pro]
  hanolab separate --file FILE --max-credits N [--mode 2stem|4stem|6stem]
  hanolab master --file FILE --reference FILE --max-credits N
  hanolab voices                             List your saved voices
  hanolab estimate --file FILE                Measure duration; get credit estimate
  hanolab upload --file FILE                  Upload only (returns owned object key)
  hanolab convert --file FILE --voice ID --max-credits N [--full-song]
                  [--job RECEIPT] [--wait] [--output FILE] [--timeout SECONDS]
  hanolab resume --job RECEIPT [--wait] [--output FILE]
  hanolab task --task ID
  hanolab wait --task ID [--timeout SECONDS]
  hanolab download --task ID --output FILE [--index N]
  hanolab skill install [--path DIRECTORY]    Default: ~/.codex/skills/hanolab

All results are JSON. A conversion saves a private receipt before submission.
Resume the receipt after interruption; don't submit a fresh paid task.
Downloads never overwrite files. MP4 input produces audio output.
Credentials: HANOLAB_API_KEY or ~/.config/hanolab/config.json (mode 0600).
Optional: HANOLAB_CONFIG_DIR, HANOLAB_API_URL (default https://hanolab.com).
No API key command-line argument. No automatic purchases or subscription changes.
`;

export class CliError extends Error {
  constructor(code, details = {}) { super(code); this.details = details; }
}
const output = value => process.stdout.write(JSON.stringify(value) + '\n');
const configDir = () => resolve(process.env.HANOLAB_CONFIG_DIR || join(homedir(), '.config', 'hanolab'));
const configPath = () => join(configDir(), 'config.json');
const fail = (code, details) => { throw new CliError(code, details); };

export function apiOrigin() {
  let url;
  try { url = new URL(process.env.HANOLAB_API_URL || 'https://hanolab.com'); } catch { fail('invalid_api_url'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) fail('invalid_api_url');
  return url.origin;
}
async function privateDir(dir) { await mkdir(dir, { recursive: true, mode: 0o700 }); await chmod(dir, 0o700); }
async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')); }
async function key() {
  let value = process.env.HANOLAB_API_KEY;
  if (!value) { try { value = (await readJson(configPath())).api_key; } catch { fail('api_key_missing', { action: 'Run hanolab auth login privately; create your key at https://hanolab.com/account' }); } }
  if (typeof value !== 'string' || !/^hnl_live_[a-zA-Z0-9_-]{24,}$/.test(value)) fail('invalid_api_key');
  return value;
}
async function api(path, body, extra = {}) {
  const token = await key();
  let response;
  try {
    response = await fetch(apiOrigin() + '/api/v1/' + path, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, 'X-Hanolab-Client': 'cli/0.2.2', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(120000),
    });
  } catch { fail('api_connection_uncertain'); }
  let data;
  try { data = await response.json(); } catch { fail('invalid_api_response', { status: response.status }); }
  if (!response.ok) {
    // Never echo arbitrary upstream messages, signed URLs, credentials or bodies.
    const code = typeof data.error === 'string' && /^[a-z][a-z0-9_]{0,80}$/.test(data.error) ? data.error : `http_${response.status}`;
    fail(code, { status: response.status, ...(Number.isFinite(data.required) ? { required_credits: data.required } : {}), ...(typeof data.required_plan === 'string' ? { required_plan: data.required_plan } : {}) });
  }
  return data;
}

const TYPES = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.mp4': 'video/mp4', '.aiff': 'audio/aiff', '.aif': 'audio/aiff', '.webm': 'audio/webm' };
async function media(file) {
  if (!file) fail('file_required');
  const path = resolve(file), type = TYPES[extname(path).toLowerCase()];
  if (!type) fail('unsupported_audio_extension');
  let info;
  try { info = await stat(path); } catch { fail('input_file_not_found'); }
  if (!info.isFile() || info.size <= 0 || info.size > 100 * 1024 * 1024) fail('invalid_file_size', { max_bytes: 100 * 1024 * 1024 });
  let duration;
  try { duration = (await parseFile(path, { duration: true })).format.duration; } catch { fail('cannot_measure_audio_duration'); }
  if (!Number.isFinite(duration) || duration <= 0) fail('cannot_measure_audio_duration');
  return { path, type, size: info.size, duration };
}
async function estimate(info) { return api('agent/estimate', { duration: info.duration }); }
export function safeTransferUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail('invalid_transfer_url'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && apiOrigin() === url.origin;
  // AWS signing uses virtual-hosted bucket URLs; both forms belong to our R2 account.
  const owned = new Set(['cdn.hanolab.com', 'cdn.mureka.ai', 'f3d9c542b4de2bca428d415c10a5eec6.r2.cloudflarestorage.com', 'soundforge.f3d9c542b4de2bca428d415c10a5eec6.r2.cloudflarestorage.com']).has(url.hostname);
  if (url.username || url.password || (!local && (url.protocol !== 'https:' || !owned))) fail('untrusted_transfer_url');
  return url.href;
}
async function upload(info) {
  const signed = await api('upload', { filename: basename(info.path), content_type: info.type, size: info.size });
  let response;
  try {
    // Deliberately omit Authorization when talking to storage.
    response = await fetch(safeTransferUrl(signed.upload_url), { method: 'PUT', redirect: 'error', headers: { 'Content-Type': info.type, 'Content-Length': String(info.size) }, body: createReadStream(info.path), duplex: 'half', signal: AbortSignal.timeout(300000) });
  } catch (err) { if (err instanceof CliError) throw err; fail('upload_failed'); }
  if (!response.ok) fail('upload_failed', { status: response.status });
  const complete = await api('upload/complete', { key: signed.key });
  // Submit stable owned key, not an expiring signed URL.
  return { key: signed.key, audio_sha256: complete.audio_sha256 ?? null, duration: info.duration };
}
function viewTask(task) {
  return { task_id: task.id, status: task.status, progress: task.progress, credits: task.params?.credit_cost ?? null, result_count: task.output_urls?.length ?? 0, artifacts_pending: !!task.artifacts_pending };
}
function taskId(id) { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '')) fail('valid_task_id_required'); return id; }
async function getTask(id) { return api('tasks/' + taskId(id)); }
async function waitTask(id, seconds = '900') {
  const timeout = Number(seconds);
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 3600) fail('invalid_timeout');
  const end = Date.now() + timeout * 1000;
  while (true) {
    const task = await getTask(id);
    if (task.status === 'failed') fail('task_failed', viewTask(task));
    if (task.status === 'completed' && !task.artifacts_pending && task.output_urls?.length) return task;
    if (Date.now() >= end) fail('wait_timeout', viewTask(task));
    await new Promise(r => setTimeout(r, 3000));
  }
}
export async function download(task, destination, index = '0') {
  if (!destination) fail('output_required');
  if (task.status !== 'completed' || task.artifacts_pending) fail('result_not_ready', viewTask(task));
  const n = Number(index);
  if (!Number.isSafeInteger(n) || n < 0 || !task.output_urls?.[n]) fail('invalid_result_index');
  const path = resolve(destination);
  // Exclusive creation prevents overwriting even with concurrent downloads.
  let handle;
  try { handle = await open(path, 'wx', 0o600); } catch (err) { fail(err.code === 'EEXIST' ? 'output_exists' : 'cannot_create_output'); }
  try {
    const response = await fetch(safeTransferUrl(task.output_urls[n]), { redirect: 'error', signal: AbortSignal.timeout(300000) });
    if (!response.ok || !response.body) fail('download_failed', { status: response.status });
    await pipeline(Readable.fromWeb(response.body), handle.createWriteStream());
    if ((await stat(path)).size === 0) fail('empty_download');
    return { output: path, bytes: (await stat(path)).size };
  } catch (err) {
    await handle.close().catch(() => {});
    const { unlink } = await import('node:fs/promises'); await unlink(path).catch(() => {});
    if (err instanceof CliError) throw err; fail('download_failed');
  }
}
async function saveJob(path, job, initial = false) {
  const text = JSON.stringify(job, null, 2) + '\n';
  if (initial) { await writeFile(path, text, { mode: 0o600, flag: 'wx' }); return; }
  const temporary = path + '.' + randomUUID() + '.tmp';
  try { await writeFile(temporary, text, { mode: 0o600, flag: 'wx' }); await rename(temporary, path); }
  finally { await unlink(temporary).catch(() => {}); }
}
async function runJob(path, job, opts) {
  if (job.version !== 1 || job.origin !== apiOrigin() || !/^[a-zA-Z0-9_-]{16,128}$/.test(job.request_id || '') || !['voice/convert', 'voice/convert-flash', 'voice/flash-clone', 'train/voice-clone', 'music/generate', 'audio/separate', 'audio/master'].includes(job.endpoint) || !Number.isSafeInteger(job.max_credits) || job.max_credits < 1) fail('invalid_job_receipt');
  let task;
  try {
    if (job.task_id) task = await getTask(job.task_id);
    else {
      // Same persisted request on explicit resume: DB uniqueness precedes debit.
      task = await api(job.endpoint, job.body, { 'Idempotency-Key': job.request_id, 'X-Hanolab-Max-Credits': String(job.max_credits) });
      job.task_id = task.id; await saveJob(path, job);
    }
    if (task.status === 'failed') fail('task_failed', viewTask(task));
    if (opts.wait || opts.output) task = await waitTask(task.id, opts.timeout);
    let voiceResult = {};
    if (['voice/flash-clone', 'train/voice-clone'].includes(job.endpoint) && task.status === 'completed') {
      const voices = await api('voice/models'); const voice = voices.items.find(v => v.source_task_id === task.id);
      voiceResult = { voice_model_id: voice?.id ?? null, voice_ready: !!voice?.model_url };
    }
    return { ...viewTask(task), ...voiceResult, job: path, ...(opts.output ? await download(task, opts.output) : {}) };
  } catch (err) { if (err instanceof CliError) err.details = { ...err.details, job: path, ...(job.task_id ? { task_id: job.task_id } : {}), action: 'Resume this receipt; do not create a new paid task.' }; throw err; }
}
async function hiddenKey() {
  if (!process.stdin.isTTY) fail('interactive_terminal_required', { action: 'Use --stdin with a private credential pipe.' });
  process.stderr.write('HanoLab API key (hidden): ');
  const wasRaw = process.stdin.isRaw; process.stdin.setRawMode(true); process.stdin.resume();
  return new Promise((accept, reject) => {
    let value = '';
    function finish(error) { process.stdin.off('data', consume); process.stdin.setRawMode(wasRaw); process.stdin.pause(); process.stderr.write('\n'); error ? reject(error) : accept(value.trim()); }
    function consume(chunk) {
      for (const char of chunk.toString()) {
        if (char === '\u0003') return finish(new CliError('login_cancelled'));
        if (char === '\r' || char === '\n') return finish();
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char.charCodeAt(0) >= 32) value += char;
      }
    }
    process.stdin.on('data', consume);
  });
}

export async function main(args = process.argv.slice(2)) {
  const { values: opts, positionals: pos } = parseArgs({ args, allowPositionals: true, options: {
    prompt: { type: 'string' }, tier: { type: 'string' }, 'lyrics-file': { type: 'string' }, name: { type: 'string' }, kind: { type: 'string' }, consent: { type: 'boolean' }, 'training-file': { type: 'string', multiple: true }, mode: { type: 'string' }, reference: { type: 'string' }, operation: { type: 'string' }, duration: { type: 'string' }, file: { type: 'string' }, voice: { type: 'string' }, 'max-credits': { type: 'string' }, job: { type: 'string' }, output: { type: 'string' }, task: { type: 'string' }, timeout: { type: 'string' }, index: { type: 'string' }, path: { type: 'string' }, wait: { type: 'boolean' }, 'full-song': { type: 'boolean' }, stdin: { type: 'boolean' }, help: { type: 'boolean' },
  }});
  const [command, subcommand] = pos;
  if (!command || command === 'help' || opts.help) { process.stdout.write(HELP); return; }
  if (command === 'auth' && subcommand === 'login') {
    let value;
    if (opts.stdin) { const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk); value = Buffer.concat(chunks).toString().trim(); }
    else value = await hiddenKey();
    if (!/^hnl_live_[a-zA-Z0-9_-]{24,}$/.test(value)) fail('invalid_api_key');
    await privateDir(configDir()); await writeFile(configPath(), JSON.stringify({ api_key: value }) + '\n', { mode: 0o600 }); await chmod(configPath(), 0o600);
    output({ authenticated: true, config: configPath() }); return;
  }
  if (command === 'auth' && subcommand === 'logout') { const { unlink } = await import('node:fs/promises'); await unlink(configPath()).catch(err => { if (err.code !== 'ENOENT') throw err; }); output({ saved_key_removed: true, environment_key_still_set: !!process.env.HANOLAB_API_KEY }); return; }
  if (command === 'skill' && subcommand === 'install') {
    const target = resolve(opts.path || join(homedir(), '.codex', 'skills', 'hanolab'));
    await mkdir(dirname(target), { recursive: true });
    // Refuse overwriting an unrelated or customized skill.
    try { await stat(target); fail('skill_destination_exists', { path: target }); } catch (err) { if (err.code !== 'ENOENT') throw err; }
    await cp(fileURLToPath(new URL('../skill', import.meta.url)), target, { recursive: true, errorOnExist: true, force: false });
    output({ installed: true, path: target, action: 'Start a new assistant session to discover the skill.' }); return;
  }
  if (command === 'credits') { output(await api('profile/credits')); return; }
  if (command === 'voices') {
    const data = await api('voice/models');
    output({ items: data.items.map(v => ({ id: v.id, name: v.name, source_task_id: v.source_task_id ?? null, kind: v.model_type === 'flash' ? 'flash' : 'pro', ready: !!v.model_url })) }); return;
  }
  if (command === 'estimate' || command === 'upload') {
    if (command === 'estimate' && opts.operation && opts.operation !== 'convert') { output(await api('agent/estimate', { operation: opts.operation, tier: opts.tier, kind: opts.kind, mode: opts.mode, duration: Number(opts.duration || 30) })); return; }
    const info = await media(opts.file); output(command === 'estimate' ? await estimate(info) : await upload(info)); return;
  }
  if (['generate', 'clone', 'separate', 'master'].includes(command)) {
    const budget = Number(opts['max-credits']);
    if (!Number.isSafeInteger(budget) || budget < 1) fail('explicit_credit_budget_required');
    if (command === 'clone' && !opts.consent) fail('voice_consent_required');
    if (command === 'clone' && opts.output) fail('clone_has_voice_model_not_audio');
    if (opts.output) { try { await stat(resolve(opts.output)); fail('output_exists'); } catch (err) { if (err.code !== 'ENOENT') throw err; } }
    const tier = opts.tier || 'studio', kind = opts.kind || 'flash', mode = opts.mode || '2stem';
    let body, infos = [];
    if (command === 'generate') {
      if (!opts.prompt?.trim()) fail('prompt_required');
      const duration = Number(opts.duration || 30);
      if (!Number.isFinite(duration) || duration < 1 || duration > 300) fail('invalid_duration');
      if (!['draft', 'studio', 'signature', 'maestro'].includes(tier)) fail('invalid_music_tier');
      if (tier === 'maestro' && opts['lyrics-file']) fail('maestro_is_instrumental');
      body = { prompt: opts.prompt, tier, duration, ...(opts['lyrics-file'] ? { lyrics: await readFile(resolve(opts['lyrics-file']), 'utf8') } : {}) };
    } else {
      if (command === 'clone' && (!opts.name?.trim() || !['flash', 'pro'].includes(kind))) fail('clone_name_and_kind_required');
      if (command === 'separate' && !['2stem', '4stem', '6stem'].includes(mode)) fail('invalid_stem_mode');
      infos = await Promise.all([opts.file, ...(command === 'clone' && kind === 'pro' ? opts['training-file'] || [] : []), ...(command === 'master' ? [opts.reference] : [])].map(media));
      if (infos.some(info => info.duration > 900)) fail('audio_too_long');
    }
    const cost = await api('agent/estimate', { operation: command, tier, kind, mode, duration: body?.duration });
    if (!Number.isSafeInteger(cost.credits) || cost.credits > budget) fail('credit_budget_exceeded', { estimated_credits: cost.credits });
    const jobsDir = join(configDir(), 'jobs'); await privateDir(jobsDir);
    const path = resolve(opts.job || join(jobsDir, randomUUID() + '.json'));
    const endpoint = command === 'generate' ? 'music/generate' : command === 'clone' ? (kind === 'pro' ? 'train/voice-clone' : 'voice/flash-clone') : 'audio/' + command;
    const job = { version: 1, origin: apiOrigin(), request_id: randomUUID(), endpoint, max_credits: budget, estimated_credits: cost.credits };
    await saveJob(path, job, true);
    try {
      const uploads = [];
      for (const info of infos) uploads.push(await upload(info));
      job.body = body || (command === 'clone' ? { name: opts.name, consent: true, ...(kind === 'pro' ? { input_urls: uploads.map(u => u.key) } : { input_url: uploads[0].key }) } : command === 'master' ? { target_url: uploads[0].key, reference_url: uploads[1].key } : { input_url: uploads[0].key, mode });
      await saveJob(path, job); output(await runJob(path, job, opts));
    } catch (err) { if (err instanceof CliError) err.details = { ...err.details, job: path }; throw err; }
    return;
  }
  if (command === 'convert') {
    const budget = Number(opts['max-credits']);
    if (!Number.isSafeInteger(budget) || budget < 1) fail('explicit_credit_budget_required');
    taskId(opts.voice); // Voices also use UUID IDs.
    if (opts.output) { try { await stat(resolve(opts.output)); fail('output_exists'); } catch (err) { if (err.code !== 'ENOENT') throw err; } }
    const info = await media(opts.file), cost = await estimate(info);
    if (!Number.isSafeInteger(cost.credits) || cost.credits > budget) fail('credit_budget_exceeded', { estimated_credits: cost.credits });
    const voices = await api('voice/models'), voice = voices.items.find(v => v.id === opts.voice);
    if (!voice?.model_url) fail('own_ready_voice_required');
    if (!['flash', 'rvc'].includes(voice.model_type)) fail('unsupported_voice_kind');
    const jobsDir = join(configDir(), 'jobs'); await privateDir(jobsDir);
    const path = resolve(opts.job || join(jobsDir, randomUUID() + '.json'));
    // Reserve path before upload; concurrent commands cannot share a receipt.
    const job = { version: 1, origin: apiOrigin(), request_id: randomUUID(), endpoint: voice.model_type === 'flash' ? 'voice/convert-flash' : 'voice/convert', max_credits: budget, estimated_credits: cost.credits };
    await saveJob(path, job, true);
    try {
      const uploaded = await upload(info);
      job.body = { input_url: uploaded.key, audio_sha256: uploaded.audio_sha256, duration: info.duration, voice_model_id: voice.id, ...(voice.model_type === 'rvc' ? { full_song: !!opts['full-song'] } : {}) };
      await saveJob(path, job); output(await runJob(path, job, opts));
    } catch (err) { if (err instanceof CliError) err.details = { ...err.details, job: path }; throw err; } return;
  }
  if (command === 'resume') {
    if (!opts.job) fail('job_required'); const path = resolve(opts.job), job = await readJson(path);
    if (!job.body) fail('upload_not_completed', { action: 'This receipt has no submitted conversion. Start again with a new receipt.' });
    output(await runJob(path, job, opts)); return;
  }
  if (command === 'task' || command === 'wait' || command === 'download') {
    const task = command === 'wait' ? await waitTask(opts.task, opts.timeout) : await getTask(opts.task);
    output({ ...viewTask(task), ...(command === 'download' ? await download(task, opts.output, opts.index) : {}) }); return;
  }
  fail('unknown_command', { action: 'Run hanolab help.' });
}

let isEntry = false;
try { isEntry = !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch {}
if (isEntry) {
  main().catch(err => { output({ error: err instanceof CliError ? err.message : 'cli_failed', ...(err instanceof CliError ? err.details : {}) }); process.exitCode = 1; });
}
