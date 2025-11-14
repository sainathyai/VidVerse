# VidVerse - AI Video Generation Pipeline

> An intelligent AI-powered video generation platform with agentic capabilities, supporting music videos and ad creatives with LangGraph orchestration.

## 🚀 Overview

VidVerse is an end-to-end AI video generation pipeline that transforms user prompts into professional-quality videos. Built with Next.js 15, LangGraph, and Replicate API, it offers both classic deterministic workflows and advanced agentic modes for iterative refinement.

### Key Features

- 🎬 **Multi-Category Support**: Music videos (beat-synced) and ad creatives
- 🤖 **Agentic Workflow**: LangGraph-powered iterative refinement with user feedback
- 🎨 **Asset Management**: Upload audio, images, brand kits, and control first/last frames per scene
- 💰 **Cost Tracking**: Real-time cost monitoring and budget controls
- ⚡ **Fast Generation**: Parallel processing with smart caching
- 🎯 **Scene Control**: Timeline editor with frame locking and regeneration

## 📋 Tech Stack

### Frontend
- **Framework**: Next.js 15 (App Router) with React Server Components
- **Styling**: Tailwind CSS v4 + shadcn/ui
- **State**: Zustand + TanStack Query
- **Forms**: React Hook Form + Zod
- **Real-time**: Socket.IO / Pusher

### Backend
- **Runtime**: Node.js 20 LTS + TypeScript
- **API**: Fastify v4
- **Agentic**: LangGraph (Python) + FastAPI
- **Queue**: BullMQ (Node) / Celery (Python)
- **Auth**: Clerk / Supabase Auth

### Infrastructure
- **Database**: PostgreSQL (Supabase)
- **Cache**: Redis (Upstash)
- **Storage**: S3 / Cloudflare R2
- **AI Models**: Replicate API (Runway, Pika, Luma, Suno)
- **Media**: FFmpeg, Librosa

## 🏗️ Project Structure

```
VidVerse/
├── frontend/          # Next.js 15 application
├── backend/           # Fastify API server
├── agentic/           # LangGraph Python service
├── docker/            # Docker configurations
├── migrations/        # Database migrations
└── .github/           # CI/CD workflows
```

## 🚦 Getting Started

### Prerequisites

- Node.js 20+ and npm/yarn/pnpm
- Python 3.11+ (for agentic service)
- Docker & Docker Compose
- Git

### Installation

1. **Clone the repository**
   ```bash
   git clone git@github.com:sainathyai/VidVerse.git
   cd VidVerse
   ```

2. **Install dependencies**
   ```bash
   # Frontend
   cd frontend
   npm install

   # Backend
   cd ../backend
   npm install

   # Agentic service (Python)
   cd ../agentic
   pip install -r requirements.txt
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your API keys
   ```

4. **Start local development**
   ```bash
   # Start Docker services (Postgres, Redis)
   docker-compose up -d

   # Run database migrations
   npm run db:migrate

   # Start frontend (port 3000)
   cd frontend && npm run dev

   # Start backend (port 3001)
   cd backend && npm run dev

   # Start agentic service (port 8000)
   cd agentic && uvicorn main:app --reload
   ```

5. **Visit the application**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:3001
   - API Docs: http://localhost:3001/docs

## 📚 Documentation

- [Implementation Plan](./IMPLEMENTATION_PLAN.md) - Complete PR-by-PR implementation strategy
- [Architecture](./ARCHITECTURE.md) - System architecture and design decisions
- [API Documentation](./docs/API.md) - API endpoints and schemas
- [Database Schema](./migrations/README.md) - Database structure and migrations

## 🧪 Testing

```bash
# Run all tests
npm test

# Frontend tests
cd frontend && npm test

# Backend tests
cd backend && npm test

# E2E tests
npm run test:e2e
```

## 🚢 Deployment

### Frontend (Vercel)
```bash
cd frontend
vercel deploy
```

### Backend (Railway/Render)
```bash
cd backend
# Deploy via Railway CLI or Render dashboard
```

### Environment Variables
See `.env.example` for required environment variables.

## 📊 Cost & Performance

- **Target Cost**: <$2.00 per 60-second video (draft mode)
- **Generation Time**: <10 minutes for 60-second video
- **Success Rate**: >90%

## 🤝 Contributing

1. Create a feature branch from `develop`
2. Make your changes
3. Write/update tests
4. Submit a PR with clear description

## 📝 License

MIT License - see LICENSE file for details

## 🙏 Acknowledgments

- Replicate for AI model APIs
- LangChain/LangGraph for agentic workflows
- Next.js team for the amazing framework

---

**Built with ❤️ for the GauntletAI Week 6 Challenge**

