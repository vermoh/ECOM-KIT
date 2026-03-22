import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { DRIZZLE } from '../db/db.module';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@ecom-kit/shared-db';
import { eq } from 'drizzle-orm';

@Injectable()
export class OrganizationsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async findAll() {
    return this.db.query.organizations.findMany({
      where: eq(schema.organizations.status, 'active'),
    });
  }

  async findOne(id: string) {
    const org = await this.db.query.organizations.findFirst({
      where: eq(schema.organizations.id, id),
    });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async create(data: typeof schema.organizations.$inferInsert) {
    const [newOrg] = await this.db.insert(schema.organizations).values(data).returning();
    return newOrg;
  }

  async update(id: string, data: Partial<typeof schema.organizations.$inferInsert>) {
    const [updatedOrg] = await this.db
      .update(schema.organizations)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.organizations.id, id))
      .returning();
    if (!updatedOrg) throw new NotFoundException('Organization not found');
    return updatedOrg;
  }
}
