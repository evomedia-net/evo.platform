# Pull request

## What changed, and why

<!-- The change in a couple of sentences. If it fixes an issue, add the
     trailer to a COMMIT message rather than only here - `Closes #123` in a
     commit body is what links the fix to the issue permanently, and what
     closes it on merge. -->

## How it was tested

<!-- Which suites you ran and what they said. Name anything you could not
     run and why - "no Docker locally, so the Postgres-backed jobs are CI's
     word" is a useful sentence; silence is not. -->

```
cd platform            && npm test
cd packages/sdk-node   && npm test
cd cli                 && npm test
cd packages/sdk-python && pytest
cd templates/next      && npm test
```

## Checklist

- [ ] One logical change. Unrelated fixes belong in their own branch.
- [ ] Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`type(scope): summary`).
- [ ] Tests come with the change. A bug fix includes a test that fails without it.
- [ ] Every `.md` touched has its regenerated `.txt` twin in the same commit (`python scripts/md_txt.py`, checked by CI).
- [ ] User-facing changes are documented in `docs/` in this PR, not a follow-up.
- [ ] No secrets, tokens, or real addresses in the diff — including in test fixtures.

## Anything reviewers should know

<!-- Trade-offs you made, things you left out on purpose, follow-ups worth
     filing. Known limitations stated here are far cheaper than the ones
     found later. -->
