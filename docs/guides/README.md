# Customer guides

Setting up EvoPlatform and Ask AI on your own infrastructure. Written for
someone who has not used either before — every step says what to run, what you
should see, and how to tell it worked.

Read them in order. Each assumes the one before it.

| | Guide | What you get |
|---|---|---|
| 1 | **[Self-hosting EvoPlatform](01-self-hosting-evoplatform.md)** | Login, tenants, users, and roles on your own server, from laptop trial to production with TLS |
| 2 | **[Adding Ask AI](02-adding-ask-ai.md)** | The AI assistant installed, with the cloud-model or local-model decision made deliberately |
| 3 | **[Connecting your data](03-connecting-your-data.md)** | The assistant actually useful — sources, sync, and how to verify answers are grounded |
| 4 | **[Integrating Ask AI into your app](04-integrating-ask-ai.md)** | The assistant inside your own product instead of the built-in chat page |
| 5 | **[Air-gapped installation](05-air-gapped-install.md)** | Everything above on a network with no internet connection |

## Two things worth knowing before you start

**EvoPlatform and Ask AI are separate.** Guide 1 gives you a working login and
tenant system with no AI in it. Everything from guide 2 onward is the optional
AI layer. Plenty of installations stop after guide 1.

**Nothing is ever trained on your data.** Ask AI indexes your records so it can
look them up, then hands the relevant few to a language model along with the
question. The model is unchanged before and after, retains nothing between
questions, and delete a record and it is genuinely gone from future answers.
Guide 3 explains this properly — it is the first question a security review
asks, and the answer is better than most people expect.

## Related documentation

- **[Developer guide](../INSTALL.md)** — building an app on the platform:
  `evo new`, platform mode, and the SDK
- **[Architecture](../ARCHITECTURE.md)** — how the pieces fit together
- **[Template contract](../TEMPLATE_CONTRACT.md)** — what a conforming app
  template must provide
