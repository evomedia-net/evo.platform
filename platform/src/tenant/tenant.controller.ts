import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { TenantAdminGuard } from './tenant-admin.guard';
import { TenantService } from './tenant.service';
import { CreateMemberDto, SetMemberRolesDto, UpdateMemberDto } from './dto';

interface TenantAdminRequest {
  user: { sub: string; tenant_id: string };
}

/** Self-service member management for tenant admins. Tenant scope always comes
 *  from the verified token — see TenantAdminGuard. */
@Controller('tenant')
@UseGuards(JwtAuthGuard, TenantAdminGuard)
export class TenantController {
  constructor(private tenant: TenantService) {}

  @Get('users')
  list(@Req() req: TenantAdminRequest) {
    return this.tenant.list(req.user.tenant_id);
  }

  @Get('roles')
  listRoles(@Req() req: TenantAdminRequest) {
    return this.tenant.listRoles(req.user.tenant_id);
  }

  @Post('users')
  create(@Req() req: TenantAdminRequest, @Body() dto: CreateMemberDto) {
    return this.tenant.create(req.user.tenant_id, req.user.sub, dto);
  }

  @Patch('users/:id')
  update(
    @Req() req: TenantAdminRequest,
    @Param('id') id: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.tenant.update(req.user.tenant_id, req.user.sub, id, dto);
  }

  @Delete('users/:id')
  deactivate(@Req() req: TenantAdminRequest, @Param('id') id: string) {
    return this.tenant.deactivate(req.user.tenant_id, req.user.sub, id);
  }

  @Post('users/:id/restore')
  restore(@Req() req: TenantAdminRequest, @Param('id') id: string) {
    return this.tenant.restore(req.user.tenant_id, req.user.sub, id);
  }

  @Put('users/:id/roles')
  setRoles(
    @Req() req: TenantAdminRequest,
    @Param('id') id: string,
    @Body() dto: SetMemberRolesDto,
  ) {
    return this.tenant.setRoles(req.user.tenant_id, req.user.sub, id, dto.roleIds);
  }
}
