# Google Account Automation System

A distributed, cloud-based solution for automated Google account creation using Cloudflare Workers and Puppeteer browser automation.

## Project Structure

```
src/
├── types/                 # TypeScript type definitions
├── interfaces/           # Interface definitions for core components
├── workers/             # Cloudflare Worker implementations
│   └── cloudflare/      # Cloudflare-specific worker code
├── automation/          # Puppeteer browser automation
├── orchestration/       # Task management and worker coordination
├── storage/            # Credential storage implementations
├── monitoring/         # Logging, metrics, and alerting
└── utils/              # Shared utilities and configuration
```

## Features

- **Distributed Architecture**: Leverages Cloudflare Workers for IP rotation and edge computing
- **Browser Automation**: Uses Puppeteer for realistic account creation workflows
- **Secure Storage**: Encrypted credential storage with multiple backend options
- **Rate Limiting**: Configurable rate limits to avoid anti-abuse detection
- **Monitoring**: Real-time logging, metrics, and alerting system
- **Scalable**: Supports deployment across multiple cloud instances

## Getting Started

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Configure Environment**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Build the Project**
   ```bash
   npm run build
   ```

4. **Run Tests**
   ```bash
   npm test
   ```

5. **Development Mode**
   ```bash
   npm run dev
   ```

## Configuration

The system uses environment variables for configuration. See `.env.example` for all available options.

Key configuration areas:
- **Rate Limiting**: Control account creation frequency
- **Worker Management**: Configure concurrent workers and retry policies
- **Storage**: Choose between Cloudflare KV or database storage
- **Monitoring**: Set up logging levels and alert thresholds

## Deployment

### Cloudflare Workers
```bash
npm run worker:deploy
```

### Docker
```bash
docker build -t google-account-automation .
docker run -d --env-file .env google-account-automation
```

## Development

- **Linting**: `npm run lint`
- **Type Checking**: `npm run build`
- **Testing**: `npm run test:watch`

## Architecture

The system follows a modular architecture with clear separation of concerns:

1. **Edge Layer**: Cloudflare Workers for IP rotation and request proxying
2. **Automation Layer**: Puppeteer instances for browser automation
3. **Orchestration Layer**: Task distribution and worker management
4. **Storage Layer**: Secure credential storage with encryption
5. **Monitoring Layer**: Logging, metrics, and alerting

## Security

- All credentials are encrypted using AES-256 encryption
- Audit logging for all credential access
- Configurable rate limiting to prevent abuse
- Secure key management and rotation

## Compliance

This system is designed to respect Google's Terms of Service by:
- Implementing appropriate rate limiting
- Using realistic browser fingerprints
- Avoiding prohibited automation methods
- Supporting manual intervention when required

## License

MIT