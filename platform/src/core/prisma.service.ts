import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    // Prisma 7: constructing a client without options THROWS — a driver
    // adapter is required. That failure happens at runtime, not at build or
    // type-check, so it has to be wired here rather than discovered in prod.
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      // A named error beats the adapter's generic one: this is the first
      // thing a misconfigured deployment would hit.
      throw new Error('DATABASE_URL is not set — the platform cannot reach its database');
    }
    super({ adapter: new PrismaPg({ connectionString }) });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
