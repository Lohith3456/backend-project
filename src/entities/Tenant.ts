import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, OneToMany
} from 'typeorm';
import { User } from './User';
import { UserRole } from './UserRole';

@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ nullable: false })
  name!: string;

  @Column({ unique: true, nullable: false })
  slug!: string;

  @Column({ default: true })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @OneToMany(() => User, (user) => user.tenant)
  users!: User[];

  @OneToMany(() => UserRole, (ur) => ur.tenant)
  userRoles!: UserRole[];
}
