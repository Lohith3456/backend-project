import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

// Single-row settings table — key is the gateway name
@Entity('payment_settings')
export class PaymentSettings {
  @PrimaryColumn({ type: 'varchar' })
  gateway!: 'upi' | 'card' | 'netbanking';

  @Column({ default: true })
  isEnabled!: boolean;

  @UpdateDateColumn()
  updatedAt!: Date;
}
