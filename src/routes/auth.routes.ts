import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { AppDataSource } from '../config/data-source';
import { Tenant } from '../entities/Tenant';
import { User } from '../entities/User';
import { UserRole } from '../entities/UserRole';
import { RefreshToken } from '../entities/RefreshToken';

const router = Router();

const COOKIE_OPTS_ACCESS = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict' as const,
  maxAge: 15 * 60 * 1000, // 15 min
};

const COOKIE_OPTS_REFRESH = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  const { email, password, tenantSlug } = req.body;

  if (!email || !password || !tenantSlug) {
    res.status(400).json({ message: 'email, password and tenantSlug are required' });
    return;
  }

  const tenantRepo = AppDataSource.getRepository(Tenant);
  const userRepo = AppDataSource.getRepository(User);
  const userRoleRepo = AppDataSource.getRepository(UserRole);
  const refreshTokenRepo = AppDataSource.getRepository(RefreshToken);

  // Step 1 — find tenant
  const tenant = await tenantRepo.findOne({ where: { slug: tenantSlug } });
  if (!tenant || !tenant.isActive) {
    res.status(401).json({ message: 'Invalid credentials' });
    return;
  }

  // Step 1 — find user
  const user = await userRepo.findOne({ where: { tenantId: tenant.id, email } });
  if (!user || !user.isActive) {
    res.status(401).json({ message: 'Invalid credentials' });
    return;
  }

  // Step 1 — verify password
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ message: 'Invalid credentials' });
    return;
  }

  // Step 2 — role lookup
  const userRole = await userRoleRepo.findOne({
    where: { userId: user.id, tenantId: tenant.id },
  });
  if (!userRole) {
    res.status(401).json({ message: 'Invalid credentials' });
    return;
  }

  // Step 3 — sign access token
  const accessToken = jwt.sign(
    { sub: user.id, tenantId: tenant.id, role: userRole.role, email: user.email },
    process.env.JWT_ACCESS_SECRET!,
    { expiresIn: '15m' }
  );

  // Step 4 — create refresh token
  const rawToken = crypto.randomBytes(64).toString('hex');
  const hashedToken = await bcrypt.hash(rawToken, 12);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const refreshTokenEntity = refreshTokenRepo.create({
    userId: user.id,
    tenantId: tenant.id,
    token: hashedToken,
    expiresAt,
  });
  await refreshTokenRepo.save(refreshTokenEntity);

  // Step 5 — set cookies
  res.cookie('access_token', accessToken, COOKIE_OPTS_ACCESS);
  res.cookie('refresh_token', rawToken, COOKIE_OPTS_REFRESH);

  res.json({ role: userRole.role, email: user.email });
});

// POST /api/auth/refresh
router.post('/refresh', async (req: Request, res: Response): Promise<void> => {
  const rawToken: string | undefined = req.cookies?.refresh_token;
  if (!rawToken) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  const refreshTokenRepo = AppDataSource.getRepository(RefreshToken);
  const userRepo = AppDataSource.getRepository(User);
  const userRoleRepo = AppDataSource.getRepository(UserRole);

  // Find all non-revoked, non-expired tokens and compare
  const candidates = await refreshTokenRepo.find({
    where: { isRevoked: false },
  });

  let matched: RefreshToken | null = null;
  for (const candidate of candidates) {
    if (candidate.expiresAt < new Date()) continue;
    const ok = await bcrypt.compare(rawToken, candidate.token);
    if (ok) { matched = candidate; break; }
  }

  if (!matched) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  // Revoke old token
  matched.isRevoked = true;
  await refreshTokenRepo.save(matched);

  // Get user + role
  const user = await userRepo.findOne({ where: { id: matched.userId } });
  if (!user || !user.isActive) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  const userRole = await userRoleRepo.findOne({
    where: { userId: user.id, tenantId: matched.tenantId },
  });
  if (!userRole) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  // Issue new access token
  const accessToken = jwt.sign(
    { sub: user.id, tenantId: matched.tenantId, role: userRole.role, email: user.email },
    process.env.JWT_ACCESS_SECRET!,
    { expiresIn: '15m' }
  );

  // Issue new refresh token (rotation)
  const newRaw = crypto.randomBytes(64).toString('hex');
  const newHashed = await bcrypt.hash(newRaw, 12);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const newRefresh = refreshTokenRepo.create({
    userId: user.id,
    tenantId: matched.tenantId,
    token: newHashed,
    expiresAt,
  });
  await refreshTokenRepo.save(newRefresh);

  res.cookie('access_token', accessToken, COOKIE_OPTS_ACCESS);
  res.cookie('refresh_token', newRaw, COOKIE_OPTS_REFRESH);

  res.json({ role: userRole.role, email: user.email });
});

// POST /api/auth/logout
router.post('/logout', async (req: Request, res: Response): Promise<void> => {
  const rawToken: string | undefined = req.cookies?.refresh_token;

  if (rawToken) {
    const refreshTokenRepo = AppDataSource.getRepository(RefreshToken);
    const candidates = await refreshTokenRepo.find({ where: { isRevoked: false } });

    for (const candidate of candidates) {
      const ok = await bcrypt.compare(rawToken, candidate.token);
      if (ok) {
        candidate.isRevoked = true;
        await refreshTokenRepo.save(candidate);
        break;
      }
    }
  }

  res.clearCookie('access_token');
  res.clearCookie('refresh_token');
  res.json({ message: 'Logged out' });
});

export default router;
