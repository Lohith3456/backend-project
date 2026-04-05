import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, OneToMany
} from 'typeorm';

@Entity('permissions')
export class Permission {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true, nullable: false })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', nullable: true })
  resource!: string | null;

  @Column({ type: 'varchar', nullable: true })
  action!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @OneToMany('RolePermission', 'permission')
  rolePermissions!: any[];
}
