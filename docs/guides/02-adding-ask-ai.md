# Adding Ask AI

Installing evo-ai — the AI assistant — next to your EvoPlatform installation,
either connected to a cloud AI provider or running entirely on your own
hardware with nothing leaving the building.

Assumes you have finished [Self-hosting EvoPlatform](01-self-hosting-evoplatform.md).

---

## What Ask AI is, and what it is not

evo-ai answers questions about **your own records**, in plain language, and
shows which records each answer came from.

Here is the part people get wrong, and it matters for both your security review
and your expectations:

> **Nothing is ever trained on your data.** No AI model learns from your
> records, and your information never becomes part of any model's memory.

What actually happens is closer to a very good search engine with a writing
assistant attached:

1. Your records are **indexed** — converted into a mathematical form that makes
   "find things about this topic" fast, and stored in a database on your server.
2. When someone asks a question, evo-ai **looks up** the handful of records
   that relate to it.
3. Those specific records are handed to a language model **along with the
   question**, and it writes the answer from them.

The model is exactly as it came from its vendor, before and after. It has no
memory between questions. Delete a record from the index and it is genuinely
gone from future answers — there is no residue baked into a model somewhere.

This is why "how long does re-training take?" has no answer here: there is no
training step. There is a **sync**, it takes minutes, and it happens on a
schedule.

**A fresh installation knows nothing.** Finishing this guide gives you a
working assistant with no data in it, which will politely tell you that your
records do not cover whatever you asked. That is correct behavior, not a fault.
[Connecting your data](03-connecting-your-data.md) is the next guide, and it is
the one that makes Ask AI useful.

---

## Decide first: cloud model or local model

This is the only decision in this guide that is hard to change later, and it is
the one your security people will ask about.

|  | **Cloud model** | **Local model** |
|---|---|---|
| Where answers are generated | The provider's servers | Your server |
| What leaves your building | The question, plus the records retrieved to answer it | Nothing |
| Hardware needed | Modest — 2 GB RAM | Substantial — see below |
| Cost | Per question, billed by the provider | Electricity |
| Answer quality | Currently better | Good, and improving |
| You need | An API key from Anthropic, OpenAI, or Google | Enough RAM |

**Both options index your data locally.** The indexing step runs in-process on
your own CPU either way, so your full record set never leaves the server even
in cloud mode. What a cloud provider sees is the question and the few records
retrieved to answer it — not your database.

### If you are considering a local model, read this before choosing

Local models are the reason people choose self-hosting, and they are also where
self-hosting most often goes wrong. The models that give good answers are
large, and large means RAM.

Approximate memory needed, for the compressed versions normally used:

| Model size | RAM | Realistically |
|---|---|---|
| ~1 billion | 1–2 GB | Runs anywhere; answers are noticeably weak |
| ~8 billion | 5–6 GB | The sensible starting point |
| ~13 billion | 9–10 GB | Better, if you have the headroom |
| ~70 billion | 40+ GB | A serious machine, or a GPU |

> **The repository's default is a 70-billion-parameter model.** If you start
> the stack without changing `DEFAULT_LLM_MODEL`, it will try to download tens
> of gigabytes and then fail to run on any ordinary server. Set the model
> deliberately.

This is not a theoretical concern. The hosted evo-ai deployment runs a *cloud*
model specifically because its server could not spare the ~1.6 GB a one-billion
parameter model needed alongside everything else on the box. Measure your
available RAM before committing.

**A reasonable middle path:** run a cloud model now to get working answers, and
switch to local later. Changing the model is an environment-variable edit and a
restart — the index is unaffected, so nothing needs rebuilding.

### Where the local model runs matters as much as its size

The stack below runs the model-runner (Ollama) in a container, which is the
simplest thing that works everywhere. It is also, on some machines, much slower
than it needs to be:

| Your machine | Model in a container | Ollama installed natively |
|---|---|---|
| **macOS (Apple Silicon)** | **CPU only** — Docker Desktop cannot reach the GPU | Uses the GPU |
| **Windows with an NVIDIA GPU** | Needs WSL2 and CUDA set up in Docker | Uses the GPU |
| **Linux with an NVIDIA GPU** | Needs the NVIDIA container toolkit | Uses the GPU |

The macOS row is the one that surprises people. On an Apple Silicon Mac the
containerised model gets no GPU acceleration at all, and the same model run
natively is dramatically faster — with nothing on screen to explain the
difference.

**If you have a GPU, or you are on a Mac,** install Ollama natively from
[ollama.com](https://ollama.com), then point evo-ai at it instead of the
bundled container by setting this in `.env`:

```env
OLLAMA_BASE_URL=http://host.docker.internal:11434
```

On Linux, `host.docker.internal` does not resolve by default — add this to the
evo-ai service in `docker-compose.yml`:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

Then stop the bundled runner with `docker compose stop ollama`.

None of this affects indexing, which runs in-process on CPU on every platform.

---

## Before you start

| You need | Notes |
|---|---|
| Docker + Docker Compose | Same as the platform guide |
| git | |
| A running EvoPlatform | With its `/.well-known/jwks.json` reachable from this machine |
| An AI provider API key | Only if you chose a cloud model |

**Disk:** allow 5 GB for the software and index. Add the model size on top if
you are running locally.

**RAM:** 2 GB for evo-ai and its index database, plus whatever your chosen
model needs from the table above.

---

## 1. Get the code

```bash
git clone https://github.com/kellymichels/evo-ai.git
```

```bash
cd evo-ai
```

## 2. Configure it

```bash
cp .env.example .env
```

Open `.env`. The settings below are the ones that matter; leave the rest at
their defaults for now.

### Security settings — required

```env
DEV_MODE=false
SECRET_KEY=<generate one>
EVOPLATFORM_JWKS_URL=https://platform.yourcompany.com/.well-known/jwks.json
JWT_ISSUER=evoplatform
JWT_AUDIENCE=
```

Generate the secret with Docker, which you already have, so the command is
identical on Windows, macOS, and Linux:

```bash
docker run --rm python:3.12-alpine python -c "import secrets;print(secrets.token_urlsafe(32))"
```

On macOS or Linux, `openssl rand -base64 32` does the same thing.

> **`DEV_MODE=true` accepts any password-shaped string as valid.** It exists so
> developers can work without a login server. Never leave it on for anything
> reachable by other people.

> **Leave `JWT_AUDIENCE` empty.** EvoPlatform's tokens do not carry an audience
> claim. If you put a value here, every valid login will be rejected.

`SECRET_KEY` encrypts the AI provider keys stored on disk. It is required
whenever `DEV_MODE` is off.

### Choose your model

**For a cloud model** — this example uses Anthropic; substitute `openai` or
`gemini` and the corresponding model name if you prefer:

```env
DEFAULT_LLM_PROVIDER=anthropic
DEFAULT_LLM_MODEL=claude-sonnet-5
DEFAULT_LLM_API_KEY=<your key from the provider>
DEFAULT_EMBED_PROVIDER=fastembed
DEFAULT_EMBED_MODEL=BAAI/bge-small-en-v1.5
```

**For a local model** — pick a size your server can actually hold:

```env
DEFAULT_LLM_PROVIDER=ollama
DEFAULT_LLM_MODEL=llama3.1:8b
DEFAULT_LLM_API_KEY=
DEFAULT_EMBED_PROVIDER=fastembed
DEFAULT_EMBED_MODEL=BAAI/bge-small-en-v1.5
```

`fastembed` is the indexing engine. It runs inside evo-ai on ordinary CPU, needs
no GPU and no separate service, and is why your records stay local regardless of
which answering model you chose. Use it in both cases.

> **The indexing model is fixed when a collection is created and cannot be
> changed afterwards.** Changing it would invalidate every stored vector, so
> evo-ai does not allow it — switching means building a new collection and
> re-indexing. Decide now and leave it alone.

## 3. Start it

```bash
docker compose up -d
```

That starts three containers: evo-ai itself, Qdrant (the index database), and
Ollama (the local-model runner).

**If you chose a cloud model**, Ollama will sit idle doing nothing. Harmless,
but you can stop it reclaiming memory:

```bash
docker compose stop ollama
```

**If you chose a local model**, download it now — this takes a while:

```bash
docker compose exec ollama ollama pull llama3.1:8b
```

Use the same model name you put in `.env`.

## 4. Check it worked

```bash
curl http://localhost:8000/health
```

You should get a success response. Then open **http://localhost:8000/ui** — a
chat page.

Ask it anything. You should get a polite refusal explaining that your records
do not cover it.

**That refusal is the success condition.** It means the whole chain is
working — the service is up, your login server is being consulted, the model
answered, and the guardrail that stops it inventing things is doing its job.
There is simply nothing indexed yet.

If instead you get an error, a timeout, or an answer full of confident general
knowledge, something is wrong — see [Troubleshooting](#troubleshooting).

---

## 5. Notes for production

The bundled `docker-compose.yml` is set up for trying things out. Before real
use:

- **Confirm `DEV_MODE=false`** and that `SECRET_KEY` is set to a real value
- **Do not publish port 8000 to the internet.** Put it behind the same reverse
  proxy as your platform, or leave it reachable only from your application
  server
- **Add `restart: unless-stopped`** to the services so they come back after a
  reboot
- **Remove the `develop: watch:` block** from the evo-ai service — it is a
  development convenience that reloads on file changes
- **Back up the `qdrant_data` and `evoai_data` volumes.** Losing them is
  recoverable — you can re-index from your sources — but that costs time and,
  on a cloud model, re-indexing cost

> **There is no ready-made production compose file for customers yet.** The
> `deploy/` directory in the repository is written for the hosted deployment
> specifically and expects networks that will not exist on your server. Start
> from the root `docker-compose.yml` and apply the changes above.

### If you are running this for one organisation

Most of evo-ai's configuration exists to keep many customers apart on a shared
installation. Running it for yourself, you can ignore:

- **`DEFAULT_LLM_ALLOWED_TENANTS`** — restricts which customers may spend the
  operator's API key. With one organisation, everyone allowed is the correct
  answer. Leave it empty.
- **Tenant links** — map one identity system's customer ids onto another's.
  Not needed when there is only one.
- **Per-tenant model configuration** — the server-wide default in `.env` is
  simply what everyone uses.

---

## Troubleshooting

| Symptom | What is happening |
|---|---|
| Every question rejected as unauthorised | `EVOPLATFORM_JWKS_URL` is unreachable from this container, or `JWT_AUDIENCE` has a value in it — it must be empty |
| Service will not start, complains about `SECRET_KEY` | Required whenever `DEV_MODE=false`. Generate one and restart |
| First question takes 30+ seconds, later ones are fast | Normal on a local model — it loads into memory on first use and stays there |
| Local model container keeps dying | Not enough RAM. Check with `docker stats`, then choose a smaller model |
| `docker compose exec ollama ollama pull` downloads for a very long time | Check the model size. The default is a 70-billion-parameter model — tens of gigabytes |
| Answers are confident but invented | Almost always `DEV_MODE=true` with the guardrail relaxed. Turn it off |
| Answers cite nothing and refuse everything | Expected until you index something — [Connecting your data](03-connecting-your-data.md) |
| Cloud model returns an authentication error | Wrong or expired `DEFAULT_LLM_API_KEY`, or the key lacks access to the specific model named |

---

## Next

- **[Connecting your data](03-connecting-your-data.md)** — the guide that makes
  Ask AI actually useful
- **[Integrating Ask AI into your app](04-integrating-ask-ai.md)** — putting it
  inside your own product instead of the built-in chat page
- **[Air-gapped installation](05-air-gapped-install.md)** — running with no
  internet connection at all
