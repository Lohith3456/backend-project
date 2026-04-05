import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import twilio from 'twilio';
import { AppDataSource } from '../config/data-source';
import { Tenant } from '../entities/Tenant';
import { User } from '../entities/User';
import { UserRole, Role } from '../entities/UserRole';
import { RefreshToken } from '../entities/RefreshToken';

const router = Router();

function getTwilioClient() {
  return twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
}

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

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  const { name, email, password } = req.body;
  let phone: string | undefined = req.body.phone;

  if (!name || !email || !password) {
    res.status(400).json({ message: 'name, email and password are required' });
    return;
  }

  // Regex validations
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    res.status(400).json({ message: 'Invalid email address' });
    return;
  }

  if (phone) {
    const phoneRegex = /^\+?[1-9]\d{6,14}$/;
    if (!phoneRegex.test(phone.replace(/[\s\-()]/g, ''))) {
      res.status(400).json({ message: 'Invalid phone number' });
      return;
    }
    // Normalize to E.164
    phone = phone.replace(/[\s\-()]/g, '');
    if (!phone.startsWith('+')) {
      res.status(400).json({ message: 'Phone number must include country code (e.g. +917288822579)' });
      return;
    }
  }

  if (password.length < 8) {
    res.status(400).json({ message: 'Password must be at least 8 characters' });
    return;
  }

  const tenantRepo = AppDataSource.getRepository(Tenant);
  const userRepo = AppDataSource.getRepository(User);
  const userRoleRepo = AppDataSource.getRepository(UserRole);

  // Use default tenant
  const DEFAULT_SLUG = process.env.DEFAULT_TENANT_SLUG || 'cognitive-sanctuary';
  let tenant = await tenantRepo.findOne({ where: { slug: DEFAULT_SLUG } });
  if (!tenant) {
    tenant = tenantRepo.create({ name: 'Cognitive Sanctuary', slug: DEFAULT_SLUG, isActive: true });
    await tenantRepo.save(tenant);
  }

  // Check duplicate email
  const existingEmail = await userRepo.findOne({ where: { tenantId: tenant.id, email } });
  if (existingEmail) {
    res.status(409).json({ message: 'Email already registered' });
    return;
  }

  // Check duplicate phone
  if (phone) {
    const existingPhone = await userRepo.findOne({ where: { tenantId: tenant.id, phone } });
    if (existingPhone) {
      res.status(409).json({ message: 'Phone number already registered' });
      return;
    }
  }

  const passwordHash = await bcrypt.hash(password, 12);

  // Derive username and name parts from the `name` field or email
  const trimmedName = (name as string).trim();
  const nameParts = trimmedName.split(/\s+/);
  const firstName = nameParts[0] || trimmedName;
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;
  // username = first part of email before @, lowercased
  const username = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '');

  const user = userRepo.create({
    tenantId: tenant.id,
    email,
    phone: phone || null,
    username,
    firstName,
    lastName,
    passwordHash,
    isActive: true,
  });
  await userRepo.save(user);

  const userRole = userRoleRepo.create({ userId: user.id, tenantId: tenant.id, role: Role.USER });
  await userRoleRepo.save(userRole);

  res.status(201).json({ message: 'Account created. Please log in.' });
});

// POST /api/auth/otp/send  — uses Twilio Verify
router.post('/otp/send', async (req: Request, res: Response): Promise<void> => {
  let { phone } = req.body;
  if (!phone) {
    res.status(400).json({ message: 'Phone number is required' });
    return;
  }

  // Normalize to E.164 — strip spaces/dashes/parens, add + if missing
  phone = phone.replace(/[\s\-()]/g, '');
  if (!phone.startsWith('+')) {
    res.status(400).json({ message: 'Phone number must include country code (e.g. +917288822579)' });
    return;
  }

  const DEFAULT_SLUG = process.env.DEFAULT_TENANT_SLUG || 'cognitive-sanctuary';
  const tenantRepo = AppDataSource.getRepository(Tenant);
  const userRepo = AppDataSource.getRepository(User);

  const tenant = await tenantRepo.findOne({ where: { slug: DEFAULT_SLUG } });
  if (!tenant) { res.status(401).json({ message: 'No account found with this phone number' }); return; }

  // Try exact E.164 match first, then fallback: match by last 10 digits (handles legacy data without country code)
  let user = await userRepo.findOne({ where: { tenantId: tenant.id, phone } });
  if (!user) {
    const last10 = phone.slice(-10);
    const allUsers = await userRepo.find({ where: { tenantId: tenant.id } });
    const matched = allUsers.find(u => u.phone && u.phone.replace(/[\s\-()+ ]/g, '').slice(-10) === last10);
    if (matched) {
      // Upgrade stored number to E.164
      matched.phone = phone;
      await userRepo.save(matched);
      user = matched;
    }
  }
  if (!user || !user.isActive) {
    res.status(401).json({ message: 'No account found with this phone number' });
    return;
  }

  try {
    await getTwilioClient().verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID!)
      .verifications.create({ to: phone, channel: 'sms' });
    res.json({ message: 'OTP sent successfully' });
  } catch (err: any) {
    console.error('Twilio Verify error:', err);
    res.status(500).json({ message: 'Failed to send OTP. Please try again.' });
  }
});

// POST /api/auth/otp/verify  — uses Twilio Verify
router.post('/otp/verify', async (req: Request, res: Response): Promise<void> => {
  let { phone, otp } = req.body;
  if (!phone || !otp) {
    res.status(400).json({ message: 'Phone and OTP are required' });
    return;
  }
  phone = phone.replace(/[\s\-()]/g, '');

  try {
    const check = await getTwilioClient().verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID!)
      .verificationChecks.create({ to: phone, code: otp });

    if (check.status !== 'approved') {
      res.status(401).json({ message: 'Invalid or expired OTP' });
      return;
    }
  } catch (err) {
    console.error('Twilio Verify check error:', err);
    res.status(401).json({ message: 'Invalid or expired OTP' });
    return;
  }

  const DEFAULT_SLUG = process.env.DEFAULT_TENANT_SLUG || 'cognitive-sanctuary';
  const tenantRepo = AppDataSource.getRepository(Tenant);
  const userRepo = AppDataSource.getRepository(User);
  const userRoleRepo = AppDataSource.getRepository(UserRole);
  const refreshTokenRepo = AppDataSource.getRepository(RefreshToken);

  const tenant = await tenantRepo.findOne({ where: { slug: DEFAULT_SLUG } });
  if (!tenant) { res.status(401).json({ message: 'Invalid credentials' }); return; }

  let user = await userRepo.findOne({ where: { tenantId: tenant.id, phone } });
  if (!user) {
    const last10 = phone.slice(-10);
    const allUsers = await userRepo.find({ where: { tenantId: tenant.id } });
    const matched = allUsers.find(u => u.phone && u.phone.replace(/[\s\-()+ ]/g, '').slice(-10) === last10);
    if (matched) { matched.phone = phone; await userRepo.save(matched); user = matched; }
  }
  if (!user || !user.isActive) { res.status(401).json({ message: 'Invalid credentials' }); return; }

  const userRole = await userRoleRepo.findOne({ where: { userId: user.id, tenantId: tenant.id } });
  if (!userRole) { res.status(401).json({ message: 'Invalid credentials' }); return; }

  const accessToken = jwt.sign(
    { sub: user.id, tenantId: tenant.id, role: userRole.role, email: user.email },
    process.env.JWT_ACCESS_SECRET!,
    { expiresIn: '15m' }
  );

  const rawToken = crypto.randomBytes(64).toString('hex');
  const hashedToken = await bcrypt.hash(rawToken, 12);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await refreshTokenRepo.save(
    refreshTokenRepo.create({ userId: user.id, tenantId: tenant.id, token: hashedToken, expiresAt })
  );

  res.cookie('access_token', accessToken, COOKIE_OPTS_ACCESS);
  res.cookie('refresh_token', rawToken, COOKIE_OPTS_REFRESH);
  res.json({ role: userRole.role, email: user.email });
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  const { email, phone, password } = req.body;
  const DEFAULT_SLUG = process.env.DEFAULT_TENANT_SLUG || 'cognitive-sanctuary';

  if ((!email && !phone) || !password) {
    res.status(400).json({ message: 'Email or phone, and password are required' });
    return;
  }

  const tenantRepo = AppDataSource.getRepository(Tenant);
  const userRepo = AppDataSource.getRepository(User);
  const userRoleRepo = AppDataSource.getRepository(UserRole);
  const refreshTokenRepo = AppDataSource.getRepository(RefreshToken);

  const tenant = await tenantRepo.findOne({ where: { slug: DEFAULT_SLUG } });
  if (!tenant || !tenant.isActive) {
    res.status(401).json({ message: 'Invalid credentials' });
    return;
  }

  // Find user by whichever identifier was provided
  let user = null;
  if (phone) {
    user = await userRepo.findOne({ where: { tenantId: tenant.id, phone } });
  }
  if (!user && email) {
    user = await userRepo.findOne({ where: { tenantId: tenant.id, email } });
  }

  if (!user || !user.isActive) {
    res.status(401).json({ message: 'Invalid credentials' });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ message: 'Invalid credentials' });
    return;
  }

  const userRole = await userRoleRepo.findOne({
    where: { userId: user.id, tenantId: tenant.id },
  });
  if (!userRole) {
    res.status(401).json({ message: 'Invalid credentials' });
    return;
  }

  const accessToken = jwt.sign(
    { sub: user.id, tenantId: tenant.id, role: userRole.role, email: user.email },
    process.env.JWT_ACCESS_SECRET!,
    { expiresIn: '15m' }
  );

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
