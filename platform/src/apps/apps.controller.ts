import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { AppsService } from './apps.service';
import { CreateAppDto, CreateRoleDto, UpdateAppDto } from './dto';

@Controller('admin/apps')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class AppsController {
  constructor(private apps: AppsService) {}

  @Get()
  list() {
    return this.apps.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.apps.get(id);
  }

  @Post()
  create(@Body() dto: CreateAppDto) {
    return this.apps.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAppDto) {
    return this.apps.update(id, dto);
  }

  @Post(':id/rotate-secret')
  rotateSecret(@Param('id') id: string) {
    return this.apps.rotateSecret(id);
  }

  @Get(':id/roles')
  listRoles(@Param('id') id: string) {
    return this.apps.listRoles(id);
  }

  @Post(':id/roles')
  addRole(@Param('id') id: string, @Body() dto: CreateRoleDto) {
    return this.apps.addRole(id, dto);
  }
}
