# AI Video Pipeline - System Architecture

## High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER INTERFACE LAYER                            │
│                         Next.js 15 + React + Tailwind                        │
├──────────────┬──────────────┬──────────────┬──────────────┬────────────────┤
│ Prompt       │ Asset        │ Scene Board  │ Chat         │ Video Player   │
│ Builder      │ Uploader     │ & Timeline   │ Interface    │ & Export       │
│              │              │              │              │                │
│ • Category   │ • Audio      │ • Timeline   │ • Agentic    │ • Scrubbing    │
│ • Duration   │ • Images     │ • Frames     │   suggestions│ • Download     │
│ • Style      │ • Brand Kit  │ • Lock/Edit  │ • User edits │ • Share        │
│ • Mood       │ • Progress   │ • Conflicts  │ • Streaming  │ • Cost info    │
└──────┬───────┴──────┬───────┴──────┬───────┴──────┬───────┴──────┬─────────┘
       │              │              │              │              │
       │ tRPC/REST    │ WebSocket    │ SSE/WS       │ HTTP         │
       │              │              │              │              │
┌──────▼──────────────▼──────────────▼──────────────▼──────────────▼─────────┐
│                          API GATEWAY & ROUTING                              │
│                    Fastify (Node.js) or FastAPI (Python)                    │
├───────────────────────────────────────────────────────────────────────────┬─┤
│ • Authentication (Clerk/Auth0)     • Rate Limiting (Upstash Redis)       │ │
│ • Request Validation (Zod)         • Error Handling                       │ │
│ • Cost Tracking                    • Structured Logging                   │ │
└───────────────────────────┬───────────────────────────────────────────────┴─┘
                            │
              ┌─────────────┴─────────────┐
              │                           │
┌─────────────▼──────────┐  ┌────────────▼────────────┐
│   CLASSIC PIPELINE     │  │   AGENTIC PIPELINE      │
│   (Deterministic)      │  │   (LangGraph Flow)      │
├────────────────────────┤  ├─────────────────────────┤
│                        │  │                         │
│ 1. Parse Prompt        │  │ 1. Intent Extractor     │
│    ↓                   │  │    ↓                    │
│ 2. Plan Scenes         │  │ 2. Scene Planner        │
│    ↓                   │  │    ↓                    │
│ 3. Generate Prompts    │  │ 3. Prompt Generator     │
│    ↓                   │  │    ↓                    │
│ 4. Call Models         │  │ 4. Asset Generator      │
│    ↓                   │  │    ↓                    │
│ 5. Compose Video       │  │ 5. Quality Critic  ◄────┐
│                        │  │    ↓                    │
│ Fast, Predictable      │  │ 6. Human Feedback       │
│ ~5 min for 60s         │  │    ↓                    │
│                        │  │ 7. Should Iterate? ─────┘
│                        │  │    ↓ (max 3 loops)      │
│                        │  │ 8. Compose Video        │
│                        │  │                         │
│                        │  │ Iterative, Quality      │
│                        │  │ ~10 min for 60s         │
└───────────┬────────────┘  └────────────┬────────────┘
            │                            │
            └────────────┬───────────────┘
                         │
┌────────────────────────▼──────────────────────────┐
│           JOB QUEUE & ORCHESTRATION               │
│          BullMQ (Node) / Celery (Python)          │
├───────────────────────────────────────────────────┤
│ • Job Scheduling        • Retry Logic             │
│ • Concurrency Control   • Priority Queues         │
│ • Progress Tracking     • Dead Letter Queue       │
│ • Worker Scaling        • Rate Limiting           │
└────────────────────────┬──────────────────────────┘
                         │
┌────────────────────────▼──────────────────────────┐
│              MODEL ADAPTER LAYER                  │
│           Replicate SDK + Custom Wrappers         │
├───────────────────────────────────────────────────┤
│                                                   │
│ ┌─────────────┐  ┌─────────────┐  ┌────────────┐│
│ │   VIDEO     │  │   IMAGE     │  │   AUDIO    ││
│ │             │  │             │  │            ││
│ │ • Runway    │  │ • SDXL      │  │ • Suno     ││
│ │   Gen-3     │  │ • Flux.1    │  │ • Udio     ││
│ │ • Pika 1.5  │  │ • SD3       │  │ • Stable   ││
│ │ • Luma      │  │ • Control   │  │   Audio    ││
│ │ • Kling     │  │   Net       │  │ • Audio    ││
│ │             │  │ • IP-Adapt  │  │   Craft    ││
│ └─────────────┘  └─────────────┘  └────────────┘│
│                                                   │
│ Features:                                         │
│ • Smart Caching (prompt hash → result)           │
│ • Automatic Retries (exponential backoff)        │
│ • Cost Tracking (per call, per project)          │
│ • Model Fallbacks (if primary fails)             │
│ • Seed Management (reproducibility)              │
└────────────────────────┬──────────────────────────┘
                         │
┌────────────────────────▼──────────────────────────┐
│          MEDIA PROCESSING PIPELINE                │
│              FFmpeg + Audio Analysis              │
├───────────────────────────────────────────────────┤
│                                                   │
│ ┌─────────────────────────────────────────────┐  │
│ │         Audio Analysis Service              │  │
│ │                                             │  │
│ │ • Beat Detection (Librosa)                  │  │
│ │ • Tempo Extraction                          │  │
│ │ • Onset Analysis                            │  │
│ │ • Waveform Generation                       │  │
│ └─────────────────────────────────────────────┘  │
│                                                   │
│ ┌─────────────────────────────────────────────┐  │
│ │         Video Composition Engine            │  │
│ │                                             │  │
│ │ • Scene Stitching (FFmpeg concat)           │  │
│ │ • Transition Effects (xfade, custom)        │  │
│ │ • Audio Overlay & Sync                      │  │
│ │ • Text Overlays (drawtext, subtitles)       │  │
│ │ • Logo/Watermark                            │  │
│ │ • Color Grading (LUTs, curves)              │  │
│ │ • Frame Extraction (first/last)             │  │
│ │ • Format Conversion (MP4, WebM)             │  │
│ │ • Resolution/Aspect Ratio                   │  │
│ └─────────────────────────────────────────────┘  │
│                                                   │
│ ┌─────────────────────────────────────────────┐  │
│ │         Style & Brand Enforcement           │  │
│ │                                             │  │
│ │ • Color Palette Extraction                  │  │
│ │ • Brand Asset Overlay                       │  │
│ │ • Style Reference Matching                  │  │
│ │ • Consistency Checking                      │  │
│ └─────────────────────────────────────────────┘  │
└────────────────────────┬──────────────────────────┘
                         │
┌────────────────────────▼──────────────────────────┐
│           DATA PERSISTENCE LAYER                  │
├───────────────────────────────────────────────────┤
│                                                   │
│ ┌─────────────────┐  ┌─────────────────┐         │
│ │   PostgreSQL    │  │   Redis Cache   │         │
│ │   (Supabase)    │  │   (Upstash)     │         │
│ ├─────────────────┤  ├─────────────────┤         │
│ │ • projects      │  │ • sessions      │         │
│ │ • scenes        │  │ • job_queue     │         │
│ │ • assets        │  │ • gen_cache     │         │
│ │ • jobs          │  │ • rate_limits   │         │
│ │ • users         │  │ • progress      │         │
│ └─────────────────┘  └─────────────────┘         │
│                                                   │
│ ┌─────────────────────────────────────────────┐  │
│ │   Object Storage (S3 / Cloudflare R2)      │  │
│ ├─────────────────────────────────────────────┤  │
│ │ • User uploads (audio, images)              │  │
│ │ • Generated assets (videos, frames)         │  │
│ │ • Final renders (MP4, WebM)                 │  │
│ │ • Brand kits                                │  │
│ │ • Cache artifacts                           │  │
│ └─────────────────────────────────────────────┘  │
│                                                   │
│ ┌─────────────────────────────────────────────┐  │
│ │   Vector DB (Optional - Pinecone/pgvector) │  │
│ ├─────────────────────────────────────────────┤  │
│ │ • Style embeddings                          │  │
│ │ • Asset similarity search                   │  │
│ │ • Semantic prompt matching                  │  │
│ └─────────────────────────────────────────────┘  │
└────────────────────────┬──────────────────────────┘
                         │
┌────────────────────────▼──────────────────────────┐
│         OBSERVABILITY & MONITORING                │
├───────────────────────────────────────────────────┤
│                                                   │
│ ┌─────────────────┐  ┌─────────────────┐         │
│ │ OpenTelemetry   │  │ Sentry          │         │
│ │ Traces →        │  │ Error Tracking  │         │
│ │ Datadog/Logfire │  │                 │         │
│ └─────────────────┘  └─────────────────┘         │
│                                                   │
│ ┌─────────────────────────────────────────────┐  │
│ │           Grafana Dashboards                │  │
│ │                                             │  │
│ │ • Generation success rate                   │  │
│ │ • Average generation time                   │  │
│ │ • Cost per video                            │  │
│ │ • API call latency                          │  │
│ │ • Cache hit rate                            │  │
│ │ • Queue depth                               │  │
│ │ • Worker utilization                        │  │
│ └─────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────┘
```

---

## LangGraph Agentic Flow Detail

```
┌─────────────────────────────────────────────────────────┐
│              AGENTIC WORKFLOW (LangGraph)               │
└─────────────────────────────────────────────────────────┘

START
  │
  ▼
┌─────────────────────────┐
│   Intent Extractor      │  ◄── User prompt + assets
│   (GPT-4o / Claude)     │
├─────────────────────────┤
│ • Parse creative goals  │
│ • Extract constraints   │
│ • Identify style refs   │
│ • Validate assets       │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│   Scene Planner         │  ◄── Beat times (if audio)
│   (Reasoning LLM)       │      First/last frames (if provided)
├─────────────────────────┤
│ • Break into N scenes   │
│ • Assign durations      │
│ • Plan shot variety     │
│ • Respect frame locks   │
│ • Align to beats        │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│   Prompt Generator      │
│   (Template + LLM)      │
├─────────────────────────┤
│ • Per-scene prompts     │
│ • Inject style tokens   │
│ • Add brand colors      │
│ • Continuity hints      │
│ • Camera instructions   │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│   Asset Generator       │  ◄── Replicate APIs
│   (Parallel execution)  │
├─────────────────────────┤
│ For each scene:         │
│   • Generate video/img  │
│   • Extract frames      │
│   • Download to S3      │
│   • Track cost          │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│   Quality Critic        │  ◄── LLM analyzes outputs
│   (Vision + Reasoning)  │
├─────────────────────────┤
│ Check:                  │
│ • Style consistency     │
│ • Frame continuity      │
│ • Audio sync quality    │
│ • Prompt adherence      │
│ • Technical issues      │
└───────────┬─────────────┘
            │
            ▼
       ┌────────────────┐
       │ Issues Found?  │
       └────┬──────┬────┘
            │ Yes  │ No
            │      └────────────────┐
            ▼                       ▼
┌─────────────────────────┐   ┌─────────────────────────┐
│   Human Feedback Node   │   │   Composer              │
│   (Wait for user input) │   │   (FFmpeg pipeline)     │
├─────────────────────────┤   ├─────────────────────────┤
│ Present to user:        │   │ • Stitch scenes         │
│ • AI suggestions        │   │ • Add transitions       │
│ • Specific issues       │   │ • Overlay audio         │
│ • Regeneration options  │   │ • Apply grading         │
│                         │   │ • Add text/logo         │
│ User can:               │   │ • Export final video    │
│ • Accept AI fixes       │   └───────────┬─────────────┘
│ • Provide custom edits  │               │
│ • Regenerate scene(s)   │               ▼
│ • Skip to final         │           ┌────────┐
└───────────┬─────────────┘           │  END   │
            │                         └────────┘
            ▼
    ┌───────────────┐
    │ iteration < 3?│
    └───┬───────┬───┘
        │ Yes   │ No
        │       └─────────────────┐
        ▼                         ▼
  Back to Scene Planner      Force Finalize
  (with user feedback)       (go to Composer)

```

---

## Data Flow: User Creates Video

```
1. USER PROMPT
   "Create a cyberpunk music video with neon lights"
   + uploads: song.mp3
   + toggles: Agentic Mode ON
   
   ↓
   
2. API GATEWAY
   POST /api/projects
   {
     prompt: "...",
     category: "music_video",
     mode: "agentic",
     assets: [{ type: "audio", url: "..." }]
   }
   
   → Creates project record in Postgres
   → Enqueues job in Redis
   
   ↓
   
3. WORKER PICKS UP JOB
   → Determines mode: "agentic"
   → Initializes LangGraph with VideoGenerationState
   
   ↓
   
4. INTENT EXTRACTOR NODE
   LLM analyzes prompt:
   {
     mood: "dark, futuristic, energetic",
     style: "cyberpunk, neon, urban",
     colors: ["#00FFFF", "#FF00FF", "#FFFF00"],
     constraints: ["sync to beats", "high contrast"]
   }
   
   ↓
   
5. AUDIO ANALYSIS (parallel)
   Librosa processes song.mp3:
   {
     bpm: 128,
     beats: [0.0, 0.46, 0.93, 1.40, ...],
     duration: 180.0,
     energy_curve: [...]
   }
   
   ↓
   
6. SCENE PLANNER NODE
   Based on beats + duration:
   [
     { scene: 1, start: 0.0, end: 12.0, prompt: "intro...", mood: "build" },
     { scene: 2, start: 12.0, end: 30.0, prompt: "verse...", mood: "calm" },
     { scene: 3, start: 30.0, end: 52.0, prompt: "chorus...", mood: "high" },
     ...
   ]
   
   ↓
   
7. PROMPT GENERATOR NODE
   For scene 1:
   "A cyberpunk cityscape at night, neon lights reflecting on wet streets,
    towering skyscrapers with holographic billboards, cinematic camera movement,
    dark blue and cyan color grading, 4K, photorealistic"
   
   ↓
   
8. ASSET GENERATOR NODE (parallel for each scene)
   Scene 1: → Replicate Luma API → video_url_1
   Scene 2: → Replicate Luma API → video_url_2
   Scene 3: → Replicate Luma API → video_url_3
   ...
   
   (Each scene also extracts first/last frames)
   
   ↓
   
9. QUALITY CRITIC NODE
   Vision LLM analyzes scene transitions:
   "Scene 2 → 3 transition is too abrupt. Scene 2 last frame is bright,
    Scene 3 first frame is dark. Suggest regenerating Scene 3 with 
    darker initial lighting or adding crossfade transition."
   
   ↓
   
10. HUMAN FEEDBACK NODE
    WebSocket → Frontend:
    {
      type: "feedback_needed",
      issues: ["Scene 2-3 transition abrupt"],
      suggestions: ["Regenerate Scene 3", "Add crossfade", "Skip"]
    }
    
    User selects: "Regenerate Scene 3"
    
    Frontend → Backend:
    {
      action: "regenerate",
      scene_id: 3,
      instruction: "Match lighting to previous scene"
    }
    
    ↓
    
11. ITERATION LOOP
    Back to Prompt Generator for Scene 3:
    Updated prompt: "...starting with bright neon lighting, gradually..."
    
    → Replicate API → new_video_url_3
    
    → Quality Critic checks again → "Transition improved ✓"
    
    ↓
    
12. COMPOSER NODE
    FFmpeg pipeline:
    
    a) Download all scene videos from Replicate
    b) Create concat demuxer file
    c) Apply crossfade transitions at beat points
    d) Overlay audio: song.mp3
    e) Add color grading LUT (cyberpunk.cube)
    f) Render final video (1080p, 30fps, H.264)
    g) Upload to S3/R2
    
    ↓
    
13. RESULT
    WebSocket → Frontend:
    {
      type: "job_completed",
      video_url: "https://cdn.example.com/videos/xyz.mp4",
      cost: 11.23,
      duration_sec: 180,
      scenes: 5
    }
    
    Frontend displays video player + download button
```

---

## Technology Stack Summary

### Frontend Stack
```
Next.js 15 (App Router)
├── React 18 (Server Components)
├── TypeScript (strict mode)
├── Tailwind CSS v4
├── shadcn/ui (component library)
├── Zustand (client state)
├── TanStack Query (server state)
├── React Hook Form + Zod (forms)
├── UploadThing (file uploads)
├── Socket.IO / Pusher (real-time)
├── Video.js (player)
└── Vercel AI SDK (chat streaming)

Deploy: Vercel or Cloudflare Pages
```

### Backend Stack (Option A: Node.js)
```
Node.js 20 LTS
├── TypeScript
├── Fastify v4 (API framework)
├── tRPC v11 (type-safe APIs)
├── BullMQ (job queue)
├── Replicate SDK
├── ffmpeg-static (video processing)
├── Sharp (image ops)
├── OpenTelemetry (tracing)
└── Vitest (testing)

Deploy: Railway, Render, or Fly.io
```

### Backend Stack (Option B: Python)
```
Python 3.11+
├── FastAPI (async web framework)
├── LangGraph (agentic workflows)
├── LangChain (LLM integration)
├── Celery (job queue)
├── Replicate SDK
├── ffmpeg-python (video processing)
├── Librosa (audio analysis)
├── Pillow (image ops)
├── OpenTelemetry (tracing)
└── pytest (testing)

Deploy: Railway, Render, or Modal
```

### Infrastructure
```
Database:
├── PostgreSQL 15 (Supabase or Neon)
└── Redis 7 (Upstash)

Storage:
├── S3 or Cloudflare R2 (objects)
└── CloudFront or R2 CDN (delivery)

Observability:
├── Datadog or Logfire (APM)
├── Sentry (errors)
└── Grafana (dashboards)

Auth:
└── Clerk or Auth0

AI APIs:
└── Replicate (all models)
```

---

## Deployment Architecture

```
┌──────────────────────────────────────────────────┐
│              USERS (Global)                      │
└──────────────────┬───────────────────────────────┘
                   │
                   │ HTTPS
                   │
┌──────────────────▼───────────────────────────────┐
│           Cloudflare / Vercel Edge               │
│           (CDN, DDoS, SSL, Caching)              │
└──────────────────┬───────────────────────────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
┌───────▼────────┐   ┌────────▼──────────┐
│   Frontend     │   │   API Gateway     │
│   (Vercel)     │   │   (Railway/Render)│
│                │   │                   │
│ • Next.js SSR  │   │ • Fastify/FastAPI │
│ • Static pages │   │ • Auth middleware │
│ • API routes   │   │ • Rate limiting   │
└────────────────┘   └────────┬──────────┘
                              │
                   ┌──────────┴──────────┐
                   │                     │
        ┌──────────▼────────┐  ┌────────▼─────────┐
        │  Worker Pool      │  │  Media Workers   │
        │  (Railway)        │  │  (Railway/Modal) │
        │                   │  │                  │
        │ • Job processing  │  │ • FFmpeg tasks   │
        │ • LangGraph exec  │  │ • Heavy compute  │
        │ • Replicate calls │  │ • Batch exports  │
        └──────────┬────────┘  └────────┬─────────┘
                   │                     │
        ┌──────────┴─────────────────────┘
        │
┌───────▼────────────────────────────────┐
│         Shared Services                │
├────────────────────────────────────────┤
│ • PostgreSQL (Supabase)                │
│ • Redis (Upstash)                      │
│ • S3/R2 (Object Storage)               │
│ • Datadog (Monitoring)                 │
│ • Sentry (Errors)                      │
└────────────────────────────────────────┘
```

### Environment Configuration

**Development:**
- Local Docker Compose (Postgres, Redis, Localstack S3)
- `.env.local` with dev API keys
- Hot reload, verbose logging

**Staging:**
- Railway/Render auto-deploy from `develop` branch
- Supabase staging project
- Replicate cheap models only
- Rate limits: 5 concurrent jobs

**Production:**
- Railway/Render auto-deploy from `main` branch
- Supabase production project
- Replicate premium models enabled
- Rate limits: 10 concurrent jobs
- CDN caching aggressive
- OpenTelemetry sampling: 10%

---

## Security Considerations

### Authentication & Authorization
- JWT tokens from Clerk/Auth0
- Row-level security in Supabase (user can only access own projects)
- API rate limiting per user (prevent abuse)
- Signed upload URLs (S3 pre-signed, 5 min expiry)

### Data Privacy
- No PII stored except email (for auth)
- Generated videos marked as user-owned
- Option to delete project + all assets
- GDPR compliance (data export, deletion)

### API Security
- Replicate API keys stored in secrets manager
- LLM prompts sanitized (prevent injection)
- File upload validation (type, size, content scan)
- CORS configured (only allow frontend domain)

### Cost Protection
- Budget limits per user (default $50/month)
- Alert at 80% budget usage
- Auto-pause at 100% (require manual approval)
- Admin dashboard to monitor abuse

---

## Performance Optimization Strategies

### Caching Layers
1. **Browser cache:** Static assets (24h)
2. **CDN cache:** Videos, images (7 days)
3. **Redis cache:** Generation results (prompt hash → URL, 7 days)
4. **Database cache:** TanStack Query (5 min stale time)

### Parallel Execution
- Generate all scenes in parallel (BullMQ concurrency: 3)
- Download assets concurrently (Promise.all)
- FFmpeg multi-threaded encoding

### Smart Scheduling
- Priority queue: agentic jobs lower priority than classic
- Off-peak discounts: if Replicate offers cheaper night rates
- Pre-warming: keep worker pool hot during peak hours

### Progressive Enhancement
1. Show scene placeholders immediately
2. Stream progress updates (0% → 25% → 50% → 100%)
3. Preview low-res thumbnails while generating
4. Auto-refresh when complete (no manual reload)

---

## Disaster Recovery

### Backup Strategy
- **Database:** Supabase auto-backup (daily, 7 day retention)
- **Assets:** S3 versioning enabled (can recover deleted files)
- **Configs:** All infrastructure as code (git-tracked)

### Failure Modes & Recovery

| Failure | Impact | Detection | Recovery |
|---------|--------|-----------|----------|
| Replicate API down | Can't generate | Health check fails | Retry with backoff, show error to user |
| FFmpeg crash | Video incomplete | Sentry alert | Auto-retry job, fallback to simpler concat |
| Database down | Can't create projects | Health check fails | Queue writes, replay when recovered |
| Worker crash | Job stuck | No heartbeat for 5 min | Re-enqueue job, notify user |
| S3 down | Can't upload | Upload fails | Buffer to local disk, retry upload |
| Out of memory | Worker killed | Process exit code 137 | Reduce concurrency, split large videos |

---

## Cost Estimates

### Development Phase (9 days)
- Replicate API: ~$200-300 (testing, iteration)
- Supabase: Free tier
- Upstash Redis: Free tier
- Railway: ~$20 (hobby plan)
- Vercel: Free tier
- **Total: ~$220-320**

### Production (monthly, 100 users)
Assumptions: 10 videos/user/month, avg 60s, mixed models

- Replicate API: ~$50/user × 100 = $5,000
- Supabase: $25 (Pro plan, 8GB database)
- Upstash Redis: $15 (pay-as-you-go)
- Railway: $50 (scale plan, 2 workers)
- Vercel: $20 (Pro plan, team)
- Datadog: $31 (Pro plan, 1 host)
- Cloudflare R2: ~$5 (10TB storage, zero egress)
- **Total: ~$5,146/month**

**Revenue needed to break even:** $51.46/user/month

---

## Success Metrics

### Technical KPIs
- Generation success rate: **≥90%**
- Avg generation time (60s video): **<10 min**
- Cost per video: **<$2.00**
- Cache hit rate: **>30%**
- API P95 latency: **<500ms**
- Uptime: **>99.5%**

### User Experience KPIs
- Time to first preview: **<30 seconds**
- Edit loop satisfaction: **4/5 stars**
- Asset upload success: **>95%**
- Mobile responsive score: **>90**

### Business KPIs
- MVP delivered: **<48 hours** ✓
- Final submission: **On time** ✓
- Demo video quality: **Professional** ✓
- Judge evaluation score: **Top 3** (target)

---

## Next Steps

1. **Review & approve architecture** (team discussion, 30 min)
2. **Assign component ownership** (who builds what)
3. **Set up development environment** (PR1, today)
4. **Begin parallel workstreams:**
   - Frontend: PR2 (prompt + upload)
   - Backend: PR3 (MVP pipeline)
5. **Daily standups** (9 AM, 15 min)
6. **MVP checkpoint** (Sunday noon, HARD DEADLINE)

---

**Questions? Concerns? Improvements?**

Drop feedback in Slack #week6-video-pipeline or open GitHub Discussion.

Let's ship this 🚀

