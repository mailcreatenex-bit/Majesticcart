import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { z } from 'zod';
import { PERMISSIONS, sanitisePermissions } from '../auth/permissions';

/**
 * Roles and admin accounts.
 *
 * A system role (ADMIN, FINANCE, SUPPORT — seeded, `isSystem: true`) can be
 * assigned but never edited or deleted from here. That guarantee is what
 * makes the rest of RBAC safe to hand to an admin: whatever a custom role
 * gets misconfigured into, ADMIN's permission set cannot be, so there is
 * always a way back in to fix it.
 */

export const RoleInputSchema = z.object({
  name: z.string().trim().min(2, 'Name is too short').max(60),
  description: z.string().trim().max(300).optional(),
  permissions: z.array(z.string()).default([]),
});

export const AdminUserInputSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  name: z.string().trim().min(2, 'Name is too short'),
  roleId: z.string().min(1, 'Choose a role'),
  password: z.string().min(10, 'At least 10 characters').optional(),
});

@Injectable()
export class RbacService {
  constructor(private readonly prisma: PrismaClient) {}

  /** The catalogue the role editor renders as checkboxes, grouped. */
  permissionCatalogue() {
    return PERMISSIONS;
  }

  roles() {
    return this.prisma.role.findMany({
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { admins: true } } },
    });
  }

  async createRole(input: z.infer<typeof RoleInputSchema>, adminId: string) {
    const permissions = sanitisePermissions(input.permissions);
    const role = await this.prisma.role.create({
      data: { name: input.name, description: input.description, permissions },
    });
    await this.audit(adminId, 'role.create', { roleId: role.id, name: role.name, permissions });
    return role;
  }

  async updateRole(id: string, input: z.infer<typeof RoleInputSchema>, adminId: string) {
    const role = await this.prisma.role.findUniqueOrThrow({ where: { id } });
    if (role.isSystem) throw new ForbiddenException('Built-in roles cannot be edited. Create a new role instead.');
    const permissions = sanitisePermissions(input.permissions);
    const updated = await this.prisma.role.update({
      where: { id },
      data: { name: input.name, description: input.description, permissions },
    });
    await this.audit(adminId, 'role.update', { roleId: id, name: updated.name, permissions });
    return updated;
  }

  async deleteRole(id: string, adminId: string) {
    const role = await this.prisma.role.findUniqueOrThrow({ where: { id }, include: { _count: { select: { admins: true } } } });
    if (role.isSystem) throw new ForbiddenException('Built-in roles cannot be deleted.');
    if (role._count.admins > 0) throw new BadRequestException('Move the admins on this role elsewhere first.');
    await this.prisma.role.delete({ where: { id } });
    await this.audit(adminId, 'role.delete', { roleId: id, name: role.name });
    return { ok: true as const };
  }

  admins() {
    return this.prisma.adminUser.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, email: true, name: true, totpEnabled: true, lastLoginAt: true, createdAt: true,
        role: { select: { id: true, name: true } },
      },
    });
  }

  async createAdmin(input: z.infer<typeof AdminUserInputSchema>, actorId: string) {
    const existing = await this.prisma.adminUser.findUnique({ where: { email: input.email } });
    if (existing) throw new BadRequestException('An admin with that email already exists.');
    await this.prisma.role.findUniqueOrThrow({ where: { id: input.roleId } }).catch(() => {
      throw new BadRequestException('Choose a valid role.');
    });

    const password = input.password ?? randomPassword();
    const admin = await this.prisma.adminUser.create({
      data: { email: input.email, name: input.name, roleId: input.roleId, passwordHash: await argon2.hash(password) },
      select: { id: true, email: true, name: true, role: { select: { id: true, name: true } } },
    });
    await this.audit(actorId, 'admin.create', { newAdminId: admin.id, email: admin.email, roleId: input.roleId });
    // Returned once, same convention as the seed script's own printed
    // password — there is no "forgot password" for an admin account, this is
    // the only time it is ever visible in plaintext.
    return { ...admin, temporaryPassword: input.password ? undefined : password };
  }

  async updateAdminRole(id: string, roleId: string, actorId: string) {
    if (id === actorId) throw new ForbiddenException('You cannot change your own role.');
    await this.prisma.role.findUniqueOrThrow({ where: { id: roleId } }).catch(() => {
      throw new BadRequestException('Choose a valid role.');
    });
    const admin = await this.prisma.adminUser.update({
      where: { id },
      data: { roleId },
      select: { id: true, email: true, name: true, role: { select: { id: true, name: true } } },
    });
    await this.audit(actorId, 'admin.role_change', { adminId: id, roleId });
    return admin;
  }

  async resetLockout(id: string, actorId: string) {
    await this.prisma.adminUser.update({ where: { id }, data: { failedLogins: 0, lockedUntil: null } });
    await this.audit(actorId, 'admin.unlock', { adminId: id });
    return { ok: true as const };
  }

  private async audit(actorId: string, action: string, detail: object) {
    await this.prisma.auditLog.create({ data: { actorType: 'ADMIN', actorId, action, detail } });
  }
}

const randomPassword = () => `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2).toUpperCase()}!9`;
