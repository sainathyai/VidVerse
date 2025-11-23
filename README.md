# VidVerse - AI Video Generation Pipeline

A comprehensive end-to-end AI video generation platform that transforms text prompts into professional-quality video content with synchronized audio, multi-scene composition, and intelligent scene planning.

## 🎯 Overview

VidVerse is a full-stack application that enables users to create professional videos from natural language prompts. The platform supports multiple video categories including music videos and ad creatives, with features like asset management, scene planning, AI-powered script generation, and real-time video preview.

## ✨ Key Features

### 🎬 Video Generation
- **Multi-Model Support**: Integration with Replicate API supporting multiple video generation models (Sora, Veo, Kling, etc.)
- **Scene-Based Composition**: Intelligent scene planning and multi-clip video composition
- **Audio Synchronization**: Beat detection and audio-visual sync for music videos
- **Thumbnail Generation**: Automatic thumbnail extraction from video first frames
- **Real-Time Progress Tracking**: Live updates on video generation progress
- **Video Preview & Playback**: Built-in video player with modal preview

### 🚀 Quick Create
- **AI Script Generation**: Generate complete video scripts from concept descriptions using Claude Sonnet 4.5
- **Project Import**: Import generated scripts with assets, scenes, and music into new projects
- **Modal Interface**: Beautiful, glossy UI with dark theme for quick project creation

### 📊 Project Management
- **Dashboard**: Comprehensive project dashboard with statistics and filtering
- **Project Tiles**: Visual project cards with thumbnails, status badges, and metadata
- **Status Tracking**: Track projects through draft, pending, completed, and failed states
- **Category Support**: Organize projects by category (music_video, ad_creative, explainer)
- **Search & Filter**: Search projects by name and filter by status/category

### 🎨 User Interface
- **Modern React UI**: Built with React 18, TypeScript, and Tailwind CSS
- **Responsive Design**: Mobile-friendly interface with adaptive layouts
- **Dark Theme**: Beautiful dark theme with gradient accents
- **Component Library**: Reusable UI components (buttons, cards, badges, modals)
- **Real-Time Updates**: Hot Module Replacement (HMR) for instant development feedback

### 🔐 Authentication & Security
- **AWS Cognito Integration**: Secure user authentication with AWS Cognito
- **JWT Token Management**: Secure token-based authentication
- **Protected Routes**: Route protection for authenticated users
- **Session Management**: Secure session handling with OIDC

### 📁 Asset Management
- **File Upload**: Support for audio, image, and video file uploads
- **S3 Storage**: AWS S3 integration for secure asset storage
- **Presigned URLs**: Secure, time-limited access to assets
- **Asset Organization**: Organize assets by project and type

### 💬 AI Chat Integration
- **Project Refinement**: Chat interface for iterating on video projects
- **Context-Aware**: AI understands project context and provides relevant suggestions
- **Script Editing**: Modify scripts and prompts through conversational interface

### 🎵 Audio Features
- **Audio Waveform Visualization**: Visual representation of audio tracks
- **Beat Detection**: Analyze audio for tempo and beat alignment
- **Music Generation**: Integration with music generation services

### 🗄️ Database & Storage
- **PostgreSQL**: Robust relational database for project data
- **Database Migrations**: Version-controlled schema migrations
- **Redis Integration**: Job queue management with Redis and BullMQ
- **S3 Integration**: Scalable cloud storage for videos and assets

### 🐳 DevOps & Infrastructure
- **Docker Compose**: Local development environment with PostgreSQL, Redis, and MinIO
- **Docker Support**: Containerized backend and frontend applications
- **AWS ECS**: CloudFormation templates for AWS deployment
- **Environment Configuration**: Flexible environment-based configuration

## 🏗️ Architecture

### Backend
- **Framework**: Fastify (high-performance Node.js web framework)
- **Language**: TypeScript
- **Database**: PostgreSQL with connection pooling
- **Job Queue**: BullMQ with Redis
- **Storage**: AWS S3 with presigned URLs
- **Authentication**: AWS Cognito with JWT verification
- **API**: RESTful API with Swagger documentation

### Frontend
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite 6
- **Styling**: Tailwind CSS with custom animations
- **Routing**: React Router v6
- **State Management**: React Hooks, Zustand, React Query
- **UI Components**: Custom component library with shadcn/ui patterns

### Services
- **Video Processing**: FFmpeg integration for video composition
- **AI Integration**: Replicate API for video/image generation
- **Chat AI**: Claude Sonnet 4.5 for script generation and refinement
- **Storage Service**: S3 client with presigned URL generation
- **Scene Planner**: Intelligent scene planning and timing

## 📦 Installation

### Prerequisites
- Node.js >= 20.0.0
- Docker and Docker Compose
- PostgreSQL 15+ (or use Docker)
- Redis 7+ (or use Docker)
- AWS Account (for S3 and Cognito)

### Setup

1. **Clone the repository**
```bash
git clone <repository-url>
cd Week6
```

2. **Install dependencies**
```bash
# Install root dependencies
npm install

# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

3. **Configure environment variables**

Backend (create `backend/.env`):
```env
# Database
DATABASE_URL=postgresql://vidverse:vidverse_dev@localhost:5432/vidverse

# Redis
REDIS_URL=redis://localhost:6379

# AWS
AWS_REGION=us-west-2
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
S3_BUCKET_NAME=vidverse-assets
S3_USE_PRESIGNED_URLS=true

# Cognito
COGNITO_USER_POOL_ID=your_user_pool_id
COGNITO_CLIENT_ID=your_client_id
COGNITO_REGION=us-west-2

# Replicate
REPLICATE_API_TOKEN=your_replicate_token

# Server
PORT=3001
NODE_ENV=development
```

Frontend (create `frontend/.env`):
```env
VITE_API_URL=http://localhost:3001
VITE_COGNITO_USER_POOL_ID=your_user_pool_id
VITE_COGNITO_CLIENT_ID=your_client_id
VITE_COGNITO_REGION=us-west-2
```

4. **Start Docker services**
```bash
docker-compose up -d
```

This will start:
- PostgreSQL on port 5432
- Redis on port 6379
- MinIO (optional S3-compatible storage) on ports 9000-9001

5. **Run database migrations**
Migrations run automatically when PostgreSQL container starts. For manual execution:
```bash
cd backend
npm run db:migrate
```

6. **Start development servers**

Backend:
```bash
cd backend
npm run dev
```

Frontend:
```bash
cd frontend
npm run dev
```

The application will be available at:
- Frontend: http://localhost:3000
- Backend API: http://localhost:3001
- API Documentation: http://localhost:3001/docs

## 🚀 Usage

### Creating a Project

1. **Quick Create** (Recommended for beginners):
   - Click "Quick Create" button or tile on dashboard
   - Enter a video concept description
   - AI generates a complete script with scenes, assets, and music
   - Review and import the generated project

2. **Advanced Project** (For experienced users):
   - Navigate to "Advanced Project"
   - Manually configure project settings
   - Upload assets, define scenes, and set parameters

### Video Generation Workflow

1. **Create/Select Project**: Start a new project or continue an existing one
2. **Configure Settings**: Set category, duration, style, and other parameters
3. **Upload Assets**: Add audio tracks, images, or reference videos
4. **Generate Script**: Use AI to generate or refine your script
5. **Review Scenes**: Preview scene breakdown and timing
6. **Generate Video**: Start video generation and track progress
7. **Preview & Edit**: Review generated video and make adjustments
8. **Export**: Download final video in desired format

### Dashboard Features

- **View All Projects**: See all your projects in a grid layout
- **Filter Projects**: Filter by status (completed, draft, pending, failed) or category
- **Search Projects**: Search projects by name
- **View Statistics**: See total projects, completed count, and success rate
- **Quick Actions**: Access quick create, advanced project creation, and project management

## 📚 API Documentation

The API documentation is available at `/docs` when the backend server is running. The API includes:

### Projects
- `GET /api/projects` - List all projects
- `POST /api/projects` - Create new project
- `GET /api/projects/:id` - Get project details
- `PUT /api/projects/:id` - Update project
- `DELETE /api/projects/:id` - Delete project

### Assets
- `POST /api/assets` - Upload asset
- `GET /api/assets/:id` - Get asset details
- `GET /api/assets/upload-url` - Get presigned upload URL

### Chat
- `POST /api/chat` - Send message to AI chat
- `GET /api/chat/conversations` - List conversations

### Jobs
- `GET /api/jobs` - List generation jobs
- `GET /api/jobs/:id` - Get job status

## 🗄️ Database Schema

### Projects
- Project metadata, prompts, status, category
- Links to scenes, assets, and final video
- Supports both classic and agentic modes

### Scenes
- Individual scenes within projects
- Timing, prompts, generated video URLs
- First/last frame references for transitions

### Assets
- User-uploaded files (audio, images, videos)
- Metadata and S3 storage references
- Linked to projects

### Jobs
- Video generation job tracking
- Progress, cost, status
- Error logging and retry information

## 🔧 Development

### Project Structure
```
Week6/
├── backend/          # Backend API server
│   ├── src/
│   │   ├── routes/   # API route handlers
│   │   ├── services/ # Business logic
│   │   ├── workers/  # Background job workers
│   │   └── middleware/ # Auth and other middleware
│   └── package.json
├── frontend/         # React frontend application
│   ├── src/
│   │   ├── pages/    # Page components
│   │   ├── components/ # Reusable components
│   │   └── lib/      # Utilities and helpers
│   └── package.json
├── migrations/       # Database migration files
├── infrastructure/  # AWS CloudFormation templates
└── docker-compose.yml
```

### Available Scripts

**Backend:**
- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run type-check` - TypeScript type checking
- `npm run db:migrate` - Run database migrations

**Frontend:**
- `npm run dev` - Start Vite dev server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint

### Code Style
- TypeScript strict mode enabled
- ESLint for code quality
- Prettier for code formatting (recommended)
- Component-based architecture
- Service layer pattern for business logic

## 🧪 Testing

```bash
# Backend tests
cd backend
npm test

# Frontend tests (when implemented)
cd frontend
npm test
```

## 🚢 Deployment

### Docker Deployment

Build and run with Docker:
```bash
# Build images
docker build -t vidverse-backend ./backend
docker build -t vidverse-frontend ./frontend

# Run with docker-compose
docker-compose up -d
```

### AWS Deployment

Use the CloudFormation templates in `infrastructure/`:
```bash
aws cloudformation create-stack \
  --stack-name vidverse \
  --template-body file://infrastructure/cloudformation-ecs.yaml \
  --parameters file://infrastructure/stack-parameters.json
```

## 🤝 Contributing

1. Create a feature branch from `main`
2. Make your changes
3. Test thoroughly
4. Commit with descriptive messages
5. Push and create a pull request

## 📝 Recent Updates

### Latest Features (v0.1.0)
- ✅ Thumbnail generation from video first frames
- ✅ Quick Create modal with AI script generation
- ✅ Enhanced dashboard with project tiles and thumbnails
- ✅ Video player modal for preview
- ✅ Presigned URL handling for S3 assets
- ✅ Improved error handling and logging
- ✅ Database migrations for thumbnail support
- ✅ Glossy UI styling with dark theme

## 🐛 Known Issues

- WebSocket connection may require browser refresh on first load
- Large video files may take time to process
- Some AI models may have rate limits

## 📄 License

[Add your license information here]

## 👥 Team

[Add team information here]

## 🙏 Acknowledgments

- Replicate for AI model APIs
- AWS for infrastructure services
- Fastify and React communities
- All open-source contributors

---

**Built with ❤️ for AI video generation**


