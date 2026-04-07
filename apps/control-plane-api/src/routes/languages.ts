import { FastifyInstance } from 'fastify';
import { db, languages, eq, asc } from '@ecom-kit/shared-db';

export async function languageRoutes(fastify: FastifyInstance) {
  // GET / — list all languages ordered by code (all authenticated users)
  fastify.get('/', async (request, reply) => {
    const rows = await db.select().from(languages).orderBy(asc(languages.code));
    return rows;
  });

  // GET /export — export all languages as JSON
  fastify.get('/export', async (request, reply) => {
    const rows = await db.select().from(languages).orderBy(asc(languages.code));
    return { languages: rows };
  });

  // POST / — create a language (super_admin only)
  fastify.post('/', async (request, reply) => {
    const session = request.userSession;
    if (!session || !session.roles.includes('super_admin')) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'super_admin role required' });
    }

    const { code, name, nativeName } = request.body as { code: string; name: string; nativeName: string };

    if (!code || !name || !nativeName) {
      return reply.status(400).send({ error: 'code, name, and nativeName are required' });
    }

    const [row] = await db.insert(languages).values({ code, name, nativeName }).returning();
    return reply.status(201).send(row);
  });

  // PATCH /:id — update a language (super_admin only)
  fastify.patch('/:id', async (request, reply) => {
    const session = request.userSession;
    if (!session || !session.roles.includes('super_admin')) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'super_admin role required' });
    }

    const { id } = request.params as { id: string };
    const body = request.body as { name?: string; nativeName?: string; isActive?: boolean };

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.nativeName !== undefined) updates.nativeName = body.nativeName;
    if (body.isActive !== undefined) updates.isActive = body.isActive;

    if (Object.keys(updates).length === 0) {
      return reply.status(400).send({ error: 'No fields to update' });
    }

    const [updated] = await db.update(languages).set(updates).where(eq(languages.id, id)).returning();

    if (!updated) {
      return reply.status(404).send({ error: 'Language not found' });
    }

    return updated;
  });

  // DELETE /:id — delete a language (super_admin only)
  fastify.delete('/:id', async (request, reply) => {
    const session = request.userSession;
    if (!session || !session.roles.includes('super_admin')) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'super_admin role required' });
    }

    const { id } = request.params as { id: string };
    const [deleted] = await db.delete(languages).where(eq(languages.id, id)).returning({ id: languages.id });

    if (!deleted) {
      return reply.status(404).send({ error: 'Language not found' });
    }

    return reply.status(204).send();
  });

  // POST /import — upsert languages from JSON (super_admin only)
  fastify.post('/import', async (request, reply) => {
    const session = request.userSession;
    if (!session || !session.roles.includes('super_admin')) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'super_admin role required' });
    }

    const { languages: incoming } = request.body as {
      languages: Array<{ code: string; name: string; nativeName: string; isActive?: boolean }>;
    };

    if (!Array.isArray(incoming) || incoming.length === 0) {
      return reply.status(400).send({ error: 'languages array is required and must not be empty' });
    }

    const results = await db
      .insert(languages)
      .values(incoming.map((l) => ({ code: l.code, name: l.name, nativeName: l.nativeName, isActive: l.isActive ?? true })))
      .onConflictDoUpdate({
        target: languages.code,
        set: {
          name: languages.name,
          nativeName: languages.nativeName,
          isActive: languages.isActive,
        },
      })
      .returning();

    return { imported: results.length, languages: results };
  });
}
