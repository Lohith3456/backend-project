import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('referral_codes')
export class ReferralCode {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true, nullable: false })
  code!: string;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: false })
  discountAmount!: number; // fixed $ discount

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  discountPercent!: number | null; // % discount (optional)

  @Column({ type: 'varchar', default: 'fixed' })
  discountType!: 'fixed' | 'percent';

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  @Column({ default: true })
  isActive!: boolean;

  @Column({ default: 0 })
  usageCount!: number;

  @Column({ type: 'int', nullable: true })
  maxUsage!: number | null;

  @CreateDateColumn()
  createdAt!: Date;
}
