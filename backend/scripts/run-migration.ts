import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Pool } from 'pg';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function runMigration() {
  const connectionString = process.env.DATABASE_URL;
  
  if (!connectionString) {
    console.error('DATABASE_URL not found in environment variables');
    process.exit(1);
  }

  // Remove sslmode from connection string if present
  let cleanConnectionString = connectionString.replace(/[?&]sslmode=[^&]*/g, '');
  
  const pool = new Pool({
    connectionString: cleanConnectionString,
    ssl: process.env.DATABASE_SSL === 'true' ? {
      rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false',
      ...(process.env.DATABASE_SSL_CA_PATH && {
        ca: readFileSync(resolve(process.cwd(), process.env.DATABASE_SSL_CA_PATH), 'utf-8'),
      }),
    } : false,
  });

  try {
    console.log('Connecting to database...');
    const client = await pool.connect();
    console.log('Connected successfully!');

    // Read migration file - use command line argument or default to latest
    const migrationFile = process.argv[2] || '002_add_name_and_users.sql';
    const migrationPath = resolve(__dirname, '../../migrations', migrationFile);
    console.log(`Reading migration file: ${migrationPath}`);
    const migrationSQL = readFileSync(migrationPath, 'utf-8');

    console.log('Running migration...');
    await client.query(migrationSQL);
    console.log('✅ Migration completed successfully!');

    client.release();
    await pool.end();
    process.exit(0);
  } catch (error: any) {
    console.error('❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

runMigration();

