import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { Pool, type PoolConfig } from 'pg';
import { config } from '../config';

let pool: Pool | null = null;

export function getDatabasePool(): Pool {
  if (!pool) {
    // Check if connection string requires SSL
    let connectionString = config.database.url;
    const requiresSSL = connectionString.includes('sslmode=require') || connectionString.includes('sslmode=prefer');
    // Remove sslmode from connection string if present - we'll handle SSL via config
    connectionString = connectionString.replace(/[?&]sslmode=[^&]*/g, '');
    
    const poolConfig: PoolConfig = {
      connectionString: connectionString,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 30000, // Increased from 2000ms to 30s for RDS connections
    };

    // Enable SSL if explicitly configured OR if connection string requires it
    if (config.database.ssl || requiresSSL) {
      const sslConfig: any = {
        rejectUnauthorized: config.database.sslRejectUnauthorized,
      };

      if (config.database.sslCaPath) {
        // Resolve certificate path - handle both relative and absolute paths
        let certPath = config.database.sslCaPath;
        if (!certPath.startsWith('/') && !certPath.match(/^[A-Z]:/)) {
          // Relative path - try multiple resolution strategies
          // First try from process.cwd() (backend directory when running)
          const cwdPath = resolve(process.cwd(), certPath);
          // Also try from __dirname (compiled output or source)
          const dirnamePath = resolve(__dirname, '..', certPath);
          
          // Check which path exists
          if (existsSync(cwdPath)) {
            certPath = cwdPath;
          } else if (existsSync(dirnamePath)) {
            certPath = dirnamePath;
          } else {
            // Try one more time from __dirname going up two levels (if in dist/)
            const altPath = resolve(__dirname, '../..', certPath);
            if (existsSync(altPath)) {
              certPath = altPath;
            } else {
              certPath = cwdPath; // Use cwd path for error message
            }
          }
        }

        if (existsSync(certPath)) {
          try {
            const certContent = readFileSync(certPath, 'utf-8');
            // The pg library expects the CA certificate as a string
            // The global-bundle.pem contains multiple certificates which is fine
            sslConfig.ca = certContent;
            console.log(`SSL certificate loaded from: ${certPath}`);
            console.log(`Certificate length: ${certContent.length} characters`);
          } catch (error: any) {
            console.error(`Failed to read SSL certificate from ${certPath}:`, error.message);
            throw new Error(
              `SSL certificate file exists but cannot be read: ${certPath}\n` +
              `Error: ${error.message}`
            );
          }
        } else {
          console.error(
            `SSL certificate file not found. Tried:\n` +
            `  - ${resolve(process.cwd(), config.database.sslCaPath)}\n` +
            `  - ${resolve(__dirname, '..', config.database.sslCaPath)}\n` +
            `Download from: https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem\n` +
            `And save to: backend/certs/rds-ca-rsa2048-g1.pem`
          );
          // If certificate file doesn't exist but SSL is required, we'll let the connection fail
          // with a more descriptive error
        }
      }

      poolConfig.ssl = sslConfig;
    }

    pool = new Pool(poolConfig);

    pool.on('error', (err) => {
      console.error('Unexpected error on idle client', err);
    });
  }

  return pool;
}

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  try {
    const db = getDatabasePool();
    const result = await db.query(text, params);
    return result.rows;
  } catch (error: any) {
    // Handle connection timeout errors
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET' || 
        error.message?.includes('timeout') || error.message?.includes('Connection terminated')) {
      const connectionString = config.database.url;
      const dbEndpoint = connectionString.split('@')[1]?.split('/')[0] || 'unknown';
      throw new Error(
        `Database connection timeout. Cannot connect to ${dbEndpoint}. ` +
        'Please ensure:\n' +
        '1. RDS instance is running and available\n' +
        '2. Security group allows connections from ECS task (check security group rules)\n' +
        '3. RDS instance is in the same VPC or has proper network configuration\n' +
        '4. Database credentials are correct\n' +
        `Original error: ${error.message || error.code}`
      );
    }

    // Handle SSL certificate errors
    if (error.code === 'SELF_SIGNED_CERT_IN_CHAIN' || error.message?.includes('self-signed certificate')) {
      const certPath = config.database.sslCaPath;
      throw new Error(
        'SSL certificate verification failed. Please ensure:\n' +
        `1. RDS CA certificate is downloaded to: ${certPath || './certs/rds-ca-rsa2048-g1.pem'}\n` +
        '2. Download from: https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem\n' +
        '3. Verify DATABASE_SSL_CA_PATH in your .env file points to the correct location\n' +
        `Original error: ${error.message}`
      );
    }

    if (error.code === 'ECONNREFUSED') {
      const connectionString = config.database.url;
      const isConfigured = connectionString && 
        !connectionString.includes('YOUR_PASSWORD') && 
        !connectionString.includes('xxxxxxxxx') &&
        !connectionString.includes('localhost:5432');
      
      if (!isConfigured) {
        throw new Error(
          'Database not configured. Please:\n' +
          '1. Run: .\\scripts\\setup-rds.ps1 to create AWS RDS instance\n' +
          '2. Update backend/.env with DATABASE_URL from the setup output\n' +
          '3. Run database migrations: psql -h <endpoint> -U vidverse_admin -d vidverse -f migrations/001_initial_schema.sql'
        );
      } else {
        throw new Error(
          `Cannot connect to database at ${connectionString.split('@')[1]?.split('/')[0] || 'unknown'}. ` +
          'Please ensure:\n' +
          '1. RDS instance is running and available\n' +
          '2. Security group allows connections from your IP\n' +
          '3. Database credentials are correct\n' +
          `Original error: ${error.message}`
        );
      }
    }
    throw error;
  }
}

export async function queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] || null;
}

// Test database connection
export async function testConnection(): Promise<boolean> {
  try {
    await query('SELECT 1');
    return true;
  } catch (error) {
    return false;
  }
}

