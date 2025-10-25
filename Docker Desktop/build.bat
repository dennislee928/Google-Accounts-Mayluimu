@echo off
REM Build script for Google Account Automation Docker image (Windows)

echo 🐳 Building Google Account Automation Docker Image...

REM Check if Docker is running
docker info >nul 2>&1
if errorlevel 1 (
    echo ❌ Docker is not running. Please start Docker Desktop.
    pause
    exit /b 1
)

REM Build the Docker image
echo 📦 Building Docker image...
docker build -f Dockerfile -t google-account-automation:latest ..

if errorlevel 1 (
    echo ❌ Docker build failed!
    pause
    exit /b 1
)

echo ✅ Docker image built successfully!

REM Optional: Run the container
set /p choice="🚀 Do you want to run the container now? (y/N): "
if /i "%choice%"=="y" (
    echo 🏃 Starting container...
    
    REM Check if .env exists, if not copy from example
    if not exist .env (
        echo 📋 Creating .env file from example...
        copy .env.example .env
        echo ⚠️  Please edit .env file with your configuration before running in production!
    )
    
    REM Start with docker-compose
    docker-compose up -d
    
    if errorlevel 1 (
        echo ❌ Failed to start container!
        pause
        exit /b 1
    )
    
    echo ✅ Container started successfully!
    echo 📊 Check status with: docker-compose ps
    echo 📝 View logs with: docker-compose logs -f
) else (
    echo ℹ️  To run later, use: docker-compose up -d
)

echo 🎉 Build complete!
pause