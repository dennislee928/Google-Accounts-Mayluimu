#!/bin/bash

# Build script for Google Account Automation Docker image

set -e

echo "🐳 Building Google Account Automation Docker Image..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker Desktop."
    exit 1
fi

# Build the Docker image
echo "📦 Building Docker image..."
docker build -f Dockerfile -t google-account-automation:latest ..

echo "✅ Docker image built successfully!"

# Optional: Run the container
read -p "🚀 Do you want to run the container now? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🏃 Starting container..."
    
    # Check if .env exists, if not copy from example
    if [ ! -f .env ]; then
        echo "📋 Creating .env file from example..."
        cp .env.example .env
        echo "⚠️  Please edit .env file with your configuration before running in production!"
    fi
    
    # Start with docker-compose
    docker-compose up -d
    
    echo "✅ Container started successfully!"
    echo "📊 Check status with: docker-compose ps"
    echo "📝 View logs with: docker-compose logs -f"
else
    echo "ℹ️  To run later, use: docker-compose up -d"
fi

echo "🎉 Build complete!"