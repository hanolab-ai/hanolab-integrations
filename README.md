# HanoLab integrations

Voice conversion for recorded speech and singing, with private saved voices, credit quotes, and resumable results.

[HanoLab](https://hanolab.com/) · [Remote MCP guide](https://hanolab.com/docs/mcp) · [CLI guide](https://hanolab.com/docs/cli) · [Privacy](https://hanolab.com/privacy) · [Support](mailto:support@hanolab.com)

This repository distributes public connection metadata and two agent skills. The hosted service implementation is maintained separately.

## Remote MCP

Add **https://hanolab.com/mcp** as a Streamable HTTP MCP server in a client that supports remote MCP and OAuth. Complete the HanoLab sign-in and consent flow. Reading a skill or copying a configuration does not connect your account or install tools.

The remote MCP currently converts uploaded recordings using voices already saved in your account. It can inspect credits and voices, create a private upload link, quote a conversion, submit an approved conversion, and recover its status or output. It does not clone a new voice or expose purchases or subscription changes.

The JSON shape varies by client. `mcp.json` is an HTTP-style example; use the host's own remote-server setup instructions when necessary.

Example requests after connecting:

- "Show my saved voices and credits. Do not start a conversion."
- "Give me a private upload link for my recording, then quote conversion using my saved voice. Wait for my budget confirmation."
- "Recover the conversion we already submitted and return its result. Do not start a new paid task."

## Agent skills

Install both public skills using the [Skills CLI](https://skills.sh/docs):

```sh
npx skills add obrr-hhx/hanolab-integrations
```

Or select one:

```sh
npx skills add obrr-hhx/hanolab-integrations --skill hanolab-mcp
npx skills add obrr-hhx/hanolab-integrations --skill hanolab
```

- **hanolab-mcp**: the connected remote MCP workflow, private browser uploads, exact quotes, confirmed credit budgets, and resuming existing tasks.
- **hanolab**: local terminal workflow for music generation, voice cloning/conversion, stem separation, mastering, and resumable downloads. Requires a separately installed CLI and local file access.

## Local CLI

Requires Node.js 20+ and a HanoLab API key. Install the current release and authenticate privately:

```sh
npm install -g https://hanolab.com/downloads/hanolab-cli-0.2.2.tgz
hanolab auth login
hanolab help
```

Create the key on the [account page](https://hanolab.com/account) and enter it at the hidden terminal prompt. Do not paste credentials into a chat or a project file.

## Account access and cost

MCP and API access currently use an existing Starter, Creator, or Pro account. Audio processing consumes the account's credits; checking credits, saved voices, and a quote does not execute a conversion. Follow the server's measured quote and the user's explicitly authorized maximum budget. A successful connection does not purchase a plan or supply unlimited processing.

Uploads through remote MCP support audio or MP4 soundtracks up to 15 minutes and 100 MB; MP4 conversion returns audio rather than a replaced video soundtrack. Only use voices and audio you own or have permission to use. Results are shared with the connected AI host as described in the [privacy policy](https://hanolab.com/privacy).

## Registry metadata

`server.json` describes the hosted remote endpoint for the official MCP Registry. A source repository or configuration file by itself does not indicate registry approval, third-party listing, or compatibility with every AI host.

## Updating

Keep these public skills aligned with HanoLab's documented tools and current CLI release. Publish a new registry metadata version when its public fields change. Do not add secrets, review-account credentials, signed private audio links, or backend source to this repository.
