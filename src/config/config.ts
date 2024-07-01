import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000'),
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // Database
  databaseUrl: process.env.DATABASE_URL!,
  
  // Redis
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  
  // JWT
  jwtSecret: process.env.JWT_SECRET!,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET!,
  jwtExpiresIn: '15m',
  jwtRefreshExpiresIn: '7d',
  
  // OAuth
  sessionSecret : process.env.SESSION_SECRET,
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  },
  github: {
    clientId: process.env.GITHUB_CLIENT_ID!,
    clientSecret: process.env.GITHUB_CLIENT_SECRET!,
  },
  
  // CORS
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
};

// Validate required environment variables
const requiredEnvVars = [
  'DATABASE_URL',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'SESSION_SECRET',
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}
