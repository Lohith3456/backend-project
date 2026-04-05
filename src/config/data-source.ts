import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Tenant } from '../entities/Tenant';
import { User } from '../entities/User';
import { UserRole } from '../entities/UserRole';
import { RefreshToken } from '../entities/RefreshToken';
import { RoleEntity } from '../entities/RoleEntity';
import { Permission } from '../entities/Permission';
import { RolePermission } from '../entities/RolePermission';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  entities: [Tenant, User, UserRole, RefreshToken, RoleEntity, Permission, RolePermission],
  synchronize: true,
  logging: process.env.NODE_ENV === 'development',
});
