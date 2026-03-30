import {
  Entity, PrimaryGeneratedColumn, Column,
  ManyToOne, JoinColumn, Unique
} from 'typeorm';
import { User } from './User';
import { Tenant } from './Tenant';

export enum Role {
  ADMIN = 'admin',
  USER = 'user',
}

@Entity('user_roles')
@Unique(['userId', 'tenantId'])
export class UserRole {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ nullable: false })
  userId!: string;

  @Column({ nullable: false })
  tenantId!: string;

  @Column({ type: 'enum', enum: Role, nullable: false })
  role!: Role;

  @ManyToOne(() => User, (user) => user.userRoles)
  @JoinColumn({ name: 'userId' })
  user!: User;

  @ManyToOne(() => Tenant, (tenant) => tenant.userRoles)
  @JoinColumn({ name: 'tenantId' })
  tenant!: Tenant;
}
