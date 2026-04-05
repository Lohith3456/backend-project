import {
  Entity, PrimaryGeneratedColumn, Column,
  ManyToOne, JoinColumn, Unique, CreateDateColumn
} from 'typeorm';
import { RoleEntity } from './RoleEntity';
import { Permission } from './Permission';

@Entity('role_permissions')
@Unique(['roleId', 'permissionId'])
export class RolePermission {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ nullable: false })
  roleId!: string;

  @Column({ nullable: false })
  permissionId!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @ManyToOne(() => RoleEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'roleId' })
  role!: RoleEntity;

  @ManyToOne(() => Permission, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'permissionId' })
  permission!: Permission;
}
