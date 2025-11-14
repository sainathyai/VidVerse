# AI Video Generation Pipeline - Implementation Strategy & Tech Stack

## Executive Summary

This document outlines the complete implementation strategy for building an end-to-end AI video generation pipeline with **agentic capabilities** using LangGraph. The system will leverage Replicate API for all AI model inference (video, image, audio) and provide users with toggleable agentic workflows, asset upload controls, and first/last frame management per scene.

**Timeline:** 9-day sprint (Nov 14-23, 2025)  
**MVP Deadline:** 48 hours (Nov 16)  
**Final Submission:** Nov 23, 10:59 PM CT

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Recommended Tech Stack](#recommended-tech-stack)
3. [System Components](#system-components)
4. [PR-by-PR Implementation Plan](#pr-by-pr-implementation-plan)
5. [Development Workflow](#development-workflow)
6. [Cost & Performance Targets](#cost--performance-targets)
7. [Testing Strategy](#testing-strategy)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER INTERFACE                           │
│  Next.js 15 App Router + React Server Components + Tailwind    │
│  - Prompt Builder  - Asset Upload  - Scene Board  - Chat UI    │
└────────────────────────┬────────────────────────────────────────┘
                         │ tRPC / REST API
┌────────────────────────▼────────────────────────────────────────┐
│                     API GATEWAY LAYER                           │
│         Fastify (Node.js 20) or FastAPI (Python 3.11)          │
│  - Auth/Rate Limiting  - Validation  - Job Routing             │
└────────────────────────┬────────────────────────────────────────┘
                         │
          ┌──────────────┴──────────────┐
          │                             │
┌─────────▼──────────┐       ┌──────────▼─────────┐
│  CLASSIC PIPELINE  │       │  AGENTIC PIPELINE  │
│  (Deterministic)   │       │  (LangGraph Flow)  │
│                    │       │                    │
│ 1. Parse Prompt    │       │ 1. Intent Node     │
│ 2. Plan Scenes     │       │ 2. Planner Node    │
│ 3. Generate Assets │       │ 3. Generator Node  │
│ 4. Compose Video   │       │ 4. Critic Node     │
│                    │       │ 5. Edit Loop Node  │
└─────────┬──────────┘       └──────────┬─────────┘
          │                             │
          └──────────────┬──────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│                   JOB QUEUE & WORKERS                           │
│               BullMQ (Node) / Celery (Python)                   │
│               Redis for Queue + Session Store                   │
└────────────────────────┬────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│                   REPLICATE API LAYER                           │
│  - Video: Runway Gen-3, Pika, Luma Dream Machine, Kling        │
│  - Image: SDXL, Flux, Midjourney (via Replicate)               │
│  - Audio: Suno, Udio, AudioCraft, Stable Audio                 │
│  - Caching Strategy + Retry Logic + Cost Tracking              │
└────────────────────────┬────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│                  MEDIA PROCESSING LAYER                         │
│  - FFmpeg (stitching, transitions, overlays, grading)          │
│  - Librosa/Essentia (beat detection, audio analysis)           │
│  - MoviePy (Python overlays) or Sharp (Node image ops)         │
└────────────────────────┬────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│                    STORAGE & DATABASE                           │
│  - PostgreSQL (Supabase): projects, scenes, jobs, users        │
│  - S3/R2: asset storage (audio, images, videos, renders)       │
│  - Redis: caching, sessions, real-time progress                │
│  - Vector DB (optional): style embeddings for consistency      │
└─────────────────────────────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│                 OBSERVABILITY & MONITORING                      │
│  - OpenTelemetry → Datadog/Logfire                             │
│  - Sentry (error tracking)                                      │
│  - Grafana (cost/performance dashboards)                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Recommended Tech Stack

### Frontend (UI Layer)

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| **Framework** | **Next.js 15** (App Router) | RSC for fast initial loads, built-in API routes, excellent TypeScript support, edge runtime options |
| **UI Library** | **React 18+** with Server Components | Industry standard, best ecosystem, server components reduce client bundle |
| **Styling** | **Tailwind CSS v4** + shadcn/ui | Rapid prototyping, consistent design system, accessible components |
| **State Management** | **Zustand** + React Query (TanStack Query) | Lightweight state for UI, React Query for server state/caching |
| **File Uploads** | **UploadThing** or **React Dropzone** + tus.js | Resumable uploads, progress tracking, S3 pre-signed URLs |
| **Real-time Updates** | **Pusher** or **Socket.IO** or **SSE** | Progress notifications, job status, live scene previews |
| **Form Handling** | **React Hook Form** + **Zod** | Type-safe forms, validation, minimal re-renders |
| **Video Player** | **Video.js** or **Plyr** | Custom controls, preview scrubbing, frame-perfect navigation |
| **Chat Interface** | **Vercel AI SDK** or custom with streaming | Natural edit loop, LLM streaming responses |
| **Deployment** | **Vercel** (frontend) or **Cloudflare Pages** | Edge CDN, automatic SSL, preview deployments |

### Backend (API & Orchestration)

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| **Primary Runtime** | **Node.js 20 LTS** + **TypeScript** | Shared types with frontend, excellent async I/O, npm ecosystem |
| **API Framework** | **Fastify v4** or **tRPC v11** | Fastify: performance leader. tRPC: end-to-end type safety with Next.js |
| **Alternative Runtime** | **Python 3.11+** with **FastAPI** | If LangGraph integration is primary concern; async/await, type hints |
| **Agentic Framework** | **LangGraph** (Python, LangChain ecosystem) | Purpose-built for agent workflows, tool calling, state graphs |
| **LLM Integration** | **OpenAI GPT-4o** or **Anthropic Claude 3.5 Sonnet** | Reasoning for scene planning, prompt refinement, QA critique |
| **Job Queue** | **BullMQ** (Node) or **Celery** (Python) | Distributed task execution, retries, rate limiting, priority queues |
| **Auth** | **Clerk** or **Auth0** or **Supabase Auth** | Pre-built UI, session management, social logins |
| **Rate Limiting** | **Upstash Redis** with sliding window | Distributed rate limits, cost control per user |
| **API Docs** | **Scalar** or **Swagger/OpenAPI** | Interactive docs for judges, API testing |

### Database & Storage

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| **Primary Database** | **PostgreSQL 15+** (via **Supabase** or **Neon**) | JSONB for scene graphs, row-level security, real-time subscriptions |
| **Object Storage** | **AWS S3** or **Cloudflare R2** | Asset storage (audio, images, videos), R2 has zero egress fees |
| **CDN** | **CloudFront** (S3) or **R2 CDN** | Fast global delivery of generated videos |
| **Cache Layer** | **Redis 7** (Upstash or self-hosted) | Session store, job queue, generation cache (prompt → result mapping) |
| **Vector DB** (optional) | **Pinecone** or **Weaviate** or **pgvector** | Style embeddings for consistency, similarity search for assets |

### AI Model Infrastructure

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| **Video Generation** | **Replicate API**: Runway Gen-3, Pika 1.5, Luma Dream Machine, Kling v1.5 | Start cheap (Luma $0.03/sec), upgrade to Runway for finals |
| **Image Generation** | **Replicate API**: SDXL Turbo, Flux.1, Stable Diffusion 3 | Fast previews (Turbo), quality finals (Flux) |
| **Audio Generation** | **Replicate API**: Suno v3.5, Udio, Stable Audio 2, AudioCraft | Music synthesis, sound effects, background scores |
| **Audio Analysis** | **Librosa** (Python) or **Essentia** | Beat detection, tempo extraction, onset analysis |
| **Model Orchestration** | **LangChain** + **Replicate Python SDK** | Abstraction layer, retry logic, cost tracking |

### Media Processing

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| **Video Composition** | **FFmpeg 6** (via child_process or ffmpeg-python) | Industry standard, all codecs, complex filters |
| **Image Operations** | **Sharp** (Node) or **Pillow** (Python) | Fast resize, color extraction, overlay generation |
| **Timeline Editing** | **MoviePy** (Python) or **Remotion** (React) | Programmatic editing, Remotion for React-based rendering |
| **Color Grading** | **FFmpeg LUTs** + custom curves | Apply cinematic grades, brand color enforcement |
| **Transitions** | **FFmpeg xfade** filter + custom GLSL | 20+ transition types, beat-synced cuts |

### Infrastructure & DevOps

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| **Container Runtime** | **Docker** + **Docker Compose** (dev) | Consistent environments, FFmpeg bundling |
| **Orchestration** | **Railway** or **Render** or **Fly.io** | Fast deploys, auto-scaling, built-in Redis/Postgres |
| **CI/CD** | **GitHub Actions** | Auto-deploy on PR merge, lint/test pipelines |
| **Monitoring** | **Datadog** or **Logfire** (Pydantic team) | Distributed tracing, LLM observability, cost metrics |
| **Error Tracking** | **Sentry** | Real-time error alerts, performance monitoring |
| **Log Management** | **Better Stack** or **Axiom** | Structured logs, fast search, generous free tier |
| **Secrets** | **Doppler** or **.env.vault** | Encrypted secrets, team sync |

### Development Tools

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| **Monorepo** (optional) | **Turborepo** or **Nx** | Shared types, coordinated builds if multi-service |
| **Linting** | **ESLint** + **Prettier** + **Ruff** (Python) | Code consistency, auto-formatting |
| **Type Checking** | **TypeScript strict mode** + **mypy** (Python) | Catch errors at compile time |
| **Testing** | **Vitest** (Node) + **pytest** (Python) | Fast unit tests, snapshot testing for prompts |
| **E2E Testing** | **Playwright** | Full user flows, video generation validation |
| **Load Testing** | **k6** or **Artillery** | Stress test job queue, concurrent generations |

---

## System Components

### 1. Frontend Application (Next.js)

**Pages/Routes:**
```
/                           → Landing + login
/dashboard                  → Project list
/project/[id]              → Main workspace
  ├─ /project/[id]/prompt   → Prompt builder
  ├─ /project/[id]/assets   → Upload manager
  ├─ /project/[id]/scenes   → Timeline/scene board
  ├─ /project/[id]/chat     → Edit chat (agentic mode)
  └─ /project/[id]/render   → Final video player + export
/api/trpc/[trpc]           → tRPC router (if using tRPC)
```

**Key Components:**
- `PromptBuilder`: Multi-step form (category, duration, style, mood, constraints)
- `AssetUploader`: Drag-drop, progress bars, thumbnail previews
- `SceneBoard`: Timeline with scene cards, first/last frame thumbnails
- `FrameSelector`: Overlay UI to lock/override scene frames
- `ChatInterface`: Message stream, edit suggestions, auto-apply toggle
- `AgenticToggle`: Switch between Classic (fast) and Agentic (quality) modes
- `ProgressTracker`: Real-time job status, stage indicators, ETA
- `CostDashboard`: Per-project cost breakdown, model usage stats
- `VideoPlayer`: Scrubbing, scene markers, export options

### 2. API Gateway (Fastify or FastAPI)

**Endpoints:**
```
POST   /api/projects                    → Create new project
GET    /api/projects/:id                → Get project details
POST   /api/projects/:id/generate       → Trigger generation job
POST   /api/projects/:id/scenes/:sceneId/regenerate → Regen one scene
POST   /api/assets/upload               → Get signed upload URL
POST   /api/chat                         → Send edit instruction (agentic)
GET    /api/jobs/:jobId/status           → Poll job progress
GET    /api/jobs/:jobId/result           → Get final video URL
WS     /ws/projects/:id                  → Real-time updates
```

**Middleware:**
- Auth verification (JWT from Clerk/Auth0)
- Rate limiting (10 concurrent jobs per user)
- Request validation (Zod schemas)
- Error handling (structured logging)
- Cost tracking (increment per API call)

### 3. LangGraph Agentic Workflow

**Node Definitions:**

```python
# graph_definition.py
from langgraph.graph import StateGraph, END

class VideoGenerationState(TypedDict):
    project_id: str
    user_prompt: str
    category: str
    assets: dict
    scenes: list[Scene]
    feedback: list[str]
    iteration: int
    mode: str  # "classic" or "agentic"

graph = StateGraph(VideoGenerationState)

# Nodes
graph.add_node("intent_extractor", extract_intent)
graph.add_node("scene_planner", plan_scenes)
graph.add_node("prompt_generator", generate_prompts)
graph.add_node("asset_generator", call_replicate_models)
graph.add_node("quality_critic", critique_output)
graph.add_node("human_feedback", await_user_input)
graph.add_node("composer", compose_final_video)

# Edges (Classic Flow)
graph.add_edge("intent_extractor", "scene_planner")
graph.add_edge("scene_planner", "prompt_generator")
graph.add_edge("prompt_generator", "asset_generator")
graph.add_edge("asset_generator", "composer")
graph.add_edge("composer", END)

# Conditional Edges (Agentic Flow)
graph.add_conditional_edges(
    "quality_critic",
    should_iterate,
    {
        "iterate": "human_feedback",
        "finalize": "composer"
    }
)
```

**Agentic Mode Behavior:**
- After initial generation, Critic node analyzes scenes for coherence, sync, style
- If issues found, enters `human_feedback` node → UI shows suggestions
- User can accept AI suggestions, provide custom edits, or skip
- Loop max 3 iterations before forcing finalization

### 4. Replicate Integration Layer

**Model Registry:**
```typescript
// models.config.ts
export const MODELS = {
  video: {
    cheap: "lucataco/luma-photon:v1",        // $0.03/sec
    standard: "pika/pika-1.5:latest",        // $0.10/sec
    premium: "runway/gen-3-alpha:latest",    // $0.50/sec
  },
  image: {
    fast: "stability-ai/sdxl-turbo:latest",  // $0.002/img
    quality: "black-forest-labs/flux-1-dev", // $0.02/img
  },
  audio: {
    music: "suno/chirp-v3.5:latest",         // $0.10/30sec
    sfx: "meta/audiogen:latest",             // $0.01/clip
  }
}
```

**Caching Strategy:**
```python
# cache.py
import hashlib
import redis

redis_client = redis.Redis()

def get_cached_generation(prompt: str, model: str, seed: int):
    cache_key = f"gen:{hashlib.sha256(f'{prompt}{model}{seed}'.encode()).hexdigest()}"
    return redis_client.get(cache_key)

def cache_generation(prompt: str, model: str, seed: int, result_url: str):
    cache_key = f"gen:{hashlib.sha256(f'{prompt}{model}{seed}'.encode()).hexdigest()}"
    redis_client.setex(cache_key, 86400 * 7, result_url)  # 7 day TTL
```

### 5. Media Composition Pipeline

**Scene Stitching (FFmpeg):**
```bash
# concat.sh
ffmpeg -f concat -safe 0 -i scene_list.txt \
  -c:v libx264 -preset fast -crf 18 \
  -c:a aac -b:a 192k \
  -movflags +faststart \
  output.mp4
```

**Beat-Aligned Transitions:**
```python
# transitions.py
import librosa

def detect_beats(audio_path: str) -> list[float]:
    y, sr = librosa.load(audio_path)
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr)
    beat_times = librosa.frames_to_time(beats, sr=sr)
    return beat_times.tolist()

def align_scenes_to_beats(scenes: list, beat_times: list):
    # Adjust scene durations to snap to nearest beat
    aligned = []
    for i, scene in enumerate(scenes):
        nearest_beat = min(beat_times, key=lambda x: abs(x - scene.start_time))
        scene.start_time = nearest_beat
        aligned.append(scene)
    return aligned
```

### 6. Database Schema (PostgreSQL)

```sql
-- schema.sql
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  category TEXT NOT NULL, -- 'music_video' | 'ad_creative'
  prompt TEXT NOT NULL,
  mode TEXT DEFAULT 'classic', -- 'classic' | 'agentic'
  status TEXT DEFAULT 'draft', -- 'draft' | 'generating' | 'completed' | 'failed'
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE scenes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  scene_number INT NOT NULL,
  prompt TEXT NOT NULL,
  duration DECIMAL NOT NULL,
  start_time DECIMAL NOT NULL,
  first_frame_url TEXT,
  last_frame_url TEXT,
  video_url TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'audio' | 'image' | 'video' | 'brand_kit'
  url TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'full_generation' | 'scene_regen'
  status TEXT DEFAULT 'queued', -- 'queued' | 'processing' | 'completed' | 'failed'
  progress INT DEFAULT 0, -- 0-100
  current_stage TEXT,
  cost_usd DECIMAL DEFAULT 0,
  error TEXT,
  result JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_projects_user ON projects(user_id);
CREATE INDEX idx_scenes_project ON scenes(project_id, scene_number);
CREATE INDEX idx_jobs_project_status ON jobs(project_id, status);
```

---

## PR-by-PR Implementation Plan

### PR1: Project Foundation & Scaffolding
**Timeline:** Day 0-1 (Nov 14-15)  
**Owner:** Full team  
**Goal:** Establish repository structure, CI/CD, and development environment

**Tasks:**
- [ ] Initialize monorepo (optional) or separate repos (frontend/backend)
- [ ] Set up Next.js 15 project with TypeScript strict mode
- [ ] Configure Tailwind CSS + shadcn/ui
- [ ] Set up Fastify or FastAPI backend with TypeScript/Python
- [ ] Create Docker Compose for local development (Postgres, Redis, FFmpeg container)
- [ ] Configure environment variables (`.env.example`, Doppler integration)
- [ ] Set up GitHub Actions for lint/test/deploy
- [ ] Initialize Supabase project (Postgres + Auth + Storage)
- [ ] Create database schema (run migrations)
- [ ] Add Sentry for error tracking
- [ ] Write initial README with setup instructions

**Deliverables:**
- ✅ Running local dev environment
- ✅ CI pipeline passing
- ✅ Empty Next.js app deployed to Vercel
- ✅ API health check endpoint returning 200

**Tech Stack:**
- Next.js 15 + TypeScript
- Fastify or FastAPI
- PostgreSQL (Supabase)
- Redis (Upstash)
- Docker + Docker Compose
- GitHub Actions

---

### PR2: Prompt Builder & Asset Upload
**Timeline:** Day 1-2 (Nov 15-16, morning)  
**Owner:** Frontend + Backend pair  
**Goal:** Users can input prompts and upload assets

**Tasks:**
- [ ] Build multi-step prompt form (category, duration, style, constraints)
- [ ] Integrate React Hook Form + Zod validation
- [ ] Create `projects` table CRUD endpoints
- [ ] Implement file upload with signed URLs (S3/R2)
- [ ] Add UploadThing or tus.js for resumable uploads
- [ ] Store asset metadata in `assets` table
- [ ] Basic audio file validation (format, duration)
- [ ] Display uploaded audio waveform (use WaveSurfer.js)
- [ ] Create project dashboard showing all user projects
- [ ] Add authentication (Clerk or Supabase Auth)

**Deliverables:**
- ✅ User can create project with prompt
- ✅ User can upload audio file
- ✅ Assets stored in S3/R2 with URLs in database
- ✅ Project list page showing created projects

**Tech Stack:**
- React Hook Form + Zod
- UploadThing or tus.js
- S3/R2 signed URLs
- Clerk or Supabase Auth
- WaveSurfer.js (audio viz)

---

### PR3: MVP Deterministic Pipeline (Classic Flow)
**Timeline:** Day 2 (Nov 16, afternoon - CRITICAL MVP DEADLINE)  
**Owner:** Backend + ML integration lead  
**Goal:** Generate first end-to-end video for MVP checkpoint

**Tasks:**
- [ ] Implement basic prompt parser (extract mood, style, duration)
- [ ] Create deterministic scene planner (divide duration into 3-5 scenes)
- [ ] Integrate Replicate SDK (start with cheap models: Luma, SDXL Turbo)
- [ ] Write per-scene prompt generator (based on overall prompt + scene position)
- [ ] Call Replicate video generation API for each scene
- [ ] Implement retry logic with exponential backoff
- [ ] Download generated clips to temp storage
- [ ] Use FFmpeg to concatenate clips (simple concat, no transitions yet)
- [ ] Add audio overlay with FFmpeg
- [ ] Upload final video to S3/R2
- [ ] Create job queue with BullMQ/Celery
- [ ] Add job status polling endpoint
- [ ] Build simple progress UI (queued → processing → completed)
- [ ] Generate 2 sample videos for MVP submission

**Deliverables:**
- ✅ **FIRST END-TO-END GENERATED VIDEO**
- ✅ User triggers generation → sees progress → downloads result
- ✅ At least 2 demo videos produced
- ✅ MVP requirements met (3-5 clips, audio sync, consistent style)

**Tech Stack:**
- Replicate Python SDK
- BullMQ (Node) or Celery (Python)
- FFmpeg (video concat, audio mix)
- Librosa (basic beat detection)

**CRITICAL:** This PR must be merged by Sunday morning (48h deadline). Focus on reliability over features.

---

### PR4: Agentic LangGraph Workflow
**Timeline:** Day 3-4 (Nov 17-18)  
**Owner:** Backend + AI/ML lead  
**Goal:** Implement toggleable agentic mode with LangGraph

**Tasks:**
- [ ] Install LangGraph + LangChain dependencies
- [ ] Define `VideoGenerationState` TypedDict
- [ ] Create LangGraph StateGraph with nodes:
  - [ ] `intent_extractor`: Use GPT-4o to analyze prompt deeply
  - [ ] `scene_planner`: Generate scene breakdown with reasoning
  - [ ] `prompt_generator`: Create per-scene prompts
  - [ ] `asset_generator`: Call Replicate (reuse from PR3)
  - [ ] `quality_critic`: Analyze generated scenes for issues
  - [ ] `human_feedback`: Pause for user input
  - [ ] `composer`: Final video stitching
- [ ] Add conditional edges for iteration loop
- [ ] Create toggle UI component (Classic vs Agentic switch)
- [ ] Store mode preference in project config
- [ ] Build chat interface skeleton (send/receive messages)
- [ ] Integrate chat with `human_feedback` node
- [ ] Add LLM streaming for real-time suggestions
- [ ] Create edit instruction parser (e.g., "make scene 2 brighter")
- [ ] Implement partial scene regeneration (only affected scenes)
- [ ] Add iteration counter (max 3 loops before forcing completion)
- [ ] Log LangGraph execution traces to Datadog/Logfire

**Deliverables:**
- ✅ Agentic toggle in UI
- ✅ LangGraph flow executes end-to-end
- ✅ User can chat with system to refine scenes
- ✅ Quality critic provides actionable feedback
- ✅ At least 1 video generated via agentic mode

**Tech Stack:**
- LangGraph (Python)
- OpenAI GPT-4o or Anthropic Claude 3.5 Sonnet
- FastAPI WebSocket for streaming
- Vercel AI SDK (frontend streaming)

---

### PR5: Scene Board & First/Last Frame Control
**Timeline:** Day 4-5 (Nov 18-19)  
**Owner:** Frontend + Backend pair  
**Goal:** Users can view, lock, and override scene frames

**Tasks:**
- [ ] Build timeline/scene board component (horizontal scrolling)
- [ ] Display scene cards with duration, prompt, thumbnail
- [ ] Extract first/last frame from each generated video (FFmpeg)
- [ ] Store frame URLs in `scenes.first_frame_url` / `last_frame_url`
- [ ] Add frame upload UI per scene
- [ ] Create frame override logic:
  - [ ] User uploads custom first/last frame
  - [ ] System regenerates scene with frame conditioning (if model supports)
  - [ ] Fallback: use frame as transition anchor (blend/fade to it)
- [ ] Add frame locking toggle (lock = don't regenerate)
- [ ] Highlight frame conflicts (e.g., last frame of scene 1 doesn't match first of scene 2)
- [ ] Build conflict resolution modal (user chooses which frame to keep)
- [ ] Add transition preview between scenes
- [ ] Implement scene-level regeneration button
- [ ] Show per-scene generation status (pending/processing/completed/failed)

**Deliverables:**
- ✅ Timeline UI showing all scenes
- ✅ First/last frame thumbnails visible
- ✅ User can upload custom frames
- ✅ Locked frames persist across regenerations
- ✅ Smooth transitions between locked frames

**Tech Stack:**
- FFmpeg (frame extraction: `-ss 0 -vframes 1`)
- Sharp or Pillow (image resizing)
- React DnD or custom drag-drop
- Replicate img2video models (for frame conditioning)

---

### PR6: Brand Kit & Asset Management
**Timeline:** Day 5-6 (Nov 19-20)  
**Owner:** Frontend + ML integration  
**Goal:** Support brand assets, color palettes, style consistency

**Tasks:**
- [ ] Create brand kit upload interface (logo, fonts, color palette, style guide)
- [ ] Parse color palette from uploaded images (dominant colors)
- [ ] Store brand assets in `assets` table with type 'brand_kit'
- [ ] Build brand asset gallery in UI
- [ ] Inject brand colors into scene prompts ("using #FF5733 as primary color")
- [ ] Add logo overlay option (position, opacity, duration)
- [ ] Implement style reference image upload
- [ ] Use ControlNet or IP-Adapter for style consistency (if available on Replicate)
- [ ] Create prompt templates for different brand tones (luxury, playful, minimal)
- [ ] Add aspect ratio selector (16:9, 9:16, 1:1) for ad creatives
- [ ] Generate multiple variations (A/B testing) with same prompt, different seeds
- [ ] Build asset browser with search/filter
- [ ] Add asset reuse across projects (library)

**Deliverables:**
- ✅ Brand kit upload working
- ✅ Colors and logos applied to scenes
- ✅ Style consistency improved via reference images
- ✅ Multiple aspect ratios supported
- ✅ A/B test variations generated

**Tech Stack:**
- ColorThief.js or Python colorgram (color extraction)
- FFmpeg overlays (`-filter_complex overlay`)
- Replicate ControlNet/IP-Adapter models
- React virtualized lists (asset gallery)

---

### PR7: Telemetry, Cost Tracking & Progress Dashboard
**Timeline:** Day 6-7 (Nov 20-21)  
**Owner:** Backend + DevOps  
**Goal:** Observability, cost transparency, real-time progress

**Tasks:**
- [ ] Instrument all API calls with OpenTelemetry
- [ ] Send traces to Datadog or Logfire
- [ ] Track cost per Replicate API call
- [ ] Store cumulative cost in `jobs.cost_usd`
- [ ] Build cost dashboard UI (per project, per video)
- [ ] Add cost breakdown by model type (video/image/audio/LLM)
- [ ] Implement budget alerts (warn at 50%, block at 100%)
- [ ] Create real-time progress WebSocket
- [ ] Emit events: job_started, scene_started, scene_completed, job_completed
- [ ] Display progress bar with current stage ("Generating scene 2/5")
- [ ] Show ETA based on historical timings
- [ ] Add generation history (list of all past jobs)
- [ ] Create performance metrics dashboard (avg time per video, success rate)
- [ ] Log structured events for debugging (scene prompts, model params, errors)
- [ ] Set up Sentry alerts for failed jobs
- [ ] Add retry button for failed jobs

**Deliverables:**
- ✅ Cost dashboard showing per-video breakdown
- ✅ Real-time progress updates via WebSocket
- ✅ Structured logs in Datadog/Logfire
- ✅ Performance metrics visible to judges
- ✅ Budget enforcement prevents runaway costs

**Tech Stack:**
- OpenTelemetry (tracing)
- Datadog or Logfire (observability)
- Socket.IO or Pusher (real-time)
- Recharts or Chart.js (dashboard graphs)
- Sentry (error tracking)

---

### PR8: Quality Polish & Final Optimizations
**Timeline:** Day 7-8 (Nov 21-22)  
**Owner:** Full team  
**Goal:** Production-ready quality for final submission

**Tasks:**
- [ ] Upgrade to premium Replicate models for final videos (Runway Gen-3, Flux)
- [ ] Implement advanced beat detection with Librosa (onset detection, tempo analysis)
- [ ] Align scene transitions precisely to beats
- [ ] Add 10+ transition types (crossfade, wipe, zoom, blur, glitch)
- [ ] Apply cinematic color grading (LUTs via FFmpeg)
- [ ] Create transition templates (match cut, L-cut, J-cut for audio)
- [ ] Implement motion smoothing between scenes
- [ ] Add text overlay engine (titles, captions, CTAs)
- [ ] Support custom fonts from brand kit
- [ ] Optimize caching strategy (aggressive cache hits for identical prompts)
- [ ] Add seed locking for reproducible generation
- [ ] Implement video quality presets (draft/preview/final)
- [ ] Create export options (MP4/WebM, resolution, bitrate)
- [ ] Add watermark removal logic (if using free tiers)
- [ ] Build sample video gallery on landing page
- [ ] Write comprehensive API documentation
- [ ] Record demo video (5-7 min walkthrough)
- [ ] Generate 3+ showcase videos for submission
- [ ] Polish UI (animations, loading states, error messages)
- [ ] Add keyboard shortcuts (space = play/pause, arrow keys = scrub)
- [ ] Implement video thumbnail generation for scene board
- [ ] Add social sharing (Twitter/LinkedIn cards with video preview)

**Deliverables:**
- ✅ **3+ production-quality showcase videos**
- ✅ Beat-perfect transitions
- ✅ Professional color grading applied
- ✅ Text overlays working
- ✅ Export in multiple formats
- ✅ Demo video recorded
- ✅ API docs complete
- ✅ Landing page polished

**Tech Stack:**
- FFmpeg advanced filters (xfade, curves, lut3d)
- Librosa (beat tracking)
- Remotion (optional, for React-based text overlays)
- Cinema LUTs (free packs from RocketStock)

---

## Development Workflow

### Daily Standup Format
- **What shipped yesterday?** (link to merged PR)
- **What's shipping today?** (PR in progress)
- **Blockers?** (API rate limits, model availability, cost concerns)

### Branch Strategy
```
main (production, always deployable)
  ├─ develop (integration branch)
      ├─ feature/pr1-scaffolding
      ├─ feature/pr2-upload
      ├─ feature/pr3-mvp-pipeline
      ├─ feature/pr4-agentic
      ├─ feature/pr5-scene-board
      ├─ feature/pr6-brand-kit
      ├─ feature/pr7-telemetry
      └─ feature/pr8-polish
```

### PR Review Checklist
- [ ] Code passes linting (ESLint/Ruff)
- [ ] TypeScript/mypy type checks pass
- [ ] Unit tests added (if applicable)
- [ ] Manual testing completed
- [ ] No new Sentry errors
- [ ] Cost impact assessed (if touching Replicate)
- [ ] Documentation updated
- [ ] Demo video clip recorded (for major features)

### Environment Strategy
- **Local:** Docker Compose (Postgres, Redis, FFmpeg), `.env.local`
- **Staging:** Railway/Render deployment, connected to Supabase staging project
- **Production:** Same as staging, but with prod database and higher rate limits

---

## Cost & Performance Targets

### Cost Breakdown (Target: <$2.00 per 60s video)

| Component | Model/Service | Cost per Call | Calls per 60s Video | Subtotal |
|-----------|--------------|---------------|---------------------|----------|
| Scene Planning (LLM) | GPT-4o-mini | $0.0001/token (~500 tokens) | 1 | $0.05 |
| Image Generation (keyframes) | SDXL Turbo | $0.002/image | 5 scenes × 2 frames | $0.02 |
| Video Generation | Luma (preview) → Runway (final) | $0.03/sec → $0.50/sec | 60 sec (using 40s Luma + 20s Runway) | $1.20 + $10 = $11.20 |
| Audio (if generated) | Suno | $0.10/30sec | 2 clips | $0.20 |
| Quality Critic (LLM) | GPT-4o-mini | $0.0001/token (~300 tokens) | 3 iterations | $0.09 |
| **Total (Preview Mode)** | | | | **~$1.56** ✅ |
| **Total (Final Mode)** | | | | **~$11.54** ⚠️ |

**Strategy:**
- Use cheap models (Luma, SDXL Turbo) for iteration/preview
- Switch to premium models (Runway Gen-3) only for final render
- Aggressive caching (cache hit = $0 cost)
- Offer "draft mode" (lower res, faster, cheaper) vs "final mode"

### Performance Targets

| Video Length | Draft Mode (cheap models) | Final Mode (premium models) |
|--------------|---------------------------|------------------------------|
| 30 seconds | <3 minutes | <5 minutes |
| 60 seconds | <6 minutes | <10 minutes |
| 180 seconds | <15 minutes | <20 minutes |

**Optimization Strategies:**
- Parallel scene generation (BullMQ concurrency = 3)
- Pre-warm model instances (if Replicate supports)
- Cache prompt embeddings for similarity matching
- Use video upscaling models instead of generating at high res

---

## Testing Strategy

### Unit Tests
- Prompt parser (input → structured scene plan)
- Cost calculator (API call → cost accumulation)
- Beat detection (audio file → beat timestamps)
- Frame extractor (video → first/last frame images)

### Integration Tests
- Full pipeline smoke test (prompt → video URL)
- Scene regeneration (update scene 2 → only scene 2 regenerates)
- Agentic loop (critic finds issue → user edits → regenerates)
- Cache hit/miss (same prompt twice → second is instant)

### E2E Tests (Playwright)
```typescript
// e2e/generate-video.spec.ts
test('user can generate music video', async ({ page }) => {
  await page.goto('/dashboard');
  await page.click('text=New Project');
  await page.fill('[name=prompt]', 'cyberpunk music video with neon lights');
  await page.selectOption('[name=category]', 'music_video');
  await page.setInputFiles('[name=audio]', 'fixtures/song.mp3');
  await page.click('text=Generate');
  await page.waitForSelector('text=Completed', { timeout: 600000 }); // 10 min
  await expect(page.locator('video')).toBeVisible();
});
```

### Load Tests (k6)
```javascript
// load-test.js
import http from 'k6/http';
export let options = {
  vus: 10, // 10 concurrent users
  duration: '5m',
};
export default function() {
  http.post('https://api.example.com/api/projects', {
    prompt: 'test video',
    category: 'music_video',
  });
}
```

### Manual QA Checklist (Before Submission)
- [ ] Generate video in both Classic and Agentic modes
- [ ] Upload custom first/last frames and verify they're preserved
- [ ] Test chat-based edit loop (send 3 edit requests)
- [ ] Regenerate one scene mid-project
- [ ] Upload brand kit and verify colors appear in scenes
- [ ] Export video in 3 aspect ratios (16:9, 9:16, 1:1)
- [ ] Trigger failure scenario (invalid audio file) and verify error handling
- [ ] Check cost dashboard shows accurate totals
- [ ] Test on mobile (responsive UI)
- [ ] Verify all sample videos play in judges' browsers

---

## Submission Checklist

### Code & Deployment
- [ ] GitHub repo public with clear README
- [ ] All PRs merged to `main`
- [ ] Live deployment URL (Vercel + Railway/Render)
- [ ] API docs published (Scalar/Swagger)
- [ ] Test credentials provided for judges
- [ ] Rate limits documented

### Documentation
- [ ] Architecture diagram (update this doc with final architecture)
- [ ] Tech stack justification (1 page)
- [ ] Cost analysis (actual costs from production runs)
- [ ] Performance benchmarks (generation times per video length)
- [ ] Troubleshooting guide

### Videos
- [ ] Demo video (5-7 min) showing:
  - Prompt → video flow
  - Agentic toggle + chat edits
  - Asset upload + frame control
  - Cost dashboard
  - Final video export
- [ ] 3+ showcase videos:
  - 1 upbeat music video (beat-synced)
  - 1 slow/emotional music video
  - 1 ad creative (if supporting multiple categories)

### Technical Deep Dive (1 page)
Answer these questions:
1. **Visual coherence:** How do you ensure consistent style across clips?
   - Seed locking, style reference images, brand color injection, ControlNet
2. **Audio-visual sync:** How do you align transitions to beats?
   - Librosa onset detection, scene duration snapping to beat grid
3. **Cost optimization:** How do you stay under $2/min?
   - Cheap models for preview, caching, draft mode, parallel generation
4. **Failure handling:** How do you handle generation errors?
   - Retry with exponential backoff, fallback models, partial regeneration
5. **Competitive advantage:** What makes your pipeline better?
   - Agentic mode, frame control, brand kit integration, real-time collaboration

---

## Risk Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Replicate API downtime | High | Low | Implement fallback models, cache aggressively, retry logic |
| Model output inconsistency | High | Medium | Use seed locking, style embeddings, QA critic node |
| Cost overruns | High | Medium | Budget alerts, draft mode, cost dashboard, cache everything |
| Slow generation times | Medium | Medium | Parallel processing, pre-warm instances, optimize prompts |
| Complex UX confuses users | Medium | Low | Progressive disclosure, tooltips, onboarding tour |
| FFmpeg bugs/crashes | Medium | Low | Extensive testing, fallback to simpler concat, error logging |
| LangGraph loop gets stuck | Medium | Low | Max iteration limit, timeout on human_feedback node |
| Missing MVP deadline | Critical | Low | Focus on PR3, cut features if needed, timebox to 48h |

---

## Next Steps

### Immediate Actions (Today)
1. **Assign PR ownership** (who owns each PR)
2. **Set up dev environment** (run PR1 tasks)
3. **Order Replicate credits** (estimate $500-1000 for development + finals)
4. **Create project timeline** (Gantt chart with PR deadlines)
5. **Start PR2** (prompt form + upload) in parallel with PR1 finalization

### Daily Milestones
- **Day 0 (Nov 14):** PR1 merged, dev environment working
- **Day 1 (Nov 15):** PR2 merged, can upload audio + prompt
- **Day 2 (Nov 16, 12PM):** **MVP DEADLINE** - PR3 merged, first video generated
- **Day 3 (Nov 17):** PR4 merged, agentic mode working
- **Day 4 (Nov 18):** PR5 merged, scene board + frames
- **Day 5 (Nov 19):** PR6 merged, brand kit support
- **Day 6 (Nov 20):** PR7 merged, telemetry + cost tracking
- **Day 7-8 (Nov 21-22):** PR8 merged, showcase videos produced
- **Day 9 (Nov 23):** Demo video recorded, submission complete

### Communication
- **Slack/Discord:** Real-time coordination
- **GitHub Projects:** Track PR progress
- **Daily video sync:** 15 min standup at 9 AM
- **Demo dry run:** Nov 22, 8 PM (practice demo for feedback)

---

## Conclusion

This plan balances **speed** (MVP in 48h), **quality** (agentic workflow, frame control), and **cost** (smart caching, draft mode). The PR-by-PR structure ensures steady progress with clear milestones.

**Key Success Factors:**
1. **Hit MVP deadline** (PR3 by Sunday noon) - no excuses
2. **Use cheap models early** (iterate fast, switch to premium for finals)
3. **Agentic mode as differentiator** (LangGraph + chat edits = competitive edge)
4. **Ruthless prioritization** (cut features if behind schedule)

**Remember:** A simple pipeline that generates ONE category beautifully beats a complex system that does everything poorly. Focus on music videos OR ad creatives, nail that, then expand if time permits.

Let's build something amazing. 🚀

