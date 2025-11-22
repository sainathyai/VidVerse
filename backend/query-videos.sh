#!/bin/bash
# Query RDS database for videos generated for a specific project
# Usage: ./query-videos.sh <projectId>

set -e

PROJECT_ID="${1:-e9731679-e3ad-4412-ae67-aa1513065d35}"

# Load DATABASE_URL from .env file
if [ -f .env ]; then
  export $(grep -v '^#' .env | grep DATABASE_URL | xargs)
fi

if [ -z "$DATABASE_URL" ]; then
  echo "Error: DATABASE_URL not found. Please set it in .env or as environment variable."
  exit 1
fi

# Parse DATABASE_URL
# Format: postgresql://USERNAME:PASSWORD@ENDPOINT:PORT/DATABASE?sslmode=require
USERNAME=$(echo $DATABASE_URL | sed -n 's/.*:\/\/\([^:]*\):.*/\1/p')
PASSWORD=$(echo $DATABASE_URL | sed -n 's/.*:\/\/[^:]*:\([^@]*\)@.*/\1/p')
HOST=$(echo $DATABASE_URL | sed -n 's/.*@\([^:]*\):.*/\1/p')
PORT=$(echo $DATABASE_URL | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
DATABASE=$(echo $DATABASE_URL | sed -n 's/.*\/\([^?]*\).*/\1/p')

echo "Querying RDS for project: $PROJECT_ID"
echo "Host: $HOST"
echo "Database: $DATABASE"
echo ""

# Check if SSL certificate exists
CERT_PATH="./certs/rds-ca-rsa2048-g1.pem"
SSL_OPTS=""
if [ -f "$CERT_PATH" ]; then
  SSL_OPTS="-v $(pwd)/$CERT_PATH:/root/.postgresql/root.crt:ro"
  SSL_MODE="sslmode=verify-ca sslrootcert=/root/.postgresql/root.crt"
else
  SSL_MODE="sslmode=require"
fi

# SQL query
SQL_QUERY="
SELECT 
  p.id as project_id,
  p.name as project_name,
  p.status as project_status,
  s.id as scene_id,
  s.scene_number,
  s.video_url,
  s.thumbnail_url,
  s.first_frame_url,
  s.last_frame_url,
  s.asset_id,
  s.duration,
  s.start_time,
  s.metadata as scene_metadata,
  a.id as asset_id,
  a.type as asset_type,
  a.url as asset_url,
  j.id as job_id,
  j.type as job_type,
  j.status as job_status,
  j.progress,
  j.current_stage,
  j.error,
  j.completed_at
FROM projects p
LEFT JOIN scenes s ON s.project_id = p.id
LEFT JOIN assets a ON a.project_id = p.id AND a.type = 'video'
LEFT JOIN jobs j ON j.project_id = p.id
WHERE p.id = '$PROJECT_ID'
ORDER BY s.scene_number ASC, j.created_at DESC;
"

# Run query using Docker
docker run --rm \
  -e PGPASSWORD="$PASSWORD" \
  $SSL_OPTS \
  postgres:15-alpine \
  psql \
  -h "$HOST" \
  -p "$PORT" \
  -U "$USERNAME" \
  -d "$DATABASE" \
  -c "$SSL_MODE" \
  -c "$SQL_QUERY"

