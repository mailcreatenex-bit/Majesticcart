import { z } from 'zod';
import { Body, Controller, Get, Param, Post, Put, HttpCode } from '@nestjs/common';
import { zodBody } from '../common/zod.pipe';
import { RequirePermission, CurrentUser } from '../auth/guards';
import { RbacService, RoleInputSchema, AdminUserInputSchema } from './rbac.service';

@RequirePermission('roles.manage')
@Controller('admin/roles')
export class RoleController {
  constructor(private readonly rbac: RbacService) {}

  @Get('permissions')
  permissions() {
    return this.rbac.permissionCatalogue();
  }

  @Get()
  list() {
    return this.rbac.roles();
  }

  @Post()
  create(@Body(zodBody(RoleInputSchema)) body: z.infer<typeof RoleInputSchema>, @CurrentUser('sub') adminId: string) {
    return this.rbac.createRole(body, adminId);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body(zodBody(RoleInputSchema)) body: z.infer<typeof RoleInputSchema>,
    @CurrentUser('sub') adminId: string,
  ) {
    return this.rbac.updateRole(id, body, adminId);
  }

  @Post(':id/delete')
  @HttpCode(200)
  delete(@Param('id') id: string, @CurrentUser('sub') adminId: string) {
    return this.rbac.deleteRole(id, adminId);
  }
}

@RequirePermission('roles.manage')
@Controller('admin/admins')
export class AdminUserController {
  constructor(private readonly rbac: RbacService) {}

  @Get()
  list() {
    return this.rbac.admins();
  }

  @Post()
  create(@Body(zodBody(AdminUserInputSchema)) body: z.infer<typeof AdminUserInputSchema>, @CurrentUser('sub') adminId: string) {
    return this.rbac.createAdmin(body, adminId);
  }

  @Put(':id/role')
  updateRole(
    @Param('id') id: string,
    @Body(zodBody(z.object({ roleId: z.string().min(1) }))) body: { roleId: string },
    @CurrentUser('sub') adminId: string,
  ) {
    return this.rbac.updateAdminRole(id, body.roleId, adminId);
  }

  @Post(':id/unlock')
  @HttpCode(200)
  unlock(@Param('id') id: string, @CurrentUser('sub') adminId: string) {
    return this.rbac.resetLockout(id, adminId);
  }
}
