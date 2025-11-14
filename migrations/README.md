# Database Migrations

This directory contains SQL migration files for the VidVerse database schema.

## Running Migrations

### Using Docker Compose (Recommended)

Migrations are automatically run when the Postgres container starts for the first time. The `docker-compose.yml` mounts this directory to `/docker-entrypoint-initdb.d/`, which PostgreSQL executes on initialization.

### Manual Migration

If you need to run migrations manually:

```bash
# Connect to database
psql -h localhost -U vidverse -d vidverse

# Run migration
\i migrations/001_initial_schema.sql
```

### Using Migration Tool (Future)

We'll add a migration tool like `node-pg-migrate` or `Prisma Migrate` in a future PR.

## Migration Files

- `001_initial_schema.sql` - Initial schema with projects, scenes, assets, and jobs tables

## Schema Overview

### Projects
Stores user projects with prompts, category, mode (classic/agentic), and status.

### Scenes
Individual scenes within a project, with timing, frames, and generated video URLs.

### Assets
User-uploaded assets (audio, images, videos, brand kits) linked to projects.

### Jobs
Generation jobs tracking progress, cost, and results.

## Adding New Migrations

1. Create a new file: `002_description.sql`
2. Use numbered prefixes for ordering
3. Include both `CREATE` and `DROP` statements for rollback
4. Test migrations on a copy of production data
5. Document breaking changes in migration comments

