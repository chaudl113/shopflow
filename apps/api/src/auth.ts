import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { db } from './db/client.js';
import { userStores, users } from './db/schema.js';
import { AppError, forbidden } from './lib/errors.js';

export type Role = 'owner' | 'manager' | 'cashier' | 'staff';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  bookable: boolean;
  storeIds: string[];
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, config.bcryptRounds);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export const signToken = (userId: string) => jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: '12h' });

export async function loadAuthUser(userId: string): Promise<AuthUser | null> {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u || !u.active) return null;
  const links = await db.select({ storeId: userStores.storeId }).from(userStores).where(eq(userStores.userId, u.id));
  return { id: u.id, name: u.name, email: u.email, role: u.role, bookable: u.bookable, storeIds: links.map((l) => l.storeId) };
}

/** Verifies the bearer token and reloads the user, so deactivation and store changes apply immediately. */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  let sub: string | undefined;
  try {
    sub = (jwt.verify(token, config.jwtSecret) as jwt.JwtPayload).sub;
  } catch {
    throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in');
  }
  const user = sub ? await loadAuthUser(sub) : null;
  if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in');
  req.user = user;
  next();
};

export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) throw forbidden(`Requires role: ${roles.join(' or ')}`);
    next();
  };

export const canAccessStore = (user: AuthUser, storeId: string) => user.role === 'owner' || user.storeIds.includes(storeId);

export function assertStoreAccess(user: AuthUser | undefined, storeId: string) {
  if (!user || !canAccessStore(user, storeId)) throw forbidden('You are not assigned to this store');
}

export const authUser = (req: { user?: AuthUser }): AuthUser => {
  if (!req.user) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in');
  return req.user;
};
