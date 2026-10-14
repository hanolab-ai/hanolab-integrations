# HanoLab CLI + skill

Use your existing HanoLab voices from a terminal or an AI assistant with local file access. Requires Node.js 20+ and a HanoLab API key; API access currently requires Starter, Creator or Pro. Music generation, Flash/Pro cloning, stem separation, mastering and credit balance are available. MP4 input yields converted audio, not a reassembled video.

Install the release tarball:

```sh
npm install -g https://hanolab.com/downloads/hanolab-cli-0.2.2.tgz
hanolab auth login
hanolab skill install
```

Create your key at <https://hanolab.com/account> and enter it at the hidden prompt. The CLI stores it in `~/.config/hanolab/config.json` with mode 0600; never put keys in prompts, command arguments or project files. `HANOLAB_API_KEY` can instead be injected by your credential manager. `hanolab auth logout` removes the saved key; revoke it from the account page if needed. CLI usage does not purchase or change a plan.

The default skill destination is `~/.codex/skills/hanolab`. Choose a skill folder with `hanolab skill install --path /your/client/skills/hanolab`. Start a new assistant session after installation. The CLI works independently of skills.

```sh
hanolab voices
hanolab estimate --file /absolute/song.wav
hanolab convert --file /absolute/song.wav --voice VOICE_UUID --max-credits 4 \
  --full-song --wait --output /absolute/converted.wav
```

Outputs are JSON. Every paid command uploads once and persists a private receipt; without `--wait` it returns the task ID immediately. `--max-credits` is the authorized budget and is checked locally and by the server before debit. Both Flash and Pro conversions currently cost one credit per rounded-up minute. Estimates use actual measured file duration and current server pricing. Use `--full-song` for Pro conversion with accompaniment; Flash handles backing audio internally.

After interruption, use the printed receipt path:

```sh
hanolab resume --job /absolute/receipt.json --wait --output /absolute/result.wav
hanolab task --task TASK_UUID
hanolab wait --task TASK_UUID --timeout 900
hanolab download --task TASK_UUID --output /absolute/result.wav
```

Replaying the same receipt uses the original idempotency key and cannot create another billed task. Never start a new `convert` to recover an uncertain submission. A failed task remains failed; a new paid retry requires a new user decision. A receipt without a completed upload has no submitted conversion and can be replaced with a new receipt. Downloads refuse to overwrite files. `--index` selects among available outputs (default 0); the first is the mixed result.

Supported input extensions: WAV, MP3, FLAC, OGG, Opus, M4A, AAC, MP4, AIFF and audio WebM, up to 100 MiB. Duration parsing fails closed if the audio cannot be measured. Transfers stream from disk and never forward your API key to storage/CDN. Keys and signed URLs are excluded from normal CLI output and error messages.

Development: `npm install` at the repository root, then `node packages/cli/bin/hanolab.mjs help`. Run `npm test --workspace @hanolab/cli`. Package with `npm pack --workspace @hanolab/cli`. `HANOLAB_CONFIG_DIR` isolates credentials/receipts for testing; `HANOLAB_API_URL` supports an explicitly configured HTTPS server or a loopback HTTP development server. Do not point production credentials at an untrusted server.

Run `hanolab help` for generation, cloning, separation and mastering commands. Use `hanolab estimate --operation generate --tier studio`, `--operation clone --kind pro`, `--operation separate --mode 6stem` or `--operation master` before submitting. Mastering requires `--reference`; cloning requires voice permission and `--consent`. Pro cloning accepts repeated `--training-file` arguments. Clone completion returns a voice model ID rather than audio. No MCP server, deletion, cancellation or payment commands are included.
