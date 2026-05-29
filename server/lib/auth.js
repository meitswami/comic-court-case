// Authentication service (server-side, plain JS)
// Vercel's @vercel/node runtime cannot resolve `.ts` imports across
// directories, so this is the canonical server-side copy that all
// Express routes import from.
//
// Behaviour mirrors src/services/auth.ts.

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { queryOne, insert, generateUUID } from './mysql.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

function generateToken(userId) {
  if (!JWT_SECRET || JWT_SECRET === 'your-secret-key-change-in-production') {
    throw new Error(
      'JWT_SECRET is not set. Configure JWT_SECRET in your environment variables.'
    );
  }
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function createSession(user, token) {
  const decoded = jwt.decode(token);
  const expiresIn = decoded && decoded.exp
    ? decoded.exp - Math.floor(Date.now() / 1000)
    : 604800;

  return {
    access_token: token,
    token_type: 'bearer',
    expires_in: expiresIn,
    user,
  };
}

export async function signUp(email, password, metadata) {
  try {
    const existingUser = await queryOne('SELECT id FROM users WHERE email = ?', [email]);
    if (existingUser) {
      return { data: null, error: new Error('User already exists') };
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userId = generateUUID();

    await insert('users', {
      id: userId,
      email,
      password_hash: passwordHash,
      email_verified: false,
      raw_user_meta_data: metadata ? JSON.stringify(metadata) : null,
    });

    await insert('profiles', {
      id: generateUUID(),
      user_id: userId,
      display_name: (metadata && metadata.display_name) || null,
      preferred_language: 'en',
    });

    await insert('user_roles', {
      id: generateUUID(),
      user_id: userId,
      role: 'user',
    });

    await insert('user_wallets', {
      id: generateUUID(),
      user_id: userId,
      balance: 0.0,
      currency: 'INR',
    });

    const user = await queryOne(
      'SELECT id, email, email_verified, raw_user_meta_data, created_at, updated_at FROM users WHERE id = ?',
      [userId]
    );

    if (!user) {
      return { data: null, error: new Error('Failed to create user') };
    }

    const token = generateToken(userId);
    return { data: { user, session: createSession(user, token) }, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

export async function signIn(email, password) {
  try {
    const userWithPassword = await queryOne(
      'SELECT id, email, email_verified, raw_user_meta_data, created_at, updated_at, password_hash FROM users WHERE email = ?',
      [email]
    );

    if (!userWithPassword) {
      return { data: null, error: new Error('Invalid email or password') };
    }

    const isValid = await bcrypt.compare(password, userWithPassword.password_hash);
    if (!isValid) {
      return { data: null, error: new Error('Invalid email or password') };
    }

    const user = {
      id: userWithPassword.id,
      email: userWithPassword.email,
      email_verified: userWithPassword.email_verified,
      raw_user_meta_data: userWithPassword.raw_user_meta_data
        ? JSON.parse(userWithPassword.raw_user_meta_data)
        : null,
      created_at: userWithPassword.created_at,
      updated_at: userWithPassword.updated_at,
    };

    const token = generateToken(user.id);
    return { data: { user, session: createSession(user, token) }, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

export async function verifyToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded || !decoded.userId) return null;
    return queryOne(
      'SELECT id, email, email_verified, raw_user_meta_data, created_at, updated_at FROM users WHERE id = ?',
      [decoded.userId]
    );
  } catch (error) {
    return null;
  }
}

export async function isAdmin(userId) {
  const role = await queryOne(
    'SELECT role FROM user_roles WHERE user_id = ? AND role = ?',
    [userId, 'admin']
  );
  return !!role;
}

export async function getUserById(userId) {
  return queryOne(
    'SELECT id, email, email_verified, raw_user_meta_data, created_at, updated_at FROM users WHERE id = ?',
    [userId]
  );
}
