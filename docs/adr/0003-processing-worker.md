# Processing worker: a pull-based Rust binary, on a laptop first

Extracting text from Sources (ffmpeg on video up to 1 GB and 2 hours, document conversion with `xberg`) cannot run inside Workers: 10 ms CPU on Free, 128 MB memory, 100 MB request bodies. We run it in a separate Rust binary that pulls jobs from our own API (`claim` with a lease in D1, then `complete`) and reads and writes R2 only through presigned URLs, so it holds no Cloudflare credentials. Speech goes to Whisper large-v3-turbo and images or scans to a vision model, both over an OpenAI-compatible API (DeepInfra first), so the worker needs no GPU.

**Where it runs:** the product owner's laptop, kept on around the clock as a `launchd` service. Moving to the cloud means running the same binary in Cloud Run Jobs, Northflank or Cloudflare Containers; the code does not change (`docs/research/model-selection.md`).

**Considered options:** Cloudflare Queues pull consumers (messages live only 24 h on Free, so a laptop that is off for a weekend loses jobs); R2 event notifications (the Retry button creates no event); Cloudflare Containers right away ($5 a month for near-zero load).

**Consequences:** a Material waits with status «В очереди» while the laptop is off. Leases expire after 30 minutes per hour of video and a Source gets at most 3 attempts. The worker is not tied to any Claude Code session.
