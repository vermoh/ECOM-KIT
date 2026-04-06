import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { DRIZZLE } from '../db/db.module';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@ecom-kit/shared-db';
import { eq } from '@ecom-kit/shared-db';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UsersService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async findOne(id: string) {
    const user = await this.db.query.users.findFirst({
      where: eq(schema.users.id, id),
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findByEmail(email: string) {
    return this.db.query.users.findFirst({
      where: eq(schema.users.email, email),
    });
  }

  async create(data: typeof schema.users.$inferInsert) {
    const hashedPassword = await bcrypt.hash(data.passwordHash, 10);
    const [newUser] = await this.db.insert(schema.users).values({
      ...data,
      passwordHash: hashedPassword,
    }).returning();
    return newUser;
  }

  async update(id: string, data: Partial<typeof schema.users.$inferInsert>) {
    if (data.passwordHash) {
      data.passwordHash = await bcrypt.hash(data.passwordHash, 10);
    }
    const [updatedUser] = await this.db
      .update(schema.users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.users.id, id))
      .returning();
    if (!updatedUser) throw new NotFoundException('User not found');
    return updatedUser;
  }
}
