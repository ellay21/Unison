import passport from 'passport';
import { PrismaClient } from '@prisma/client';
import { Strategy as GoogleStrategy, Profile as GoogleProfile, VerifyCallback as GoogleVerifyCallback } from 'passport-google-oauth20';
import { Strategy as GitHubStrategy, Profile as GithubProfile } from 'passport-github2';
import { config } from './config';
import { userService } from '../services/userService';

type User = NonNullable<Awaited<ReturnType<PrismaClient['user']['findUnique']>>>; // Ensure User is not null/undefined

export const setupPassport = () => {
  // Google OAuth Strategy (Stub)
  passport.use(new GoogleStrategy({
    clientID: config.google.clientId,
    clientSecret: config.google.clientSecret,
    callbackURL: '/api/auth/google/callback',
  }, async (
    _accessToken: string,
    _refreshToken: string,
    profile: GoogleProfile,
    done: GoogleVerifyCallback,
  ) => {
    try {
      const user = await userService.findOrCreateOAuthUser({
        email: profile.emails?.[0]?.value || '',
        name: profile.displayName,
        avatar: profile.photos?.[0]?.value,
        provider: 'google',
        providerId: profile.id,
      });
      // Pass the user object directly on success
      return done(null, user);
    } catch (error) {
      // Pass the error to the done callback
      return done(error as Error);
    }
  }));

  // GitHub OAuth Strategy (Stub)
  passport.use(new GitHubStrategy({
    clientID: config.github.clientId,
    clientSecret: config.github.clientSecret,
    callbackURL: '/api/auth/github/callback',
    scope: ['user:email'], // Request email scope
  }, async (
    _accessToken: string,
    _refreshToken: string,
    profile: GithubProfile,
    done: (error: Error | null, user?: User | false) => void // Adjusted done callback type
  ) => {
    try {
      const user = await userService.findOrCreateOAuthUser({
        email: profile.emails?.[0]?.value || '', // GitHub profile might not always have emails directly
        name: profile.displayName || profile.username,
        avatar: profile.photos?.[0]?.value,
        provider: 'github',
        providerId: profile.id,
      });
      // Pass the user object directly on success
      return done(null, user);
    } catch (error) {
      // Pass the error to the done callback
      return done(error as Error);
    }
  }));

  // Serialize user into the session
  passport.serializeUser((user: User, done) => {
    done(null, user.id);
  });

  // Deserialize user from the session
  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await userService.findById(id);
      // If user is found, pass it. If not, pass false to indicate no user found.
      done(null, user || false); 
    } catch (error) {
      // On error, pass the error and false to indicate failure.
      done(error as Error, false);
    }
  });
};