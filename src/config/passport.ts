import passport from 'passport';
import { Strategy as GoogleStrategy, Profile as GoogleProfile, VerifyCallback as GoogleVerifyCallback } from 'passport-google-oauth20';
import { Strategy as GitHubStrategy, Profile as GithubProfile } from 'passport-github2';
import { config } from './config';
import { userService } from '../services/userService';


export const setupPassport = () => {

  // Google OAuth Strategy

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
      return done(null, user);
    } catch (error) {
      return done(error as Error);

    }

  }));



  // GitHub OAuth Strategy

  passport.use(new GitHubStrategy({
    clientID: config.github.clientId,
    clientSecret: config.github.clientSecret,
    callbackURL: '/api/auth/github/callback',
    scope: ['user:email'],
  }, async (
    _accessToken: string,
    _refreshToken: string,
    profile: GithubProfile,
    done: (error: Error | null, user?: any | false) => void
  ) => {
    try {
      const user = await userService.findOrCreateOAuthUser({
        email: profile.emails?.[0]?.value || '',
        name: profile.displayName || profile.username,
        avatar: profile.photos?.[0]?.value,
        provider: 'github',
        providerId: profile.id,
      });
      return done(null, user);
    } catch (error) {
      return done(error as Error);
    }
  }));

  passport.serializeUser((user: any, done) => {
    done(null, user.id)
  });

  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await userService.findById(id);
      done(null, user || false);
    } catch (error) {
      done(error as Error);
    }
  });
};