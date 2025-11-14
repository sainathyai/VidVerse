# Agentic Video Pipeline – PRD & PR-by-PR Build Plan

## 1. Summary
- **Objective:** Ship an end-to-end AI video generation pipeline that can ingest prompts, assets, and scene constraints, then produce coherent multi-clip videos with synchronized audio. The system must expose a toggleable agentic workflow (LangGraph-based) for iterative co-creation with the user.
- **Primary Categories:** Music videos (beat-aligned) and ad creatives (brand-safe, aspect-ratio aware). Secondary support for explainers once core flows stabilize.
- **Core Differentiators:** Asset-aware planning (first/last frame control per scene), user-in-the-loop edit chat, option to switch between deterministic “Classic Flow” and autonomous “Agentic Flow” for best output, explicit cost/time telemetry.

## 2. Goals & Non-Goals
| Type | Goals | Non-Goals |
| --- | --- | --- |
| Product | Intuitive UI w/ prompt refinement, asset uploads, scene previews | Full NLE replacement; deep timeline editing |
| Tech | Modular LangGraph orchestration, resilient job queue, caching | Training custom video models from scratch |
| Business | Produce 3+ showcase videos, hit <$200/min cost, 90% success | Monetization, billing, marketplace |

## 3. Personas
- **Creator:** Needs fast ideation, style experimentation, agentic assists.
- **Brand Marketer:** Requires brand guardrails, logo/asset enforcement, reviewable edits.
- **Technical Producer / Judge:** Evaluates architecture, API, reliability metrics.

## 4. Canonical User Workflow
1. User logs in, selects category (music video/ad creative).
2. Upload assets: audio track, brand kit, optional first/last frame references per scene.
3. Enter prompt + constraints, choose Classic vs Agentic toggle.
4. System produces scene board (timings, thumbnails, first/last frame placeholders).
5. User iterates via chat edits/regenerate specific scenes.
6. Final render composed (audio sync, overlays, grading) and delivered.

## 5. Functional Requirements
### Input & Planning
- Natural language prompt parser extracting mood, duration, style, guardrails.
- Asset ingestion with validation (file type, duration match, aspect ratio).
- Scene planner that respects supplied first/last frames, ensures transitions, beat alignment.

### Generation & Composition
- Per-scene prompt generation, calling Replicate models (video/image/audio) with caching.
- Audio analysis for tempo/markers; transition suggestions.
- Composition layer merges clips, applies overlays, LUTs, exports 1080p/30fps+ MP4/WebM.

### Agentic Collaboration
- LangGraph flow with nodes: Intent Evaluator → Planner → Critic → Generator → QA.
- Toggle to enable/disable autonomous refinement. When on, agent suggests edits or auto-adjusts; when off, deterministic one-pass pipeline.
- Chat interface to accept user instructions; scene-level regeneration pipeline.

### Asset & Frame Control
- Per scene: store first-frame + last-frame stills; allow uploads/overrides.
- On regeneration, preserve locked frames; highlight conflicts for user resolution.

### Telemetry & Costing
- Track inference cost, duration, success/fail status per job.
- Dashboard for judges showing pipeline stages, retries, caching hits.

## 6. System Requirements
- **Performance:** 30s video <5 min end-to-end; 60s <10 min. Parallel scene generation with queue/backpressure.
- **Reliability:** 90%+ success, automatic retries, resumable uploads, idempotent regeneration endpoints.
- **Security/Compliance:** Signed upload URLs, asset isolation per project, PII-safe logging.

## 7. Feature Matrix
| Feature | MVP (48h) | Final Week | Stretch |
| --- | --- | --- | --- |
| Prompt → video flow | ✅ Basic deterministic pipeline | ✅ Polished & agentic |  |
| Audio beat detection | Basic onset detection | Refined with ML libs | Predictive choreography |
| Agentic toggle | Stubbed (no loop) | Full LangGraph w/ critique | Auto AB testing |
| Asset uploads | Audio only | Multi-asset + frame locks | Brand kit intelligence |
| Scene regen | Global only | Scene-level | Shot-level micro-edits |
| Cost dashboard | Simple logs | UI dashboard | Budget-aware planning |

## 8. Recommended Tech Stack
- **Frontend:** Next.js 15 + React Server Components, Tailwind or PandaCSS, Zustand for state, UploadThing for assets, shadcn/UI kit for rapid prototyping, WebSockets (Socket.IO or Pusher) for progress events.
- **Backend/API:** Node.js 20 w/ Fastify (performance) or tRPC Router; alternative Python FastAPI service for LangGraph orchestration if preferred. Redis for queues (BullMQ/Celery equivalent). PostgreSQL (Supabase) for projects/scenes metadata.
- **Agentic Layer:** LangGraph (Python) running within FastAPI worker; OpenAI o4-mini or GPT-4.1 for reasoning; optional Anthropic Sonnet fallback.
- **Media Services:** Replicate APIs (Runway Gen-3, Pika, Luma Dream Machine, Suno/Udio audio). ffmpeg for stitching, MoviePy wrapper for overlays.
- **Storage & CDN:** AWS S3 (or Cloudflare R2) for assets/renders, CDN via CloudFront/R2. Use DynamoDB or Postgres JSONB for scene graph snapshots.
- **Observability:** OpenTelemetry traces, Logfire/Datadog, Sentry for exceptions, Grafana dashboards on Prometheus metrics.
- **Auth & Security:** Clerk/Auth0 for auth, signed upload URLs, rate limiting via Upstash Redis.

## 9. Architecture Outline
```
[Next.js Client]
  -> prompt, upload, toggle, chat
      |
[API Gateway (Fastify/tRPC)]
  -> validation, auth, job enqueue
      |
[Queue (Redis/BullMQ)]
      |
[Worker Pool]
  -> LangGraph Classic Flow
  -> LangGraph Agentic Flow
      |
[Model Adapters]
  -> Replicate (video/image/audio)
  -> Audio analysis service
      |
[Media Composer]
  -> ffmpeg/LangChain pipeline
      |
[Storage + CDN]
```

## 10. PR-by-PR Implementation Plan
| PR # | Scope | Key Components |
| --- | --- | --- |
| PR1 | Project scaffolding & docs | Repo setup, Next.js shell, Fastify API, `.env` templates, CI lint/tests. |
| PR2 | Prompt + asset ingestion | Prompt form, upload pipeline (audio/images), backend validators, project schema in Postgres. |
| PR3 | Deterministic MVP pipeline | Scene planner (basic), Replicate integration, ffmpeg composer, simple job queue, first sample video. |
| PR4 | Agentic LangGraph toggle | LangGraph flow, reasoning nodes, toggle UI, chat skeleton, partial edit loop. |
| PR5 | Scene board & frame control | Timeline UI with first/last frame previews, locking logic, targeted scene regeneration API. |
| PR6 | Asset manager & brand enforcement | Brand kit uploads, palette extraction, style prompts injection, reference frame override workflow. |
| PR7 | Telemetry & cost dashboard | Structured logging, cost calculator, progress WebSocket events, dashboard UI. |
| PR8 | Quality + polish | Beat alignment refinement, transitions, LUT grading, error recovery UX, final docs/demos. |

## 11. Validation Checklist
- Generate ≥3 showcase videos covering required diversity.
- Run multi-user concurrent generation test (load test script).
- Manual QA of agentic loop scenarios (auto vs manual edits).
- Measure cost/time per video and document in README.

## 12. Risks & Mitigations
- **Model variance → inconsistent scenes:** mitigate via cached seeds, brand/style embeddings, QA critic node.
- **Inference cost overruns:** budget guardrails per job, fallback to cheaper preview models, reuse clips where possible.
- **Complex UX for first/last frames:** provide defaults, highlight conflicts, allow optional override rather than mandatory upload.
- **Queue congestion:** autoscale workers, per-scene parallelism, enforce concurrency limits.

## 13. Next Steps
1. Confirm PR plan ownership and timelines.
2. Lock final model list + environment budget.
3. Begin PR1 immediately; ensure CI + deployment skeleton ready for MVP cutoff.

