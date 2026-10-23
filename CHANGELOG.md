# Changelog

Notable changes to evo.platform, newest first. Each entry links the pull request that made it.

Versions have five parts, `v{major}.{rc}.{beta}.{alpha}.{build}`, and the build number
advances once per release. New changes go under Unreleased in the same pull request,
and the release moves them under its version.

## Unreleased

## v0.0.1.0.22 - 2026-10-17

### Fixed

- **tests:** the passkey challenge-token test cannot fail by chance ([#309](https://github.com/evomedia-net/evo.platform/pull/309))
- **deps:** drop sprintf-js by giving js-yaml 3 argparse 2 (no patched sprintf-js exists) ([#306](https://github.com/evomedia-net/evo.platform/pull/306))

### Maintenance

- **deps:** bump the npm-version-updates group across 4 directories with 14 updates ([#307](https://github.com/evomedia-net/evo.platform/pull/307))
- **deps:** bump the npm-security-updates group across 4 directories with 4 updates ([#305](https://github.com/evomedia-net/evo.platform/pull/305))
- **deps:** bump the npm-version-updates group across 4 directories with 7 updates ([#302](https://github.com/evomedia-net/evo.platform/pull/302))
- **deps:** bump stripe from 22.6.2 to 23.0.0 in /platform ([#303](https://github.com/evomedia-net/evo.platform/pull/303))
- **deps-dev:** bump jsdom from 27.4.0 to 30.1.2 in /templates/next ([#304](https://github.com/evomedia-net/evo.platform/pull/304))
- **deps:** upgrade the platform to NestJS 12 ([#301](https://github.com/evomedia-net/evo.platform/pull/301))
- **deps:** bump the npm-version-updates group across 4 directories with 10 updates ([#293](https://github.com/evomedia-net/evo.platform/pull/293))
- **ci:** re-run a test run once when a job in it times out ([#299](https://github.com/evomedia-net/evo.platform/pull/299))
- **ci:** stop a hung test run after 5-10 minutes instead of GitHub's 6 hours ([#298](https://github.com/evomedia-net/evo.platform/pull/298))

## v0.0.1.0.21 - 2026-10-01

### Maintenance

- **deps:** @nestjs/schematics 11 -> 12, which means TypeScript 6 ([#291](https://github.com/evomedia-net/evo.platform/pull/291))
- **deps:** @simplewebauthn/server 13 -> 14, and read stored transports as the strings they are ([#290](https://github.com/evomedia-net/evo.platform/pull/290))
- **deps:** bump the npm-security-updates group across 2 directories with 3 updates ([#289](https://github.com/evomedia-net/evo.platform/pull/289))
- **deps:** bump the npm-version-updates group across 4 directories with 8 updates ([#286](https://github.com/evomedia-net/evo.platform/pull/286))
- **deps:** bump multer ([#287](https://github.com/evomedia-net/evo.platform/pull/287))
- **deps:** bump dotenv from 16.6.1 to 18.0.1 in /platform ([#281](https://github.com/evomedia-net/evo.platform/pull/281))
- **deps-dev:** bump @nestjs/cli from 11.0.24 to 12.0.3 in /platform ([#283](https://github.com/evomedia-net/evo.platform/pull/283))
- **deps:** bump dotenv from 17.4.2 to 18.0.1 in /templates/next ([#285](https://github.com/evomedia-net/evo.platform/pull/285))

## v0.0.1.0.20 - 2026-09-22

### Fixed

- **ci:** test on the Node version production runs, and keep every declaration of it in step ([#277](https://github.com/evomedia-net/evo.platform/pull/277))
- **backup:** the header check rejected good dumps under pipefail ([#262](https://github.com/evomedia-net/evo.platform/pull/262))
- **backup:** docker exec has no -T flag ([#261](https://github.com/evomedia-net/evo.platform/pull/261))
- **backup:** call the script with bash, not by its execute bit ([#260](https://github.com/evomedia-net/evo.platform/pull/260))
- **repo:** pin line endings, so shell scripts reach the server able to run ([#259](https://github.com/evomedia-net/evo.platform/pull/259))
- **backup:** stop producing empty backups, and keep the schedule in the repo ([#258](https://github.com/evomedia-net/evo.platform/pull/258))

### Maintenance

- **deps:** hold TypeScript majors until ts-jest can accept one ([#278](https://github.com/evomedia-net/evo.platform/pull/278))
- **deps-dev:** bump @types/node from 22.20.2 to 26.6.0 in /cli ([#270](https://github.com/evomedia-net/evo.platform/pull/270))
- **deps-dev:** bump @types/node in /packages/sdk-node ([#273](https://github.com/evomedia-net/evo.platform/pull/273))
- **deps-dev:** bump @types/node from 22.20.2 to 26.6.0 in /platform ([#274](https://github.com/evomedia-net/evo.platform/pull/274))
- **deps-dev:** bump jest and @types/jest in /packages/sdk-node ([#271](https://github.com/evomedia-net/evo.platform/pull/271))
- **deps-dev:** bump jest and @types/jest in /cli ([#268](https://github.com/evomedia-net/evo.platform/pull/268))
- **deps:** bump the npm-version-updates group across 1 directory with 5 updates ([#267](https://github.com/evomedia-net/evo.platform/pull/267))
- point the SWAG-Estimates cross-references at ProvenSheet ([#265](https://github.com/evomedia-net/evo.platform/pull/265))
- retire the SmartPlant EHS name from public cross-references (and fix two dead paths) ([#263](https://github.com/evomedia-net/evo.platform/pull/263))

## v0.0.1.0.19 - 2026-09-12

### Added

- **release:** cut a release from the Actions tab instead of by hand ([#254](https://github.com/evomedia-net/evo.platform/pull/254))

### Fixed

- **release:** stop at the branch — the org forbids Actions opening pull requests ([#256](https://github.com/evomedia-net/evo.platform/pull/256))
- **release:** cut the release through a pull request, not a push to main ([#255](https://github.com/evomedia-net/evo.platform/pull/255))

## v0.0.1.0.18 - 2026-09-12

### Documentation

- **install:** say where a user actually meets the password policy ([#252](https://github.com/evomedia-net/evo.platform/pull/252))

### Maintenance

- attribution headers, package metadata and a README byline before the flip ([#251](https://github.com/evomedia-net/evo.platform/pull/251))

## v0.0.1.0.17 - 2026-09-11

### Fixed

- **deps:** keep majors out of the grouped version updates ([#247](https://github.com/evomedia-net/evo.platform/pull/247))

### Maintenance

- **test:** migrate templates/next to vitest 5, and close the two gaps its stricter counting exposed ([#249](https://github.com/evomedia-net/evo.platform/pull/249))
- **deps:** bump the npm-version-updates group across 2 directories with 3 updates ([#248](https://github.com/evomedia-net/evo.platform/pull/248))

## v0.0.1.0.16 - 2026-09-11

### Maintenance

- **deps:** bump the actions-version-updates group with 4 updates ([#235](https://github.com/evomedia-net/evo.platform/pull/235))
- **deps:** patch the service's Prisma-supplied transitives too ([#244](https://github.com/evomedia-net/evo.platform/pull/244))
- **deps:** patch the template's Prisma-supplied transitives ([#242](https://github.com/evomedia-net/evo.platform/pull/242))
- **deps:** patch the Node SDK's build-time dependencies ([#240](https://github.com/evomedia-net/evo.platform/pull/240))
- **deps:** patch the CLI's build-time dependencies ([#239](https://github.com/evomedia-net/evo.platform/pull/239))
- **deps:** patch the service's shipping dependencies (nodemailer, qs, multer) ([#238](https://github.com/evomedia-net/evo.platform/pull/238))
- **deps:** bump next, nodemailer and vitest together, and group Dependabot so lockfiles regenerate whole ([#234](https://github.com/evomedia-net/evo.platform/pull/234))

## v0.0.1.0.15 - 2026-09-11

### Maintenance

- **repo:** add issue forms and a pull-request template ([#226](https://github.com/evomedia-net/evo.platform/pull/226))

## v0.0.1.0.14 - 2026-09-10

### Maintenance

- **template:** templates/next reaches 100% statements — pages, components and hooks (#204 step 3), plus three UI bugs found on the way ([#223](https://github.com/evomedia-net/evo.platform/pull/223))
- **email:** prove all three SMTP resolution branches, as #51 asked ([#220](https://github.com/evomedia-net/evo.platform/pull/220))

## v0.0.1.0.13 - 2026-09-10

### Added

- **version:** report the build version at GET /api/build-version ([#217](https://github.com/evomedia-net/evo.platform/pull/217))

### Maintenance

- **template:** cover every API route handler at the branch level ([#215](https://github.com/evomedia-net/evo.platform/pull/215))
- **template:** cover lib, auth, and sync at the branch level; fix whitespace-only passwords (#204 step 1) ([#214](https://github.com/evomedia-net/evo.platform/pull/214))

## v0.0.1.0.12 - 2026-09-09

### Maintenance

- **template:** browser tests for the auth screens in CI — and the two fleet-rule violations they found (#208, #209) ([#210](https://github.com/evomedia-net/evo.platform/pull/210))
- run sdk-node's integration script against a live platform on every PR ([#206](https://github.com/evomedia-net/evo.platform/pull/206))
- **template:** measure templates/next coverage - 12% of statements, every file counted ([#205](https://github.com/evomedia-net/evo.platform/pull/205))
- **sdk-node:** cover every function - 37.5% of functions to 100% on every metric ([#203](https://github.com/evomedia-net/evo.platform/pull/203))
- **cli:** cover evo new and evo register end to end - 34% to 100% ([#202](https://github.com/evomedia-net/evo.platform/pull/202))

## v0.0.1.0.11 - 2026-09-09

### Documentation

- drop the MVP roadmap section from the platform README ([#195](https://github.com/evomedia-net/evo.platform/pull/195))
- move mvp.md out of the repo before it goes public ([#194](https://github.com/evomedia-net/evo.platform/pull/194))

### Maintenance

- **repo:** open-source readiness — .txt twins generated and CI-gated, code of conduct, NiceGUI placeholder removed ([#193](https://github.com/evomedia-net/evo.platform/pull/193))

## v0.0.1.0.10 - 2026-09-03

### Added

- **template:** signing out deletes the tenant's browser database ([#190](https://github.com/evomedia-net/evo.platform/pull/190))
- **template:** the standalone reset link carries its token in the fragment ([#189](https://github.com/evomedia-net/evo.platform/pull/189))
- **passkeys:** ceremonies require user verification by default ([#188](https://github.com/evomedia-net/evo.platform/pull/188))
- **sdk:** an unknown kid refetches the JWKS at most once per quiet interval, in both SDKs ([#187](https://github.com/evomedia-net/evo.platform/pull/187))
- **security:** helmet with a self-only Content-Security-Policy, HSTS in production, no inline script ([#183](https://github.com/evomedia-net/evo.platform/pull/183))
- **auth:** a revoked refresh token coming back ends the whole token family ([#182](https://github.com/evomedia-net/evo.platform/pull/182))
- **email:** per-app send quota on POST /email/send, 429 and audited on breach ([#181](https://github.com/evomedia-net/evo.platform/pull/181))

### Fixed

- **cli:** evo new runs npm without a shell, and --password warns ([#191](https://github.com/evomedia-net/evo.platform/pull/191))
- **invites:** the invite email names the platform by its configured brand ([#184](https://github.com/evomedia-net/evo.platform/pull/184))
- **audit:** POST /events requires the app-tenant relationship and stores app events under the app's namespace ([#180](https://github.com/evomedia-net/evo.platform/pull/180))
- **tenant:** a platform admin's in-tenant row is out of reach of tenant-admin mutations ([#179](https://github.com/evomedia-net/evo.platform/pull/179))
- **auth:** validate signup-link expiry and checkout quantity, 409 on slug races, uniform 401, client-keyed recovery budgets ([#178](https://github.com/evomedia-net/evo.platform/pull/178))
- **hygiene:** dockerignore, loopback dev ports, prod env example names, env-based screenshot credentials ([#177](https://github.com/evomedia-net/evo.platform/pull/177))

### Documentation

- **security:** state what client credentials can and cannot do ([#186](https://github.com/evomedia-net/evo.platform/pull/186))

### Maintenance

- **ci:** read-only token and SHA-pinned actions ([#185](https://github.com/evomedia-net/evo.platform/pull/185))

## v0.0.1.0.9 - 2026-09-01

### Fixed

- **ci:** add templates/next to CI, and stop building the SDK inside a consumer install ([#151](https://github.com/evomedia-net/evo.platform/pull/151))

## v0.0.1.0.8 - 2026-09-01

### Fixed

- **ci:** build and test packages/sdk-python, whose 40 tests never ran ([#149](https://github.com/evomedia-net/evo.platform/pull/149))

## v0.0.1.0.7 - 2026-08-31

### Added

- **sdk:** let AskAi assert the asking user, so evo-ai memory is per person ([#145](https://github.com/evomedia-net/evo.platform/pull/145))

### Maintenance

- **sdk:** release 0.4.1 — AskAi userId support ([#146](https://github.com/evomedia-net/evo.platform/pull/146))
- cover the admin surface and auth/passkey controllers — 83.4% → 90.1% ([#144](https://github.com/evomedia-net/evo.platform/pull/144))

## v0.0.1.0.6 - 2026-08-27

### Added

- **billing:** Stripe mode awareness, a go-live readiness report, and per-tenant revenue ([#143](https://github.com/evomedia-net/evo.platform/pull/143))

### Fixed

- **security:** close the passkey enumeration oracle and the template's frozen session role (#140) ([#142](https://github.com/evomedia-net/evo.platform/pull/142))

## v0.0.1.0.4 - 2026-08-21

### Added

- **brand:** serve brand identity to apps, so a fleet rename is one edit ([#111](https://github.com/evomedia-net/evo.platform/pull/111))
- **template:** account recovery for the Next.js starter ([#110](https://github.com/evomedia-net/evo.platform/pull/110))
- **console:** a real editor for email copy, and labels that are not clipped ([#109](https://github.com/evomedia-net/evo.platform/pull/109))
- **email:** platform-level editable copy for every message it sends ([#107](https://github.com/evomedia-net/evo.platform/pull/107))
- **billing:** apps sell any number of priced tiers (monthly/annual/one-time), with a collapsible console ([#99](https://github.com/evomedia-net/evo.platform/pull/99))
- **console:** Forgot password is a button, not a link ([#98](https://github.com/evomedia-net/evo.platform/pull/98))
- **billing:** entitlement endpoint + scope billing calls to the calling app's own tenants ([#94](https://github.com/evomedia-net/evo.platform/pull/94))
- **auth:** POST /auth/workspaces - email an address its workspace list ([#92](https://github.com/evomedia-net/evo.platform/pull/92))
- **console:** edit app callback URLs and rename a workspace ([#88](https://github.com/evomedia-net/evo.platform/pull/88))
- **admin-ui:** Revenue page — charts, whose-fault stale banner, CSV ([#64](https://github.com/evomedia-net/evo.platform/pull/64))
- **sdk-python:** implement the Python SDK, mirrored with sdk-node ([#62](https://github.com/evomedia-net/evo.platform/pull/62))
- **revenue:** operator revenue analytics, pulled from Stripe with the outage classified ([#58](https://github.com/evomedia-net/evo.platform/pull/58))
- **admin:** app delete/restore/purge, and wire up the purge and export the console never exposed ([#46](https://github.com/evomedia-net/evo.platform/pull/46))
- **admin-ui:** reveal toggle on the sign-in password, and a forgot-password link ([#45](https://github.com/evomedia-net/evo.platform/pull/45))
- **users:** let platform admins change a user's email address ([#42](https://github.com/evomedia-net/evo.platform/pull/42))
- **brand:** put the mini mark in front of the copyright line ([#39](https://github.com/evomedia-net/evo.platform/pull/39))
- **admin-ui:** show "© {year} Evomedia.net LLC. All rights reserved." on every page ([#33](https://github.com/evomedia-net/evo.platform/pull/33))
- **auth:** replace composition-rule password policy with the NIST/OWASP Standard ([#32](https://github.com/evomedia-net/evo.platform/pull/32))
- **auth:** replace composition-rule password policy with the NIST/OWASP Standard ([#31](https://github.com/evomedia-net/evo.platform/pull/31))
- **sdk:** audience check in verifyToken - reject tokens minted for other apps ([#30](https://github.com/evomedia-net/evo.platform/pull/30))
- **platform:** per-app autoEnroll flag - opt out of new-tenant auto-enablement ([#29](https://github.com/evomedia-net/evo.platform/pull/29))
- **sdk:** add AskAi client so apps stop hand-rolling the evo-ai HTTP call ([#26](https://github.com/evomedia-net/evo.platform/pull/26))
- **platform:** rate limiting, first-boot admin bootstrap, evo register CLI (Phase 7) ([#15](https://github.com/evomedia-net/evo.platform/pull/15))
- **platform:** per-app Stripe billing drives app enablement (Phase 6) ([#14](https://github.com/evomedia-net/evo.platform/pull/14))
- **platform:** self-service signup behind SIGNUP_MODE (Phase 5) ([#13](https://github.com/evomedia-net/evo.platform/pull/13))
- **platform:** invites — emailed accept links replace temporary passwords ([#12](https://github.com/evomedia-net/evo.platform/pull/12))
- **platform:** email verification gate + self-service password reset ([#11](https://github.com/evomedia-net/evo.platform/pull/11))
- **platform:** tenant admins with /tenant/* member management (Layer 2) ([#10](https://github.com/evomedia-net/evo.platform/pull/10))
- **platform:** per-app tenant enablement (Layer 1) ([#9](https://github.com/evomedia-net/evo.platform/pull/9))
- **admin-ui:** New User as a collapsible overlay, matching New Tenant ([#7](https://github.com/evomedia-net/evo.platform/pull/7))
- **admin-ui:** New User as a collapsible overlay ([#6](https://github.com/evomedia-net/evo.platform/pull/6))
- **users:** person profile — first/last name + phone ([#3](https://github.com/evomedia-net/evo.platform/pull/3))
- **tenant:** company profile + New Tenant overlay ([#4](https://github.com/evomedia-net/evo.platform/pull/4))
- **platform:** data lifecycle - tenant export, purge (erasure), retention sweeps ([#2](https://github.com/evomedia-net/evo.platform/pull/2))
- **platform:** built-in admin console ([#1](https://github.com/evomedia-net/evo.platform/pull/1))
- **cli:** evo new - scaffold, rename identities, vendor SDK, secrets, checklist
- **templates:** extract evo-app-next - offline-first multi-tenant Next.js starter
- **sdk-node:** forward browser Origin on passkey options calls for server-side proxies
- **billing:** Stripe subscriptions - checkout, portal, webhook sync, 7-day grace
- **auth:** per-user passkey (WebAuthn) registration and login
- **platform:** bundled Mailpit SMTP so email works out of the box in dev
- **sdk-node:** Node SDK - local JWKS verification, auth proxy, events, email
- **platform:** platform service v1 - tenants, users, auth/JWKS, apps, audit, email

### Changed

- Reapply "chore(deps): Prisma 6 -> 7 across platform and the next template - co…" (#68) ([#69](https://github.com/evomedia-net/evo.platform/pull/69))
- Revert "chore(deps): Prisma 6 -> 7 across platform and the next template - co…" ([#68](https://github.com/evomedia-net/evo.platform/pull/68))

### Fixed

- **security:** require an app-tenant relationship before /email/send uses a tenant relay ([#134](https://github.com/evomedia-net/evo.platform/pull/134))
- **security:** both SDKs reject single-purpose tokens and require a bound audience ([#135](https://github.com/evomedia-net/evo.platform/pull/135))
- **security:** production refuses to start on the default SECRET_KEY ([#136](https://github.com/evomedia-net/evo.platform/pull/136))
- **security:** the template's password-change path enforces the password policy (#128) ([#137](https://github.com/evomedia-net/evo.platform/pull/137))
- **security:** session gates, session revocation, CSV injection, SMTP default index (#129) ([#138](https://github.com/evomedia-net/evo.platform/pull/138))
- **security:** trust the proxy by default in production, so the audit log records the client ([#133](https://github.com/evomedia-net/evo.platform/pull/133))
- **security:** key local users on the platform identity, bind the session to the workspace signed into ([#130](https://github.com/evomedia-net/evo.platform/pull/130))
- **security:** the workspace-lookup email takes its sender and link from the registry ([#131](https://github.com/evomedia-net/evo.platform/pull/131))
- **console:** the brand example is indented like a saved record ([#119](https://github.com/evomedia-net/evo.platform/pull/119))
- **console:** the brand example names the app you are looking at ([#118](https://github.com/evomedia-net/evo.platform/pull/118))
- **ui:** the admin header never scrolls away ([#117](https://github.com/evomedia-net/evo.platform/pull/117))
- **docs:** the console screenshots belong to evo.docs, not this repo ([#116](https://github.com/evomedia-net/evo.platform/pull/116))
- **admin-ui:** brand placeholder read as saved config, not an example ([#114](https://github.com/evomedia-net/evo.platform/pull/114))
- **template:** give a member's name and email their own line ([#113](https://github.com/evomedia-net/evo.platform/pull/113))
- **auth:** recovery names the product and returns the user to it ([#105](https://github.com/evomedia-net/evo.platform/pull/105))
- **billing:** acknowledge webhooks naming an unknown tenant instead of 500ing ([#101](https://github.com/evomedia-net/evo.platform/pull/101))
- **console:** stop telling platform admins to leave the workspace blank ([#97](https://github.com/evomedia-net/evo.platform/pull/97))
- **template:** resolve platform mode at request time on the login page ([#90](https://github.com/evomedia-net/evo.platform/pull/90))
- **auth:** show/hide toggle on the hosted reset and invite password fields ([#86](https://github.com/evomedia-net/evo.platform/pull/86))
- **config:** refuse to boot in production with a localhost PUBLIC_BASE_URL ([#85](https://github.com/evomedia-net/evo.platform/pull/85))
- **auth:** reset page rejected valid passphrases (stale composition rule) + tenant-homed admin reset lookup ([#83](https://github.com/evomedia-net/evo.platform/pull/83))
- **console:** let a tenant-homed platform admin sign in and reset a password ([#81](https://github.com/evomedia-net/evo.platform/pull/81))
- **template:** enforce the NIST/OWASP password policy on standalone signup ([#79](https://github.com/evomedia-net/evo.platform/pull/79))
- **deps:** patch Auth.js critical, Next middleware bypass, nodemailer SMTP injection in the Next template ([#76](https://github.com/evomedia-net/evo.platform/pull/76))
- **docs:** paint flow-diagram step badges over the arrow lines ([#74](https://github.com/evomedia-net/evo.platform/pull/74))
- **revenue:** platform could not boot - optional Stripe param lacked @Optional() ([#66](https://github.com/evomedia-net/evo.platform/pull/66))
- **admin-ui:** footer spaces survive the flex container ([#60](https://github.com/evomedia-net/evo.platform/pull/60))
- **apps:** app updates are audited — autoEnroll changes were leaving no trace ([#59](https://github.com/evomedia-net/evo.platform/pull/59))
- **deps:** clear all npm advisories and drop the deprecated test tooling ([#56](https://github.com/evomedia-net/evo.platform/pull/56))
- **seed:** seeded accounts could not log in (no emailVerifiedAt) ([#53](https://github.com/evomedia-net/evo.platform/pull/53))
- **console:** mask + confirm new-user password, suggest roles, verify Stripe price ([#55](https://github.com/evomedia-net/evo.platform/pull/55))
- **users:** close the platform-level duplicate-email hole and guard the last admin ([#50](https://github.com/evomedia-net/evo.platform/pull/50))
- **deploy:** apply Prisma migrations on container start ([#49](https://github.com/evomedia-net/evo.platform/pull/49))
- **auth:** show the password rules that are actually enforced ([#47](https://github.com/evomedia-net/evo.platform/pull/47))
- **admin-ui:** darken light-theme --muted to clear WCAG AA on every surface ([#35](https://github.com/evomedia-net/evo.platform/pull/35))
- **guides:** repair Windows-breaking setup commands and warn about no Docker GPU on macOS ([#27](https://github.com/evomedia-net/evo.platform/pull/27))
- **template:** compute invite expiry at fetch time — render must stay pure ([#17](https://github.com/evomedia-net/evo.platform/pull/17))
- **admin-ui:** badges never wrap - fixes the SMTP status pill turning into a blob

### Documentation

- name the platform's real consumers - ProvenSheet, CivilCode, DocketMail ([#121](https://github.com/evomedia-net/evo.platform/pull/121))
- **console:** a screenshot tour of all seven sections, and the script that makes it ([#115](https://github.com/evomedia-net/evo.platform/pull/115))
- describe the platform that exists, not the one designed in July ([#112](https://github.com/evomedia-net/evo.platform/pull/112))
- **rename:** fleet rename runbook, and let a self-hosted instance sign its own mail ([#108](https://github.com/evomedia-net/evo.platform/pull/108))
- **readme:** embed the three flow diagrams on the repo front page ([#72](https://github.com/evomedia-net/evo.platform/pull/72))
- sequence diagrams for the three core flows, with explicit direction semantics ([#71](https://github.com/evomedia-net/evo.platform/pull/71))
- **guides:** split the Ask AI guides into evo-ai; this repo documents the platform only ([#28](https://github.com/evomedia-net/evo.platform/pull/28))
- **guides:** add data-connection guide explaining indexing, not training ([#23](https://github.com/evomedia-net/evo.platform/pull/23))
- **guides:** add air-gapped install procedure and index for the five customer guides ([#25](https://github.com/evomedia-net/evo.platform/pull/25))
- **guides:** add Ask AI install guide covering the cloud-vs-local model decision ([#22](https://github.com/evomedia-net/evo.platform/pull/22))
- **guides:** add Ask AI integration guide covering the three client patterns ([#24](https://github.com/evomedia-net/evo.platform/pull/24))
- **guides:** add customer self-hosting guide, retiring DEPLOY.md into it ([#21](https://github.com/evomedia-net/evo.platform/pull/21))
- point signup guide at docs.evomedia.net (single source of truth) ([#18](https://github.com/evomedia-net/evo.platform/pull/18))
- step-by-step signup user guide (workspace creation through billing) ([#16](https://github.com/evomedia-net/evo.platform/pull/16))
- install guide, pitch copy, README status to working v1

### Maintenance

- **deploy:** track the production compose file, ignore coverage and local notes ([#141](https://github.com/evomedia-net/evo.platform/pull/141))
- **sdk:** make both SDKs registry-publishable, at 0.4.0 ([#120](https://github.com/evomedia-net/evo.platform/pull/120))
- **sdk:** 0.3.0 — the release that added entitlement and price listing ([#102](https://github.com/evomedia-net/evo.platform/pull/102))
- point repo URLs at evomedia-net/evo.* ([#95](https://github.com/evomedia-net/evo.platform/pull/95))
- **build:** run prisma generate on postinstall so a fresh checkout compiles ([#75](https://github.com/evomedia-net/evo.platform/pull/75))
- add Evomedia.net header (repo URL, author, MIT) to all 174 source files ([#70](https://github.com/evomedia-net/evo.platform/pull/70))
- **deps:** Prisma 6 -> 7 across platform and the next template - config file, pg adapter, lazy template client (verified boot + login) ([#67](https://github.com/evomedia-net/evo.platform/pull/67))
- open-source readiness - security policy, contributing guide, accurate scope ([#38](https://github.com/evomedia-net/evo.platform/pull/38))
- **docs:** add screenshot capture scripts for console and member flows ([#19](https://github.com/evomedia-net/evo.platform/pull/19))
- **platform:** CI, backups, and production deploy artifacts ([#8](https://github.com/evomedia-net/evo.platform/pull/8))
- MIT license ([#5](https://github.com/evomedia-net/evo.platform/pull/5))
- repo scaffold - README, architecture docs, template contract, mvp
