# Connecting your data

Ask AI arrives knowing nothing. This guide is how it learns where your
information lives — and it is the difference between an assistant that refuses
everything and one people actually use.

Assumes you have finished [Adding Ask AI](02-adding-ask-ai.md).

---

## Start here: the empty state is not a bug

Install Ask AI, open the chat page, ask it something reasonable, and you get:

> This workspace's records don't cover that question, so there's nothing to
> answer from.

Nothing is broken. You have installed a very careful assistant and given it
nothing to be careful about. It is refusing because refusing is what it is
built to do when it has no supporting records — which is exactly what you want
it doing on the day it *does* have your data and someone asks about something
outside it.

This guide fills that gap.

---

## What "connecting data" actually means

There is one misconception worth clearing up before you start, because it
changes what you expect and what you tell your security team.

### It is not training

Connecting your data does not train anything. No model learns your records. No
model retains them. The model you are using is byte-for-byte identical before
and after, and it will be identical after you delete everything too.

### It is indexing

Here is the real sequence:

**1. Reading.** evo-ai fetches your records — from a database, a website, a
folder of documents, wherever you point it.

**2. Splitting.** Each record is cut into passages of a few hundred words,
because "the relevant paragraph" is a far more useful unit to retrieve than
"the entire 90-page document."

**3. Indexing.** Every passage is converted into a list of numbers that
captures its meaning, so that later a question can be turned into numbers the
same way and the closest passages found in milliseconds. This runs on your own
CPU, inside evo-ai. Your records do not leave the server to be indexed.

**4. Storing.** Those numbers go into Qdrant, a database in a container on
your server, alongside the original text.

Then, when someone asks a question, the top few passages are retrieved and
handed to the language model *with* the question. The model writes an answer
from what it was handed. Next question, the model remembers none of it.

### Why the distinction is worth your attention

| Question | Because it is indexing, not training |
|---|---|
| "How long does re-training take?" | There is no training. There is a **sync**, taking minutes, running on a schedule |
| "If we delete a record, is it really gone?" | Yes. Remove it from the source, and the next sync removes it from the index. There is no model to un-train |
| "Could our data surface in someone else's answers?" | No. Your passages live in your own database and are only ever retrieved for your own questions |
| "What did the AI vendor learn about us?" | Nothing. They see individual questions with a few passages attached, and only if you chose a cloud model |
| "Can we correct a wrong answer?" | Fix the underlying record. The next sync picks it up. You are editing data, not coaxing a model |

---

## Two ways to connect data

**Connected sources** are the normal way: you tell evo-ai where your data lives
once, and it keeps itself up to date on a schedule — new records appear,
changed records update, deleted records disappear.

**Direct uploads** push individual files in. Useful for documents that do not
live in a system — policies, manuals, a folder of PDFs.

Most installations use both.

---

## Option A: Connect a source

### What can be connected today

| Source | What it indexes |
|---|---|
| **Website** | Any documentation or intranet site — crawled from a starting page, same site only |
| **Confluence** | A space's pages |
| **Jira** | Issues matching a search, optionally with comments |
| **SmartPlantEHS** | Permits, incidents, tasks, chemicals, training, events, plants — read directly from its database |

### Registering one

Sources are managed through the API. Here is a documentation site, which is the
most broadly useful starting point — it teaches the assistant your product's
own manual:

```bash
curl -X POST http://localhost:8000/sources \
  -H "Authorization: Bearer <your token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "product-docs",
    "type": "webcrawler",
    "source_type": "docs",
    "interval_minutes": 1440,
    "config": {
      "base_url": "https://docs.yourcompany.com",
      "path_prefix": "/user-guide",
      "max_pages": 200
    }
  }'
```

What those settings do:

- **`name`** — your label for this source; used in later commands
- **`interval_minutes`** — how often it re-checks. `1440` is daily, which suits
  documentation. Live business records deserve something shorter, like `30`
- **`path_prefix`** — restricts the crawl to part of the site. Omit to take
  everything
- **`max_pages`** — a safety cap so a misconfigured crawl cannot run away

Crawling never leaves the site you pointed it at, and images and stylesheets
are skipped.

### Start the first sync

Registering a source does not index it immediately — it waits for the schedule.
To start now:

```bash
curl -X POST http://localhost:8000/sources/product-docs/sync \
  -H "Authorization: Bearer <your token>"
```

### Watch it work

```bash
curl http://localhost:8000/sources/product-docs/runs \
  -H "Authorization: Bearer <your token>"
```

Each run reports how many documents were **added**, **updated**, **deleted**,
**unchanged**, and how many **errored**.

That third column is the one that tells you sync is doing its job properly:
records deleted at the source are removed from the index rather than lingering
as answers about things that no longer exist.

The **unchanged** count matters for a different reason — evo-ai fingerprints
each record's content and skips anything that has not moved. On a cloud model
that is a direct cost saving; on a local one it is the difference between a
two-minute sync and a two-hour one.

---

## Option B: Upload files directly

Accepted formats: **PDF, Word (.doc/.docx), plain text, Markdown, CSV, JSON.**

```bash
curl -X POST http://localhost:8000/ingest/file \
  -H "Authorization: Bearer <your token>" \
  -F "file=@safety-manual.pdf" \
  -F "source_type=document" \
  -F "doc_id=safety-manual"
```

> **Set `doc_id` to something stable and meaningful.** It is how evo-ai
> recognises a re-upload as *the same document*. With it, uploading a revised
> manual replaces the old one. Without it, you get two copies indexed and the
> assistant quoting whichever it happens to retrieve — including the version
> you thought you replaced.

To remove a document:

```bash
curl -X DELETE "http://localhost:8000/ingest/doc?doc_id=safety-manual" \
  -H "Authorization: Bearer <your token>"
```

### A whole folder, kept in sync

For a directory of documents that changes over time:

```bash
python scripts/watch_folder.py /path/to/documents --url http://localhost:8000 --token <your token>
```

It uploads everything supported, then watches for changes. Each file's path
becomes its `doc_id`, so edits replace and deletions remove. A fingerprint file
in the folder means re-running it does not re-upload unchanged files.

Add `--once` to run a single pass instead of watching.

---

## How to tell it worked

Work through these in order. Each one narrows down where a problem is.

**1. The source reports documents.**

```bash
curl http://localhost:8000/sources -H "Authorization: Bearer <your token>"
```

A document count above zero and a recent successful run. Zero documents means
the connection or its scope is wrong — not the indexing.

**2. Ask something you know the answer to.** Pick a specific fact from a
specific record — not "summarise our permits," but "what is the status of
permit X." Broad questions are a poor test because you cannot tell a wrong
answer from a vague one.

**3. Check the sources under the answer.** Every answer lists the records it
used. Open them. If the answer is right but the sources are unrelated, you got
lucky rather than correct — and that is worth knowing before people rely on it.

**4. Ask something you know is *not* in your data.** It should refuse. An
assistant that answers everything is not grounded in your records, and the
refusal behaviour is what makes the rest trustworthy.

---

## Keeping it current

Sources re-sync on their own schedule. Choose the interval to match how fast
the data moves and how much a stale answer costs you:

| Data | Suggested |
|---|---|
| Live business records | 30 minutes |
| Reference material, policies | Daily (`1440`) |
| Documentation | Daily |

Force an immediate sync any time with the `/sync` call above — worth doing
after a bulk import rather than waiting.

**Deletions propagate.** Remove a record at the source and the next sync
removes it from the index. This is the mechanism behind the honest answer to
"is it really gone?" — but note it happens *on the next sync*, not instantly.
If you need something gone immediately, delete it and trigger a sync.

---

## Troubleshooting

| Symptom | What is happening |
|---|---|
| Refuses everything after a successful sync | Check the document count is above zero. A run can succeed having found nothing — usually a scope setting like `path_prefix` excluding the whole site |
| Answers quote an old version of a document | It was uploaded without a `doc_id`, so the new copy was added rather than replacing. Delete both and re-upload with one |
| Sync reports errors on some documents | Check the run history for detail. Individual failures do not stop the rest — commonly a PDF that is scanned images with no extractable text |
| Website source finds one page | The starting page's links go elsewhere, or `path_prefix` is too narrow |
| Sync takes hours | Normal for a first run on a large source. Later runs skip unchanged records and are much faster |
| Deleted a record, still being cited | Deletion applies at the next sync. Trigger one |
| Answers are right, sources look unrelated | Worth investigating before rollout — usually too-broad chunks or a source indexed with the wrong `source_type` |

---

## Next

- **[Integrating Ask AI into your app](04-integrating-ask-ai.md)** — putting it
  inside your product rather than the built-in chat page
- **[Air-gapped installation](05-air-gapped-install.md)** — no internet at all
