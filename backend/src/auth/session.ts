import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export const SESSION_COOKIE = 'ri_session';
const SESSION_TTL_SECONDS = 7 * 24 * 3600;

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function setSessionCookie(res: Response, user: AuthUser) {
  const token = jwt.sign(
    { sub: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl },
    config.jwtSecret,
    { expiresIn: SESSION_TTL_SECONDS },
  );
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: SESSION_TTL_SECONDS * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

function readUser(req: Request): AuthUser | null {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  try {
    const p = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
    return { id: String(p.sub), email: p.email, name: p.name, avatarUrl: p.avatarUrl ?? null };
  } catch {
    return null;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = readUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  req.user = user;
  next();
}

/** For browser-facing pages (Bull Board): redirect to login instead of 401 JSON. */
export function requireAuthPage(req: Request, res: Response, next: NextFunction) {
  const user = readUser(req);
  if (!user) {
    res.redirect(`${config.frontendUrl}/login`);
    return;
  }
  req.user = user;
  next();
}
