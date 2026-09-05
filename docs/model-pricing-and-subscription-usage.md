# Model prices and subscription usage

Settings → Global → Model pricing lists USD per million tokens for this device.
Add a model or edit its rates and comma-separated display-name aliases. Matching
ignores case, spaces and punctuation and also uses names advertised by the harness.
Overrides persist in the supervisor database and apply to historical estimates on
reload. Reset restores a bundled model or removes a custom model.

The cost tooltip separates uncached input, cache reads, cache writes, output and
reported reasoning tokens. Each row shows tokens and USD. Reasoning is part of
output billing, so the two displayed rows split that charge instead of adding it
twice. Prices estimate API token charges, even for subscription sessions; they do
not represent subscription invoices, tool charges or cache-storage charges.

## Bundled rates

The catalog is `config/codex-model-pricing.json`, with source links and verification
dates per added model. Sources checked on 2026-09-05:

- [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing):
  Opus 5, Fable 5/5.1, Sonnet 5 and Haiku 4.5. Cache-write estimates use the default
  five-minute rate; reports without cache TTL do not distinguish one-hour writes.
- [xAI pricing](https://docs.x.ai/developers/pricing): Grok 4.5/4.6, including the
  long-context multiplier.
- [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing): text rates for
  3.1 Pro, 3.7/3.8 Flash and 3.1/3.5 Flash-Lite. The catalog includes context
  thresholds and the published end of promotional Flash rates.
- [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing/): V4 Flash
  and Pro, with weekday UTC peak periods and the off-peak discount.
- [GLM pricing](https://docs.z.ai/guides/overview/pricing): 5.1, 5 and 4.7.
  GLM 5.3 is listed without rates because its price was not verifiable on this
  page. Missing rates show unavailable, never a fabricated zero-dollar estimate.

Live usage accumulates per-report prices. Repricing historical totals after a
custom rate change cannot reconstruct missing per-request context sizes or times;
it uses the saved last input size and turn start time.

## OAuth allowance

The small composer badge shows actual available windows, with remaining allowance
and reset time on hover/tap. API-key authentication, expired windows, unavailable
providers and failed queries hide it. A short cache limits account polling.

- Codex: read-only `account/read` and `account/rateLimits/read` on an independent
  app-server process. No thread is opened and no conversation writer is acquired.
- Grok: read-only ACP `_x.ai/billing`; a weekly allowance is shown as 7d, without
  inventing a 5h limit.
- Claude: verify OAuth authentication with `claude auth status`, then read the
  account usage endpoint using the existing local OAuth access token. An expired
  token hides the badge until the harness refreshes its credentials. Remote Codex
  does not rotate credentials or log tokens.

ACP threads select the account adapter using their agent ID. Usage reflects the
local harness account; custom wrappers or separate credential stores must expose
compatible account commands to be supported. Account usage is not available to
shared-thread viewers. OAuth credentials are never sent to the relay or browser.
