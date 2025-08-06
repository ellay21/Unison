# Real-Time Collaboration Platform Backend

A Node.js/Express backend built with TypeScript for real-time document collaboration using Socket.IO, Yjs, PostgreSQL, and Redis.

## Features

- **Real-time collaboration** with Socket.IO and Yjs CRDT
- **JWT authentication** with refresh tokens
- **OAuth integration** (Google/GitHub stubs)
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
- **Auth**: JWT + Passport.js (OAuth stubs)
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
\`\`\`bash
npm install
\`\`\`

2. Set up environment variables:
\`\`\`bash
cp .env.example .env
# Edit .env with your database and Redis URLs
\`\`\`

3. Set up the database:
\`\`\`bash
npx prisma migrate dev --name init
npx prisma generate
\`\`\`

4. Start the development server:
\`\`\`bash
npm run dev
\`\`\`

The server will start on http://localhost:3000

## API Endpoints

### Authentication
- \`POST /api/auth/login\` - Login (stub implementation)
- \`POST /api/auth/refresh\` - Refresh JWT token
- \`POST /api/auth/logout\` - Logout and invalidate token
- \`GET /api/auth/google\` - Google OAuth (stub)
- \`GET /api/auth/github\` - GitHub OAuth (stub)

### Documents
- \`POST /api/documents\` - Create new document
- \`GET /api/documents\` - List user's documents
- \`GET /api/documents/:id\` - Get document by ID
- \`PUT /api/documents/:id\` - Update document
- \`DELETE /api/documents/:id\` - Delete document

### WebSocket Events
- \`document:join\` - Join document room
- \`document:edit\` - Send document updates
- \`document:leave\` - Leave document room
- \`presence:update\` - Update user presence

## Environment Variables

\`\`\`env
DATABASE_URL="postgresql://username:password@localhost:5432/collaboration_db"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="your-jwt-secret"
JWT_REFRESH_SECRET="your-refresh-secret"
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"
GITHUB_CLIENT_ID="your-github-client-id"
GITHUB_CLIENT_SECRET="your-github-client-secret"
PORT=3000
NODE_ENV=development
FRONTEND_URL="http://localhost:3000"
\`\`\`

## Development

### Available Scripts

- \`npm run dev\` - Start development server with hot reload
- \`npm run build\` - Build for production
- \`npm start\` - Start production server
- \`npm run db:generate\` - Generate Prisma client
- \`npm run db:migrate\` - Run database migrations
- \`npm run db:studio\` - Open Prisma Studio

### Database Management

\`\`\`bash
# Create and apply migrations
npx prisma migrate dev --name migration_name

# Reset database (development only)
npx prisma migrate reset

# View data in Prisma Studio
npx prisma studio
\`\`\`

## Architecture

### Folder Structure
\`\`\`
src/
├── config/         # Environment and configuration
├── controllers/    # Route handlers
├── middleware/     # Auth, validation, error handling
├── models/         # TypeScript types and Zod schemas
├── services/       # Business logic (Redis, documents, users)
├── sockets/        # Socket.IO event handlers
├── utils/          # Utilities (JWT, logger)
├── routes.ts       # API route definitions
└── server.ts       # Application entry point
\`\`\`

### Key Components

1. **Real-time Collaboration**: Uses Yjs for conflict-free replicated data types (CRDT)
2. **Document Persistence**: Automatic sync to PostgreSQL every 5 seconds
3. **Presence Tracking**: Real-time user presence with Redis
4. **Authentication**: JWT with refresh tokens and OAuth stubs
5. **Rate Limiting**: 100 requests per minute per IP
6. **Error Handling**: Comprehensive error middleware

## Docker Deployment

\`\`\`bash
# Build image
docker build -t collaboration-backend .

# Run container
docker run -p 3000:3000 --env-file .env collaboration-backend
\`\`\`

## Testing

The backend includes comprehensive error handling and logging. For testing:

1. Use the health check endpoint: \`GET /health\`
2. Test authentication with the stub login endpoint
3. Create documents and test real-time collaboration
4. Monitor logs for debugging

## Production Considerations

1. **OAuth Integration**: Replace stub implementations with real OAuth flows
2. **Database Scaling**: Consider read replicas for heavy read workloads
3. **Redis Clustering**: Use Redis Cluster for high availability
4. **Load Balancing**: Use multiple server instances with Redis adapter
5. **Monitoring**: Add proper logging and monitoring solutions
6. **Security**: Implement additional security measures (helmet, etc.)

## Contributing

1. Follow TypeScript best practices
2. Add proper error handling
3. Include comprehensive logging
4. Update documentation for new features
5. Test thoroughly before submitting PRs
\`\`\`
