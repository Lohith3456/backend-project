import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { AppDataSource } from '../config/data-source';
import { Enrollment } from '../entities/Enrollment';
import { Tenant } from '../entities/Tenant';
import { User } from '../entities/User';
import { ExamType, PlanType, EnrollmentStatus } from '../enums/enrollment.enums';

const router = Router();

const DEFAULT_SLUG = process.env.DEFAULT_TENANT_SLUG || 'cognitive-sanctuary';

// Helper — extract userId from access_token cookie (optional auth)
function getUserIdFromCookie(req: Request): string | null {
  try {
    const token = req.cookies?.access_token;
    if (!token) return null;
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET!) as { sub: string };
    return payload.sub;
  } catch {
    return null;
  }
}

// POST /api/enrollments
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const { examType, plan, amountPaid, paymentMethod, referralCode, transactionId } = req.body;

  if (!examType) {
    res.status(400).json({ message: 'examType is required' });
    return;
  }

  if (!Object.values(ExamType).includes(examType)) {
    res.status(400).json({ message: `examType must be one of: ${Object.values(ExamType).join(', ')}` });
    return;
  }

  const userId = getUserIdFromCookie(req);
  if (!userId) {
    res.status(401).json({ message: 'You must be logged in to enroll' });
    return;
  }

  const tenantRepo = AppDataSource.getRepository(Tenant);
  const userRepo = AppDataSource.getRepository(User);
  const enrollRepo = AppDataSource.getRepository(Enrollment);

  const tenant = await tenantRepo.findOne({ where: { slug: DEFAULT_SLUG } });
  if (!tenant) { res.status(400).json({ message: 'Tenant not found' }); return; }

  const user = await userRepo.findOne({ where: { id: userId, tenantId: tenant.id } });
  if (!user) { res.status(404).json({ message: 'User not found' }); return; }

  // Upsert — if already enrolled update it, otherwise create
  let enrollment = await enrollRepo.findOne({
    where: { tenantId: tenant.id, userId: user.id, examType },
  });

  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setFullYear(expiresAt.getFullYear() + 1); // 1-year access

  if (enrollment) {
    // Re-enroll / upgrade
    enrollment.plan = plan ?? enrollment.plan;
    enrollment.status = EnrollmentStatus.ACTIVE;
    enrollment.startedAt = now;
    enrollment.expiresAt = expiresAt;
    enrollment.amountPaid = amountPaid ?? enrollment.amountPaid;
    enrollment.paymentMethod = paymentMethod ?? enrollment.paymentMethod;
    enrollment.referralCode = referralCode ?? enrollment.referralCode;
    enrollment.transactionId = transactionId ?? enrollment.transactionId;
  } else {
    enrollment = enrollRepo.create({
      tenantId: tenant.id,
      userId: user.id,
      examType,
      plan: plan ?? PlanType.BASIC,
      status: EnrollmentStatus.ACTIVE,
      startedAt: now,
      expiresAt,
      amountPaid: amountPaid ?? null,
      paymentMethod: paymentMethod ?? null,
      referralCode: referralCode ?? null,
      transactionId: transactionId ?? null,
    });
  }

  await enrollRepo.save(enrollment);
  res.status(201).json(enrollment);
});

// GET /api/enrollments/me — get current user's enrollments
router.get('/me', async (req: Request, res: Response): Promise<void> => {
  const userId = getUserIdFromCookie(req);
  if (!userId) { res.status(401).json({ message: 'Unauthorized' }); return; }

  const tenantRepo = AppDataSource.getRepository(Tenant);
  const enrollRepo = AppDataSource.getRepository(Enrollment);

  const tenant = await tenantRepo.findOne({ where: { slug: DEFAULT_SLUG } });
  if (!tenant) { res.status(400).json({ message: 'Tenant not found' }); return; }

  const enrollments = await enrollRepo.find({
    where: { tenantId: tenant.id, userId },
    order: { createdAt: 'DESC' },
  });

  res.json(enrollments);
});

export default router;
