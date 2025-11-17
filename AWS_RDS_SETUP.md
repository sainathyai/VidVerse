# AWS RDS PostgreSQL Setup for Development

This guide will help you set up an AWS RDS PostgreSQL database in us-west-2 for your development environment.

## Prerequisites

- AWS Account with appropriate permissions
- AWS CLI configured (optional, but helpful)
- Your local IP address (for security group access)

## Step 1: Create RDS PostgreSQL Instance

### Via AWS Console

1. **Navigate to RDS Console**
   - Go to: https://console.aws.amazon.com/rds/
   - Make sure you're in **us-west-2** region

2. **Create Database**
   - Click "Create database"
   - Choose "Standard create"
   - Engine: **PostgreSQL**
   - Version: **15.x** (or latest stable)
   - Template: **Free tier** (for dev) or **Dev/Test**

3. **Settings**
   - DB instance identifier: `vidverse`
   - Master username: `vidverse_admin` (or your choice)
   - Master password: Create a strong password (save it!)
   - DB instance class: `db.t3.micro` (free tier) or `db.t3.small`

4. **Storage**
   - Storage type: General Purpose SSD (gp3)
   - Allocated storage: 20 GB (minimum)
   - Enable storage autoscaling: Optional

5. **Connectivity**
   - VPC: Default VPC (or your preferred VPC)
   - Public access: **Yes** (needed for local dev access)
   - VPC security group: Create new or use existing
   - Availability Zone: No preference
   - Database port: `5432`

6. **Database authentication**
   - Password authentication

7. **Additional configuration**
   - Initial database name: `vidverse`
   - Backup retention: 7 days (or 0 for dev)
   - Enable encryption: Optional for dev

8. **Create Database**
   - Click "Create database"
   - Wait 5-10 minutes for instance to be available

## Step 2: Configure Security Group

1. **Find your RDS instance**
   - Go to RDS Console → Databases → `vidverse`
   - Click on the instance

2. **Open Security Group**
   - Under "Connectivity & security", click on the VPC security group

3. **Add Inbound Rule**
   - Click "Edit inbound rules"
   - Click "Add rule"
   - Type: **PostgreSQL**
   - Protocol: **TCP**
   - Port: **5432**
   - Source: **My IP** (or your specific IP address)
   - Description: "Local dev access"
   - Click "Save rules"

## Step 3: Get Connection Details

1. **Find Endpoint**
   - In RDS Console → Databases → `vidverse`
   - Under "Connectivity & security", copy the **Endpoint**
   - Example: `vidverse.xxxxxxxxx.us-west-2.rds.amazonaws.com`

2. **Connection Details**
   - Host: `<endpoint>` (from above)
   - Port: `5432`
   - Database: `vidverse`
   - Username: `vidverse_admin` (or what you set)
   - Password: (the one you created)

### Connecting to the managed AWS RDS endpoint (vidverse.czgui6kw4z1d.us-west-2)

If you already have the shared backend database in **us-west-2**:

- **Endpoint:** `vidverse.czgui6kw4z1d.us-west-2.rds.amazonaws.com`
- **Port:** `5432`
- **Security group:** `vidverse-rds-sg (sg-0182eba87b8c83542)`
- **Availability Zone:** `us-west-2d`
- **VPC:** `vpc-0210b3311f28724d3`
- **Certificate authority:** `rds-ca-rsa2048-g1` (expires November 15, 2026)

Make sure your **frontend/public IP** is allowed in the security group and the instance remains publicly accessible.

### TLS configuration for the shared endpoint

1. Create a cert directory:
   ```bash
   mkdir -p backend/certs
   ```
2. Download the AWS RDS CA bundle (matches `rds-ca-rsa2048-g1`):
   ```bash
   curl -o backend/certs/rds-ca-rsa2048-g1.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
   ```
3. Set these environment variables:
   ```env
   DATABASE_SSL=true
   DATABASE_SSL_REJECT_UNAUTHORIZED=true
   DATABASE_SSL_CA_PATH=./backend/certs/rds-ca-rsa2048-g1.pem
   DATABASE_URL=postgresql://vidverse_admin:<your-password>@vidverse.czgui6kw4z1d.us-west-2.rds.amazonaws.com:5432/vidverse?sslmode=require
   ```
4. Restart your backend so it picks up the new config (`npm run dev` or similar).

## Step 4: Update Backend Configuration

Update your `backend/.env` file:

```env
# Database (AWS RDS)
DATABASE_URL=postgresql://vidverse_admin:YOUR_PASSWORD@vidverse.xxxxxxxxx.us-west-2.rds.amazonaws.com:5432/vidverse
```

Replace:
- `vidverse_admin` with your master username
- `YOUR_PASSWORD` with your master password
- `vidverse.xxxxxxxxx.us-west-2.rds.amazonaws.com` with your RDS endpoint

## Step 5: Run Database Migrations

1. **Install psql** (if not already installed)
   - Windows: Download from https://www.postgresql.org/download/windows/
   - Or use Docker: `docker run -it --rm postgres:15-alpine psql`

2. **Connect to RDS**
   ```bash
   psql -h vidverse.xxxxxxxxx.us-west-2.rds.amazonaws.com -U vidverse_admin -d vidverse
   ```

3. **Run Migration**
   ```bash
   # From your project root
   psql -h vidverse.xxxxxxxxx.us-west-2.rds.amazonaws.com -U vidverse_admin -d vidverse -f migrations/001_initial_schema.sql
   ```

   Or connect interactively:
   ```bash
   psql -h vidverse.xxxxxxxxx.us-west-2.rds.amazonaws.com -U vidverse_admin -d vidverse
   ```
   Then:
   ```sql
   \i migrations/001_initial_schema.sql
   ```

## Step 6: Test Connection

1. **Restart your backend server**
   ```bash
   cd backend
   npm run dev
   ```

2. **Check logs** - Should see successful database connection

3. **Test API** - Try accessing `/api/projects` - should work now!

## Alternative: Using AWS CLI

If you have AWS CLI configured:

```bash
# Create RDS instance
aws rds create-db-instance \
  --db-instance-identifier vidverse \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --engine-version 15.4 \
  --master-username vidverse_admin \
  --master-user-password YOUR_PASSWORD \
  --allocated-storage 20 \
  --storage-type gp3 \
  --vpc-security-group-ids sg-xxxxxxxxx \
  --publicly-accessible \
  --region us-west-2

# Wait for instance to be available
aws rds wait db-instance-available \
  --db-instance-identifier vidverse \
  --region us-west-2

# Get endpoint
aws rds describe-db-instances \
  --db-instance-identifier vidverse \
  --region us-west-2 \
  --query 'DBInstances[0].Endpoint.Address' \
  --output text
```

## Security Best Practices

1. **Use Strong Password** - Generate a secure password
2. **Limit IP Access** - Only allow your dev IP in security group
3. **Enable SSL** - For production, enable SSL connections
4. **Regular Backups** - Enable automated backups
5. **Monitor Costs** - RDS can get expensive, monitor usage

## Cost Considerations

- **Free Tier**: 750 hours/month of db.t2.micro or db.t3.micro for 12 months
- **After Free Tier**: ~$15-20/month for db.t3.micro
- **Storage**: ~$0.115/GB/month
- **Backups**: ~$0.095/GB/month

## Troubleshooting

### Connection Refused
- Check security group allows your IP
- Verify RDS instance is publicly accessible
- Check VPC routing tables

### Authentication Failed
- Verify username and password
- Check password doesn't have special characters that need encoding

### SSL Required
- Add `?sslmode=require` to connection string
- Or disable SSL requirement in RDS parameter group (dev only)

## Next Steps

Once RDS is set up:
1. Update `backend/.env` with RDS connection string
2. Run migrations
3. Restart backend
4. Test API endpoints


