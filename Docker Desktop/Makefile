# Google Account Automation Docker Management

.PHONY: help build run stop clean logs shell test backup restore

# Default target
help:
	@echo "Google Account Automation Docker Commands:"
	@echo ""
	@echo "  build     - Build the Docker image"
	@echo "  run       - Start the application (basic setup)"
	@echo "  run-full  - Start with all services (PostgreSQL, Redis, Monitoring)"
	@echo "  stop      - Stop all services"
	@echo "  restart   - Restart the application"
	@echo "  clean     - Remove containers and images"
	@echo "  logs      - View application logs"
	@echo "  shell     - Open shell in running container"
	@echo "  test      - Run tests in container"
	@echo "  backup    - Backup data volumes"
	@echo "  restore   - Restore data volumes"
	@echo "  status    - Show container status"
	@echo ""

# Build the Docker image
build:
	@echo "🐳 Building Docker image..."
	docker build -f Dockerfile -t google-account-automation:latest ..
	@echo "✅ Build complete!"

# Start basic setup
run:
	@echo "🚀 Starting Google Account Automation..."
	@if [ ! -f .env ]; then \
		echo "📋 Creating .env from example..."; \
		cp .env.example .env; \
		echo "⚠️  Please edit .env file with your configuration!"; \
	fi
	docker-compose up -d
	@echo "✅ Application started!"

# Start with all services
run-full:
	@echo "🚀 Starting full stack..."
	@if [ ! -f .env ]; then \
		echo "📋 Creating .env from example..."; \
		cp .env.example .env; \
		echo "⚠️  Please edit .env file with your configuration!"; \
	fi
	docker-compose --profile postgres --profile redis --profile monitoring up -d
	@echo "✅ Full stack started!"

# Stop all services
stop:
	@echo "🛑 Stopping services..."
	docker-compose down
	@echo "✅ Services stopped!"

# Restart the application
restart: stop run

# Clean up containers and images
clean:
	@echo "🧹 Cleaning up..."
	docker-compose down -v
	docker system prune -f
	@echo "✅ Cleanup complete!"

# View logs
logs:
	@echo "📝 Viewing logs..."
	docker-compose logs -f google-account-automation

# Open shell in container
shell:
	@echo "🐚 Opening shell..."
	docker-compose exec google-account-automation sh

# Run tests
test:
	@echo "🧪 Running tests..."
	docker-compose exec google-account-automation npm test

# Backup data
backup:
	@echo "💾 Creating backup..."
	@mkdir -p backups
	docker run --rm -v automation_data:/data -v $(PWD)/backups:/backup alpine tar czf /backup/data-backup-$(shell date +%Y%m%d-%H%M%S).tar.gz -C /data .
	@echo "✅ Backup created in backups/ directory"

# Restore data (requires BACKUP_FILE variable)
restore:
	@if [ -z "$(BACKUP_FILE)" ]; then \
		echo "❌ Please specify BACKUP_FILE=path/to/backup.tar.gz"; \
		exit 1; \
	fi
	@echo "📥 Restoring from $(BACKUP_FILE)..."
	docker run --rm -v automation_data:/data -v $(PWD)/backups:/backup alpine tar xzf /backup/$(BACKUP_FILE) -C /data
	@echo "✅ Restore complete!"

# Show status
status:
	@echo "📊 Container Status:"
	docker-compose ps
	@echo ""
	@echo "💾 Volume Usage:"
	docker system df
	@echo ""
	@echo "🏥 Health Status:"
	@docker inspect google-account-automation --format='{{.State.Health.Status}}' 2>/dev/null || echo "Container not running"

# Development helpers
dev-build:
	@echo "🔧 Development build..."
	docker build -f Dockerfile --target builder -t google-account-automation:dev ..

dev-test:
	@echo "🧪 Running development tests..."
	docker run --rm -v $(PWD)/..:/app -w /app google-account-automation:dev npm test

# Quick setup for new users
setup: build
	@echo "🎯 Quick setup complete!"
	@echo "📝 Next steps:"
	@echo "  1. Edit .env file with your configuration"
	@echo "  2. Run 'make run' to start the application"
	@echo "  3. Check status with 'make status'"