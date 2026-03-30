import { Router, Request, Response } from 'express';
import { protect, requireRole } from '../middleware/auth.middleware';

const router = Router();

router.use(protect, requireRole('admin'));

router.get('/dashboard', (req: Request, res: Response) => {
  res.json({ message: 'Admin dashboard', user: req.user });
});

export default router;
