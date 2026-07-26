# Air-gapped installation

Running EvoPlatform and Ask AI on a network with no internet connection at
all — nothing outbound, nothing inbound, everything transferred by hand.

---

## Read this before you begin

**This works, and it is a manual procedure.** Every component runs offline by
design, and no part of the system needs to reach the internet to do its job.
There is no hidden dependency that will surface in month three.

What does not exist yet is the tooling that would make this comfortable:

| | Status |
|---|---|
| Running fully offline | **Supported** — that is what this guide does |
| A signed, versioned install bundle | **Not built.** You assemble the transfer yourself |
| An offline update mechanism | **Not built.** Updating repeats this procedure |
| A one-command diagnostic export for support | **Not built.** Collect logs manually |
| Licence or entitlement checks | None. Nothing calls home to validate anything |

If your environment expects a vendor-signed bundle and a documented update
channel, that gap is real and worth raising before you commit. If you would
rather assemble the transfer yourself and control exactly what crosses the
boundary — which is the common preference in regulated environments — this
procedure is straightforward.

**You must run a local AI model.** Cloud providers are not reachable, so
re-read the sizing table in [Adding Ask AI](02-adding-ask-ai.md#if-you-are-considering-a-local-model-read-this-before-choosing)
and confirm your hardware before starting. This is the most common reason an
air-gapped install stalls.

---

## What you need

**A connected machine** to assemble everything. Same CPU architecture as the
target — images built for x86 will not run on ARM. This bites in a specific
way: an Apple Silicon Mac builds ARM images by default, so assembling there for
an x86 server needs `docker build --platform linux/amd64`.

The commands below work in PowerShell, macOS Terminal, and a Linux shell
unchanged.

**Transfer media** approved by your security policy. The complete transfer is
typically 10–30 GB, dominated by the AI model.

**The target server**, with Docker and Docker Compose already installed
through whatever channel your organisation uses for system packages. Docker
itself is out of scope here.

---

## Stage 1: Assemble on the connected machine

### 1.1 Get the source

```bash
git clone https://github.com/kellymichels/EvoPlatform.git
```

```bash
git clone https://github.com/kellymichels/evo-ai.git
```

### 1.2 Build the images

```bash
cd EvoPlatform/platform && docker compose -f docker-compose.prod.yml build
```

```bash
cd ../../evo-ai && docker compose build
```

### 1.3 Pull the third-party images

```bash
docker pull postgres:16
```

```bash
docker pull qdrant/qdrant:latest
```

```bash
docker pull ollama/ollama:latest
```

> Check the compose files for the exact image tags in your version rather than
> assuming these — a mismatch means the target tries to pull at start-up and
> fails with a confusing error.

### 1.4 Download the AI model

Start Ollama on the connected machine and pull the model you sized for:

```bash
docker run -d --name ollama-temp -v ollama_models:/root/.ollama ollama/ollama:latest
```

```bash
docker exec ollama-temp ollama pull llama3.1:8b
```

### 1.5 Warm the indexing model — do not skip this

This is the step people miss, and it fails at the worst moment.

The indexing engine (`fastembed`) downloads a small model **the first time it
embeds anything**. That download is not baked into the image. On an air-gapped
server it fails, and it fails during your first data sync rather than at
start-up — so the install looks fine until you try to use it.

Warm the cache by running evo-ai on the connected machine and indexing one
trivial document:

```bash
cd evo-ai && docker compose up -d
```

```bash
echo "warm the cache" > /tmp/warm.txt && curl -X POST http://localhost:8000/ingest/file -H "Authorization: Bearer dev" -F "file=@/tmp/warm.txt;type=text/plain"
```

A successful response means the model downloaded. Find where it landed:

```bash
docker compose exec evo-ai sh -c 'find / -name "*.onnx" -not -path "/proc/*" 2>/dev/null'
```

Copy that directory out of the container and keep it with your transfer:

```bash
docker compose cp evo-ai:<the directory from above> ./fastembed-cache
```

### 1.6 Export everything

```bash
docker save -o images.tar postgres:16 qdrant/qdrant:latest ollama/ollama:latest evoplatform-app evo-ai-evo-ai
```

> Confirm the built image names with `docker images` first — compose derives
> them from the directory name, so yours may differ.

```bash
docker run --rm -v ollama_models:/data -v "${PWD}":/backup alpine tar czf /backup/ollama-models.tar.gz -C /data .
```

Your transfer set:

| File | Roughly |
|---|---|
| `images.tar` | 3–5 GB |
| `ollama-models.tar.gz` | Model size — 5 GB for an 8B model |
| `fastembed-cache/` | Under 100 MB |
| The two source repositories | Small |

---

## Stage 2: Install on the air-gapped server

### 2.1 Load the images

```bash
docker load -i images.tar
```

```bash
docker images
```

Confirm all five are present before continuing.

### 2.2 Restore the AI model

```bash
docker volume create ollama_models
```

```bash
docker run --rm -v ollama_models:/data -v "${PWD}":/backup alpine tar xzf /backup/ollama-models.tar.gz -C /data
```

### 2.3 Install EvoPlatform

Follow [Self-hosting EvoPlatform, Part B](01-self-hosting-evoplatform.md#part-b-put-it-on-a-server),
with two changes:

- **Skip the build step.** The image is already loaded; remove `--build` from
  the compose command or it will try to fetch base images.
- **Use an internal hostname.** Whatever your internal DNS serves, e.g.
  `platform.internal`. The certificate must come from your organisation's own
  certificate authority — public issuers require a reachable domain.

### 2.4 Install Ask AI

Follow [Adding Ask AI](02-adding-ask-ai.md) with the local-model configuration.
The `.env` values that matter here:

```env
DEV_MODE=false
SECRET_KEY=<generate one>
EVOPLATFORM_JWKS_URL=https://platform.internal/.well-known/jwks.json
JWT_ISSUER=evoplatform
JWT_AUDIENCE=

DEFAULT_LLM_PROVIDER=ollama
DEFAULT_LLM_MODEL=llama3.1:8b
DEFAULT_LLM_API_KEY=

DEFAULT_EMBED_PROVIDER=fastembed
DEFAULT_EMBED_MODEL=BAAI/bge-small-en-v1.5
```

> **Never set a cloud provider here.** Ollama is the only provider that works
> without internet. A cloud one produces timeouts that read like a broken
> install rather than a configuration mistake.

### 2.5 Restore the indexing cache

Copy the `fastembed-cache` directory into the evo-ai container at the same path
it came from:

```bash
docker compose cp ./fastembed-cache evo-ai:<the same path>
```

Then restart:

```bash
docker compose restart evo-ai
```

### 2.6 Silence outbound telemetry

Qdrant reports anonymous usage statistics by default. On an isolated network
those attempts fail harmlessly, but a security review will ask, and failed
outbound connections clutter your logs. Turn it off explicitly in the Qdrant
service:

```yaml
environment:
  - QDRANT__TELEMETRY_DISABLED=true
```

---

## Stage 3: Prove it is actually isolated

Do not skip this. The point of an air-gapped install is a claim you can defend.

**1. Everything is running.**

```bash
docker compose ps
```

**2. Ask AI responds.**

```bash
curl http://localhost:8000/health
```

**3. Indexing works — the real test of stage 1.5.** Connect a small source and
run a sync ([guide 3](03-connecting-your-data.md)). If it completes, the
indexing model is genuinely local. If it hangs or errors reaching an external
host, the cache did not restore to the right place.

**4. A question gets answered.** Ask about something you indexed. The first
question after start-up is slow — the model is loading into memory — and
subsequent ones are faster.

**5. Nothing is trying to get out.** Watch for outbound attempts while the
system is in normal use:

```bash
docker compose logs | grep -iE "timeout|connection refused|could not resolve"
```

Repeated failures naming an external host mean something is still configured
to reach the internet — most often a cloud provider left in `.env`, or the
documentation crawler from guide 3 pointed at a public site.

---

## Operating without a connection

### Updating

There is no update channel. Repeat stage 1 on the connected machine with the
new version, transfer, `docker load`, and restart. Database migrations run
automatically when the services start.

Take a backup before every update. Rolling back means loading the previous
images, which you should therefore keep.

### Backups

Same volumes as a connected install, and the same warning applies: losing
EvoPlatform's signing keys logs every user out permanently, with no recovery.

| Volume | Losing it means |
|---|---|
| EvoPlatform database | Tenants, users, audit history gone |
| EvoPlatform keys | **Everyone logged out permanently. No recovery** |
| `qdrant_data` | Re-index from sources — time, not data loss |
| `evoai_data` | Source configuration and provider keys gone |

### When something breaks

There is no diagnostic export command yet, so collect the evidence by hand:

```bash
docker compose logs --since 24h > evoai-logs.txt
```

```bash
docker compose ps > evoai-status.txt
```

**Read them before they leave the building.** Logs can contain fragments of
indexed content and the questions users asked, which in an air-gapped
environment is exactly the material the isolation exists to protect. Have
whoever owns that decision review the files first.

### What you give up

| | Connected | Air-gapped |
|---|---|---|
| AI model quality | Best available cloud models | What your hardware runs |
| Model improvements | Automatic | Manual, deliberate |
| Product documentation as a source | Crawled from the public docs site | Only if hosted internally |
| Support | Send logs directly | Manual export, reviewed, hand-carried |
| Updates | One command | Repeat the transfer |

---

## Troubleshooting

| Symptom | What is happening |
|---|---|
| Sync fails trying to reach an external host | Stage 1.5 was skipped or the cache restored to the wrong path. Find the path on the connected machine and match it exactly |
| Container start fails, "pull access denied" | An image was not in `images.tar`, or the tag differs from the compose file |
| Every question times out | A cloud provider is set in `.env`. Only `ollama` works offline |
| Model container exits immediately | Not enough RAM. `docker stats`, then a smaller model |
| First question takes 30+ seconds | Normal — the model is loading into memory and stays resident |
| Login rejected | `EVOPLATFORM_JWKS_URL` unreachable from the container, or `JWT_AUDIENCE` has a value — it must be empty |
| TLS certificate errors between services | The internal CA is not trusted by the containers. Mount your CA bundle in |

---

## Related

- **[Self-hosting EvoPlatform](01-self-hosting-evoplatform.md)**
- **[Adding Ask AI](02-adding-ask-ai.md)** — model sizing
- **[Connecting your data](03-connecting-your-data.md)**
- **[Integrating Ask AI](04-integrating-ask-ai.md)**
