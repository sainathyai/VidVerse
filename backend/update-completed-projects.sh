#!/bin/bash
# Script to update projects with final video URLs to completed status
# Uses PostgreSQL Docker container with --rm flag to connect to AWS RDS

set -e

DATABASE_URL="${DATABASE_URL:-}"

if [ -z "$DATABASE_URL" ]; then
    echo "Error: DATABASE_URL not provided. Please set it as an environment variable or export it."
    echo "Usage: DATABASE_URL='postgresql://user:pass@host:5432/db?sslmode=require' ./update-completed-projects.sh"
    exit 1
fi

# Parse DATABASE_URL
# Format: postgresql://USERNAME:PASSWORD@HOST:PORT/DATABASE?sslmode=require
if [[ $DATABASE_URL =~ postgresql://([^:]+):([^@]+)@([^:]+):([0-9]+)/([^?]+) ]]; then
    DB_USER="${BASH_REMATCH[1]}"
    DB_PASSWORD="${BASH_REMATCH[2]}"
    DB_HOST="${BASH_REMATCH[3]}"
    DB_PORT="${BASH_REMATCH[4]}"
    DB_NAME="${BASH_REMATCH[5]}"
else
    echo "Error: Invalid DATABASE_URL format. Expected: postgresql://user:pass@host:port/db"
    exit 1
fi

echo "Connecting to database: $DB_HOST:$DB_PORT/$DB_NAME"
echo ""

# Get the directory where the script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_FILE="$SCRIPT_DIR/update-completed-projects.sql"

if [ ! -f "$SQL_FILE" ]; then
    echo "Error: SQL file not found at $SQL_FILE"
    exit 1
fi

echo "Executing SQL update..."

# Run PostgreSQL container with --rm flag
# Mount the SQL file and execute it
docker run --rm \
    -v "$SQL_FILE:/tmp/update.sql:ro" \
    -e PGPASSWORD="$DB_PASSWORD" \
    postgres:latest \
    psql \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    -v ON_ERROR_STOP=1 \
    -f /tmp/update.sql

if [ $? -eq 0 ]; then
    echo ""
    echo "✓ Successfully updated projects!"
else
    echo ""
    echo "✗ Error executing SQL"
    exit 1
fi

echo ""
echo "Done!"

