import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn,
  ManyToOne, JoinColumn, Unique, Index
} from 'typeorm';
import { Tenant } from './Tenant';
import { User } from './User';
import { ExamType, PlanType, EnrollmentStatus } from '../enums/enrollment.enums';

@Entity('user_enrollments')
@Unique(['tenantId', 'userId', 'examType'])
@Index(['tenantId', 'userId'])
@Index(['tenantId', 'examType'])
export class Enrollment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ nullable: false })
  tenantId!: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenantId' })
  tenant!: Tenant;

  @Column({ nullable: false })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'enum', enum: ExamType, nullable: false })
  examType!: ExamType;

  @Column({ type: 'enum', enum: PlanType, default: PlanType.BASIC })
  plan!: PlanType;

  @Column({ type: 'enum', enum: EnrollmentStatus, default: EnrollmentStatus.PENDING })
  status!: EnrollmentStatus;

  @Column({ type: 'timestamp', nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  expiresAt!: Date | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  amountPaid!: number | null;

  @Column({ type: 'varchar', nullable: true })
  paymentMethod!: string | null;

  @Column({ type: 'varchar', nullable: true })
  referralCode!: string | null;

  @Column({ type: 'varchar', nullable: true })
  transactionId!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
