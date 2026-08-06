// Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { UsersService } from './users.service';
import { CreateUserDto, SetRolesDto, UpdateUserDto } from './dto';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class UsersController {
  constructor(private users: UsersService) {}

  /** ?tenantId=<id> filters to a tenant; ?tenantId=platform filters to platform-level users. */
  @Get()
  list(
    @Query('tenantId') tenantId?: string,
    @Query('includeDeleted') includeDeleted?: string,
  ) {
    const filter = tenantId === 'platform' ? null : tenantId;
    return this.users.list(filter, includeDeleted === 'true');
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.users.get(id);
  }

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.users.remove(id);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string) {
    return this.users.restore(id);
  }

  @Delete(':id/purge')
  purge(@Param('id') id: string) {
    return this.users.purge(id);
  }

  @Put(':id/roles')
  setRoles(@Param('id') id: string, @Body() dto: SetRolesDto) {
    return this.users.setRoles(id, dto.roleIds);
  }
}
