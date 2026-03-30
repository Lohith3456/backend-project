import { Router, Request, Response } from 'express';
import { protect, requireRole } from '../middleware/auth.middleware';

const router = Router();

router.use(protect, requireRole('user'));

router.get('/dashboard', (req: Request, res: Response) => {
  res.json({ message: 'User dashboard', user: req.user });
});

export default router;
