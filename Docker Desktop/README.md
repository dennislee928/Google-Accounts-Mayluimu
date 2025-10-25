# Google Account Automation - Docker Setup

This directory contains Docker configuration files for running the Google Account Automation system in containerized environments.

## 🐳 Quick Start

### Prerequisites
- Docker Desktop installed and running
- Docker Compose (included with Docker Desktop)
- At least 4GB RAM available for containers

### Basic Setup

1. **Copy environment file:**
   ```bash
   cp .env.example .env
   ```

2. **Edit environment variables:**
   ```bash
   # Edit .env file with your configuration
   nano .env
   ```

3. **Build and run:**
   ```bash
   docker-compose up -d
   ```

4. **Check status:**
   ```bash
   docker-compose ps
   docker-compose logs -f google-account-automation
   ```

## 📁 Files Overview

- `Dockerfile` - Multi-stage production-ready container image
- `docker-compose.yml` - Complete orchestration with optional services
- `.dockerignore` - Optimizes build by excluding unnecessary files
- `.env.example` - Environment configuration template
- `README.md` - This documentation

## 🚀 Deployment Options

### Option 1: Basic Deployment (SQLite)
```bash
# Default setup with SQLite database
docker-compose up -d
```

### Option 2: With PostgreSQL
```bash
# Include PostgreSQL database
docker-compose --profile postgres up -d
```

### Option 3: Full Stack with Monitoring
```bash
# Include PostgreSQL, Redis, and Prometheus
docker-compose --profile postgres --profile redis --profile monitoring up -d
```

## 🔧 Configuration

### Required Environment Variables
```env
ENCRYPTION_KEY=your-secure-32-character-minimum-key
ACCOUNTS_PER_DAY=100
ACCOUNTS_PER_HOUR=10
```

### Optional Services Configuration

#### PostgreSQL
```env
POSTGRES_DB=automation
POSTGRES_USER=automation
POSTGRES_PASSWORD=secure-password
DATABASE_URL=postgresql://automation:secure-password@postgres:5432/automation
```

#### Redis
```env
REDIS_PASSWORD=secure-redis-password
REDIS_URL=redis://:secure-redis-password@redis:6379
```

## 📊 Monitoring

### Health Checks
```bash
# Check container health
docker-compose ps

# View health check logs
docker inspect google-account-automation --format='{{.State.Health}}'
```

### Logs
```bash
# View application logs
docker-compose logs -f google-account-automation

# View all services logs
docker-compose logs -f
```

### Prometheus Metrics (if enabled)
- Access Prometheus UI: http://localhost:9090
- View application metrics and alerts

## 🔒 Security Features

- **Non-root user**: Containers run as `automation` user (UID 1001)
- **Read-only filesystem**: Application runs with minimal write permissions
- **Capability dropping**: Removes unnecessary Linux capabilities
- **Network isolation**: Services communicate through dedicated network
- **Secret management**: Environment variables for sensitive data

## 📦 Volume Management

### Data Persistence
```bash
# Backup data volumes
docker run --rm -v automation_data:/data -v $(pwd):/backup alpine tar czf /backup/data-backup.tar.gz -C /data .

# Restore data volumes
docker run --rm -v automation_data:/data -v $(pwd):/backup alpine tar xzf /backup/data-backup.tar.gz -C /data
```

### Volume Locations
- `automation_data` - Database and application data
- `automation_logs` - Application logs
- `automation_exports` - Generated account exports
- `automation_screenshots` - Debug screenshots

## 🛠 Troubleshooting

### Common Issues

#### Container won't start
```bash
# Check logs for errors
docker-compose logs google-account-automation

# Verify environment variables
docker-compose config
```

#### Puppeteer/Chrome issues
```bash
# Verify Chrome installation in container
docker-compose exec google-account-automation which chromium-browser

# Check Chrome version
docker-compose exec google-account-automation chromium-browser --version
```

#### Permission issues
```bash
# Fix volume permissions
docker-compose exec google-account-automation ls -la /app/data
```

### Performance Tuning

#### Memory limits
```yaml
# Add to docker-compose.yml service
deploy:
  resources:
    limits:
      memory: 2G
    reservations:
      memory: 1G
```

#### CPU limits
```yaml
# Add to docker-compose.yml service
deploy:
  resources:
    limits:
      cpus: '2.0'
    reservations:
      cpus: '1.0'
```

## 🔄 Updates and Maintenance

### Update application
```bash
# Pull latest changes and rebuild
git pull
docker-compose build --no-cache
docker-compose up -d
```

### Clean up
```bash
# Remove unused containers and images
docker system prune -f

# Remove all automation containers and volumes (DESTRUCTIVE)
docker-compose down -v
docker system prune -a -f
```

## 📋 Production Checklist

- [ ] Set strong `ENCRYPTION_KEY` (32+ characters)
- [ ] Configure proper database credentials
- [ ] Set up log rotation
- [ ] Configure monitoring and alerts
- [ ] Set up backup strategy for volumes
- [ ] Review and adjust rate limits
- [ ] Configure firewall rules
- [ ] Set up SSL/TLS if exposing ports
- [ ] Test disaster recovery procedures

## 🆘 Support

For issues and questions:
1. Check container logs: `docker-compose logs -f`
2. Verify configuration: `docker-compose config`
3. Check system resources: `docker stats`
4. Review application documentation in parent directory

## 📄 License

This Docker configuration is part of the Google Account Automation project and follows the same license terms.