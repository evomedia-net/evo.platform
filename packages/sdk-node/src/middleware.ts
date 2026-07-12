import { EvoPlatform } from './client';
import { Claims } from './types';

/** Minimal request/response shapes so the SDK works with Express-likes without depending on them. */
export interface AuthableRequest {
  headers: Record<string, string | string[] | undefined>;
  evo?: Claims;
}

export interface AuthableResponse {
  status(code: number): { json(body: unknown): unknown };
}

type Next = (err?: unknown) => void;

/** Express-style middleware: verifies the bearer token and attaches claims as req.evo. */
export function requireAuth(platform: EvoPlatform) {
  return async (req: AuthableRequest, res: AuthableResponse, next: Next) => {
    const header = req.headers['authorization'];
    const value = Array.isArray(header) ? header[0] : header;
    if (!value?.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Missing bearer token' });
    }
    try {
      req.evo = await platform.verifyToken(value.slice(7));
      next();
    } catch {
      res.status(401).json({ message: 'Invalid or expired token' });
    }
  };
}

/** Requires requireAuth to have run first. */
export function requireRole(role: string) {
  return (req: AuthableRequest, res: AuthableResponse, next: Next) => {
    if (req.evo?.roles?.includes(role)) return next();
    res.status(403).json({ message: `Role "${role}" required` });
  };
}
