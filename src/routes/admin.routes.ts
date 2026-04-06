import { Router, Request, Response } from 'express';
import { protect, requireRole } from '../middleware/auth.middleware';
import bcrypt from 'bcryptjs';
import { AppDataSource } from '../config/data-source';
import { User } from '../entities/User';
import { UserRole, Role } from '../entities/UserRole';
import { Tenant } from '../entities/Tenant';
import { ReferralCode } from '../entities/ReferralCode';
import { PaymentSettings } from '../entities/PaymentSettings';

const router = Router();

function timeAgo(date: Date, now: number): string {
  const diff = Math.floor((now - date.getTime()) / 1000);
  if (diff < 60) return `${diff} seconds ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  return `${Math.floor(diff / 86400)} days ago`;
}

// GET /api/admin/stats — no JWT needed (admin page uses sessionStorage auth)
router.get('/stats', async (req: Request, res: Response): Promise<void> => {
  try {
    const userRepo = AppDataSource.getRepository(User);
    const userRoleRepo = AppDataSource.getRepository(UserRole);

    const totalUsers = await userRepo.count({ where: { isActive: true } });
    const activeSubscriptions = await userRoleRepo.count();

    res.json({
      totalUsers,
      activeSubscriptions,
      mockTestsTaken: 0,
      avgBandScore: null,
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ message: 'Failed to fetch stats' });
  }
});

// GET /api/admin/users — paginated user list with search
router.get('/users', async (req: Request, res: Response): Promise<void> => {
  try {
    const userRepo = AppDataSource.getRepository(User);
    const userRoleRepo = AppDataSource.getRepository(UserRole);

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, parseInt(req.query.limit as string) || 10);
    const search = (req.query.search as string || '').toLowerCase().trim();

    const [users, total] = await userRepo.findAndCount({
      where: { isActive: true },
      order: { createdAt: 'DESC' },
    });

    // Filter by search
    const filtered = search
      ? users.filter(u => u.email.toLowerCase().includes(search))
      : users;

    // Paginate
    const paginated = filtered.slice((page - 1) * limit, page * limit);

    // Fetch roles for these users
    const userIds = paginated.map(u => u.id);
    const roles = userIds.length
      ? await userRoleRepo.createQueryBuilder('ur')
          .where('ur.userId IN (:...ids)', { ids: userIds })
          .getMany()
      : [];

    const roleMap = new Map(roles.map(r => [r.userId, r.role]));

    const now = Date.now();
    const result = paginated.map(u => ({
      id: u.id,
      email: u.email,
      phone: u.phone,
      username: u.username,
      firstName: u.firstName,
      lastName: u.lastName,
      displayName: u.firstName
        ? [u.firstName, u.lastName].filter(Boolean).join(' ')
        : u.email.split('@')[0],
      role: roleMap.get(u.id) || 'user',
      status: 'Active',
      joinedAgo: timeAgo(new Date(u.createdAt), now),
      createdAt: u.createdAt,
    }));

    res.json({ users: result, total: filtered.length, page, limit });
  } catch (err) {
    console.error('Users error:', err);
    res.status(500).json({ message: 'Failed to fetch users' });
  }
});

// GET /api/admin/activity?from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns hourly user registration counts for the given date range
router.get('/activity', async (req: Request, res: Response): Promise<void> => {
  try {
    const userRepo = AppDataSource.getRepository(User);

    const from = req.query.from ? new Date(req.query.from as string) : new Date(Date.now() - 30 * 86400000);
    const to = req.query.to ? new Date(req.query.to as string) : new Date();
    // Set to end of day
    to.setHours(23, 59, 59, 999);

    const users = await userRepo
      .createQueryBuilder('u')
      .where('u.createdAt >= :from AND u.createdAt <= :to', { from, to })
      .select(['u.createdAt'])
      .getMany();

    // Bucket by hour (0-23)
    const buckets: Record<number, number> = {};
    for (let h = 0; h < 24; h += 4) buckets[h] = 0;

    for (const u of users) {
      const hour = new Date(u.createdAt).getHours();
      const bucket = Math.floor(hour / 4) * 4;
      buckets[bucket] = (buckets[bucket] || 0) + 1;
    }

    const data = Object.entries(buckets).map(([hour, value]) => ({
      label: `${String(hour).padStart(2, '0')}:00`,
      value,
    }));

    res.json({ data, total: users.length });
  } catch (err) {
    console.error('Activity error:', err);
    res.status(500).json({ message: 'Failed to fetch activity' });
  }
});

// POST /api/admin/faculty — onboard a new faculty member
router.post('/faculty', async (req: Request, res: Response): Promise<void> => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    res.status(400).json({ message: 'name, email and password are required' });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ message: 'Password must be at least 8 characters' });
    return;
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    res.status(400).json({ message: 'Invalid email address' });
    return;
  }

  const DEFAULT_SLUG = process.env.DEFAULT_TENANT_SLUG || 'cognitive-sanctuary';
  const tenantRepo = AppDataSource.getRepository(Tenant);
  const userRepo = AppDataSource.getRepository(User);
  const userRoleRepo = AppDataSource.getRepository(UserRole);

  let tenant = await tenantRepo.findOne({ where: { slug: DEFAULT_SLUG } });
  if (!tenant) {
    tenant = tenantRepo.create({ name: 'Cognitive Sanctuary', slug: DEFAULT_SLUG, isActive: true });
    await tenantRepo.save(tenant);
  }

  const existing = await userRepo.findOne({ where: { tenantId: tenant.id, email } });
  if (existing) {
    res.status(409).json({ message: 'Email already registered' });
    return;
  }

  const nameParts = name.trim().split(/\s+/);
  const firstName = nameParts[0];
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;
  const username = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '');

  const passwordHash = await bcrypt.hash(password, 12);
  const user = userRepo.create({
    tenantId: tenant.id,
    email,
    username,
    firstName,
    lastName,
    passwordHash,
    isActive: true,
  });
  await userRepo.save(user);

  // Assign 'user' role (faculty use same login as users)
  const userRole = userRoleRepo.create({ userId: user.id, tenantId: tenant.id, role: Role.USER });
  await userRoleRepo.save(userRole);

  res.status(201).json({ message: 'Faculty member created successfully', email, username });
});

// GET /api/admin/payment-settings — returns enabled state for all gateways
router.get('/payment-settings', async (req: Request, res: Response): Promise<void> => {
  try {
    const repo = AppDataSource.getRepository(PaymentSettings);
    const rows = await repo.find();

    // Seed defaults if not yet in DB
    const defaults: Record<string, boolean> = { upi: true, card: true, netbanking: false };
    const result: Record<string, boolean> = { ...defaults };
    for (const row of rows) result[row.gateway] = row.isEnabled;

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch payment settings' });
  }
});

// PATCH /api/admin/payment-settings/:gateway — toggle a gateway on/off
router.patch('/payment-settings/:gateway', async (req: Request, res: Response): Promise<void> => {
  const gateway = req.params.gateway as 'upi' | 'card' | 'netbanking';
  if (!['upi', 'card', 'netbanking'].includes(gateway)) {
    res.status(400).json({ message: 'Invalid gateway' }); return;
  }
  const { isEnabled } = req.body;
  if (typeof isEnabled !== 'boolean') {
    res.status(400).json({ message: 'isEnabled (boolean) is required' }); return;
  }
  try {
    const repo = AppDataSource.getRepository(PaymentSettings);
    let row = await repo.findOne({ where: { gateway } });
    if (!row) {
      row = repo.create({ gateway, isEnabled });
    } else {
      row.isEnabled = isEnabled;
    }
    await repo.save(row);
    res.json({ gateway, isEnabled });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update payment setting' });
  }
});

// POST /api/admin/referrals/validate — validate a code and return discount info
router.post('/referrals/validate', async (req: Request, res: Response): Promise<void> => {
  const { code } = req.body;
  if (!code) { res.status(400).json({ message: 'code is required' }); return; }
  try {
    const repo = AppDataSource.getRepository(ReferralCode);
    const entry = await repo.findOne({ where: { code: code.toUpperCase() } });

    if (!entry) { res.status(404).json({ message: 'Invalid referral code' }); return; }
    if (!entry.isActive) { res.status(400).json({ message: 'This code is no longer active' }); return; }
    if (entry.expiresAt && new Date(entry.expiresAt) < new Date()) {
      res.status(400).json({ message: 'This code has expired' }); return;
    }
    if (entry.maxUsage !== null && entry.usageCount >= entry.maxUsage) {
      res.status(400).json({ message: 'This code has reached its usage limit' }); return;
    }

    res.json({
      valid: true,
      code: entry.code,
      discountType: entry.discountType,
      discountAmount: Number(entry.discountAmount),
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to validate code' });
  }
});

// POST /api/admin/referrals/redeem — increment usage after successful payment
router.post('/referrals/redeem', async (req: Request, res: Response): Promise<void> => {
  const { code } = req.body;
  if (!code) { res.status(400).json({ message: 'code is required' }); return; }
  try {
    const repo = AppDataSource.getRepository(ReferralCode);
    const entry = await repo.findOne({ where: { code: code.toUpperCase() } });
    if (entry) {
      entry.usageCount += 1;
      await repo.save(entry);
    }
    res.json({ message: 'Redeemed' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to redeem code' });
  }
});
// GET /api/admin/referrals
router.get('/referrals', async (req: Request, res: Response): Promise<void> => {
  try {
    const repo = AppDataSource.getRepository(ReferralCode);
    const codes = await repo.find({ order: { createdAt: 'DESC' } });
    res.json(codes);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch referral codes' });
  }
});

// POST /api/admin/referrals
router.post('/referrals', async (req: Request, res: Response): Promise<void> => {
  const { code, discountType, discountAmount, discountPercent, expiresAt, maxUsage } = req.body;
  if (!code || !discountType || discountAmount == null) {
    res.status(400).json({ message: 'code, discountType and discountAmount are required' });
    return;
  }
  try {
    const repo = AppDataSource.getRepository(ReferralCode);
    const existing = await repo.findOne({ where: { code: code.toUpperCase() } });
    if (existing) { res.status(409).json({ message: 'Code already exists' }); return; }

    const entry = repo.create({
      code: code.toUpperCase(),
      discountType,
      discountAmount,
      discountPercent: discountPercent || null,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      maxUsage: maxUsage || null,
      isActive: true,
    });
    await repo.save(entry);
    res.status(201).json(entry);
  } catch (err) {
    res.status(500).json({ message: 'Failed to create referral code' });
  }
});

// PATCH /api/admin/referrals/:id — toggle active
router.patch('/referrals/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const repo = AppDataSource.getRepository(ReferralCode);
    const entry = await repo.findOne({ where: { id: req.params.id } });
    if (!entry) { res.status(404).json({ message: 'Not found' }); return; }
    entry.isActive = req.body.isActive ?? !entry.isActive;
    await repo.save(entry);
    res.json(entry);
  } catch (err) {
    res.status(500).json({ message: 'Failed to update' });
  }
});

// DELETE /api/admin/referrals/:id
router.delete('/referrals/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const repo = AppDataSource.getRepository(ReferralCode);
    await repo.delete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete' });
  }
});

router.use(protect, requireRole('admin'));

router.get('/dashboard', (req: Request, res: Response) => {
  res.json({ message: 'Admin dashboard', user: req.user });
});

export default router;
