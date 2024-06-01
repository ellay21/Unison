# Real-Time Collaboration Platform Backend

A Node.js/Express backend built with TypeScript for real-time document collaboration using Socket.IO, Yjs, PostgreSQL, and Redis.

## Features

- **Real-time collaboration** with Socket.IO and Yjs CRDT
- **User registration and authentication** with JWT tokens
- **OAuth integration** (Google/GitHub with stubs for development)
- **PostgreSQL database** with Prisma ORM
- **Redis caching** and pub/sub for scaling
- **Rate limiting** and security middleware
- **TypeScript** with comprehensive type safety
- **Docker support** for easy deployment

## Tech Stack

- **Runtime**: Node.js v18+
- **Framework**: Express.js
- **Language**: TypeScript
- **Real-Time**: Socket.IO with Redis adapter
- **Database**: PostgreSQL + Prisma ORM
- **Auth**: JWT + Passport.js + bcrypt for password hashing
- **Caching**: Redis (ioredis)
- **Validation**: Zod

## Quick Start

### Prerequisites

- Node.js v18+
- PostgreSQL database
- Redis server
- npm or yarn

### Installation

1. Clone and install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
cp .env
```

3. Set up the database:
```bash
npx prisma db push
npx prisma generate
```

4. Build the project:
```bash
npm run build
```

5. Start the server:
```bash
npm start
```

## Deployment

### Docker

1. Build the Docker image:
```bash
docker build -t unison-backend .
```

2. Run the container:
```bash
docker run -p 3000:3000 --env-file .env unison-backend
```

### Environment Variables

Ensure your `.env` file contains the following variables:

- `PORT`: Server port (default: 3000)
- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection string
- `JWT_SECRET`: Secret key for JWT tokens
- `JWT_REFRESH_SECRET`: Secret key for refresh tokens
- `CORS_ORIGIN`: Allowed CORS origin (e.g., http://localhost:5173)


5. Start the development server:
```bash
npm run dev
```

The server will start on http://localhost:3000

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user with email/password
- `POST /api/auth/login` - Login with email/password (or email-only in dev mode)
- `POST /api/auth/refresh` - Refresh JWT token
- `POST /api/auth/logout` - Logout and invalidate token
- `GET /api/auth/google` - Google OAuth initiation
- `GET /api/auth/google/callback` - Google OAuth callback
- `GET /api/auth/github` - GitHub OAuth initiation
- `GET /api/auth/github/callback` - GitHub OAuth callback

### Documents
- `POST /api/documents` - Create new document
- `GET /api/documents` - List user's documents
- `GET /api/documents/:id` - Get document by ID
- `PUT /api/documents/:id` - Update document
- `DELETE /api/documents/:id` - Delete document

### Health Check
- `GET /health` - Server health status

### WebSocket Events
- `document:join` - Join document room for real-time collaboration
- `document:edit` - Send document updates (Yjs format)
- `document:leave` - Leave document room
- `presence:update` - Update user presence (cursor, selection)

## Environment Variables

```env
DATABASE_URL="postgresql://username:password@localhost:5432/collaboration_db"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="your-super-secret-jwt-key-for-development"
JWT_REFRESH_SECRET="your-super-secret-refresh-key-for-development"
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"
GITHUB_CLIENT_ID="your-github-client-id"
GITHUB_CLIENT_SECRET="your-github-client-secret"
PORT=3000
NODE_ENV=development
FRONTEND_URL="http://localhost:3000"
```

## Development

### Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run db:generate` - Generate Prisma client
- `npm run db:migrate` - Run database migrations
- `npm run db:studio` - Open Prisma Studio
- `npm run db:init` - Initialize database with sample data

### Database Management

```bash
# Create and apply migrations
npx prisma migrate dev --name migration_name

# Reset database (development only)
npx prisma migrate reset

# View data in Prisma Studio
npx prisma studio
```
### Testing with Docker

``` bash
# Start PostgreSQL
docker run --name postgres-collab -e POSTGRES_PASSWORD=password -e POSTGRES_DB=collaboration_db -p 5432:5432 -d postgres:15

# Start Redis
docker run --name redis-collab -p 6379:6379 -d redis:7-alpine
```

## Architecture

### Folder Structure
```
src/
├── config/         # Environment and Passport configuration
├── controllers/    # Route handlers (auth, documents)
├── middleware/     # Auth, validation, error handling
├── models/         # TypeScript types and Zod schemas
├── services/       # Business logic (Redis, documents, users)
├── sockets/        # Socket.IO event handlers
├── utils/          # Utilities (JWT, logger)
|── types/          # for types
├── routes.ts       # API route definitions
└── server.ts       # Application entry point

prisma/
└── schema.prisma   # Database schema

scripts/
└── init-database.sql # Database initialization
```

### Key Components

1. **User Management**: Registration, login, OAuth integration with password hashing
2. **Real-time Collaboration**: Uses Yjs for conflict-free replicated data types (CRDT)
3. **Document Persistence**: Automatic sync to PostgreSQL every 5 seconds
4. **Presence Tracking**: Real-time user presence with Redis hashmap storage
5. **Authentication**: JWT with refresh tokens, blacklist for logout
6. **Rate Limiting**: 100 requests per minute per IP address
7. **Error Handling**: Comprehensive error middleware with proper HTTP status codes

### Database Schema

- **Users**: ID, email, name, password hash, avatar, provider info
- **Documents**: ID, title, content (Yjs state), owner, timestamps
- **RefreshTokens**: Token management for secure authentication

## API Testing

Use the included `api-test.http` file with REST Client extension in VS Code or similar tools to test all endpoints with sample data.

## Docker Deployment

```
# Build image
docker build -t collaboration-backend .

# Run container
docker run -p 3000:3000 --env-file .env collaboration-backend
```
## Production Setup

### 1. OAuth Configuration

**Google OAuth:**
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create OAuth 2.0 credentials
3. Add redirect URI: `https://yourdomain.com/api/auth/google/callback`

**GitHub OAuth:**
1. Go to GitHub Settings → Developer settings → OAuth Apps
2. Create new OAuth App
3. Set callback URL: `https://yourdomain.com/api/auth/github/callback`

### 2. Security Enhancements

``` bash
npm install helmet express-rate-limit-redis
```

### 3. Monitoring and Logging

``` bash
npm install winston morgan @sentry/node
```

## Production Considerations

1. **OAuth Integration**: Replace stub implementations with real OAuth flows
2. **Database Scaling**: Consider read replicas for heavy read workloads
3. **Redis Clustering**: Use Redis Cluster for high availability
4. **Load Balancing**: Use multiple server instances with Redis adapter
5. **Monitoring**: Add proper logging and monitoring solutions (Sentry, Winston)
6. **Security**: Implement additional security measures (helmet, rate limiting)
7. **SSL/TLS**: Use HTTPS in production
8. **Environment Separation**: Separate configs for dev/staging/production

## Troubleshooting

### Common Issues

1. **Database Connection**: Ensure PostgreSQL is running and DATABASE_URL is correct
2. **Redis Connection**: Verify Redis server is accessible
3. **JWT Errors**: Check JWT_SECRET and JWT_REFRESH_SECRET are set
4. **OAuth Issues**: Verify client IDs and secrets are configured correctly
5. **Port Conflicts**: Ensure port 3000 is available or change PORT env var

### Health Check

``` bash
curl http://localhost:3000/health
```

Should return:
``` json
{
  "status": "OK",
  "timestamp": "2024-01-15T12:30:45.123Z",
  "uptime": 3600.5,
  "checks": {
    "database": "healthy",
    "redis": "healthy"
  }
}
```

## Contributing

1. Follow TypeScript best practices
2. Add proper error handling and validation
3. Include comprehensive logging
4. Update documentation for new features
5. Test thoroughly before submitting PRs
6. Use conventional commit messages

## License

MIT License - see LICENSE file for details

