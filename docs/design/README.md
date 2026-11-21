# Design docs

How StrataCouncil.ca works now, and how it got that way. Kept current: every pull request that changes behaviour updates the doc it affects and adds to the changelog.

| Doc | What it covers |
|---|---|
| [00-changelog.md](00-changelog.md) | Dated record of decisions and changes, newest first |
| [01-identity-multitenancy-data-model.md](01-identity-multitenancy-data-model.md) | Accounts, stratas, roles and permissions, every table, retention |
| [02-stratasphere-ai-advisor.md](02-stratasphere-ai-advisor.md) | The AI assistant: privacy, reading documents, finding records, the rules, the recall check |
| [03-user-journey.md](03-user-journey.md) | From sign-up to subscribing, section by section, and the demo site |
| [04-technical-architecture.md](04-technical-architecture.md) | Stack, services, configuration, checks, releasing |
| [05-brand-design-system.md](05-brand-design-system.md) | Colours, type, logo, visual and writing rules |

Feature designs that go deeper sit one level up in `docs/`: `learn-decide-remember.md` (free and paid, Stratasphere), `demo-site.md`, `zoom-video-sdk.md`, `lifecycle-emails.md`, `marketing.md`, `automated-browser-tests.md`, and `end-to-end-testing.md`.

Older code comments cite sections of these docs by their October numbering ("doc02 §4b"); the rewrite kept the same topics, but section numbers may differ.
