import Fastify from 'fastify';

// Worker also runs a small Fastify server for health checks and observability
const fastify = Fastify({
  logger: true
});

fastify.get('/health', async (request, reply) => {
  // Check MQ connection in a real scenario
  return { status: 'ok', service: 'csv-service-worker' };
});

const start = async () => {
  try {
    // Port 3002 to avoid conflicts with APIs
    await fastify.listen({ port: 3002, host: '0.0.0.0' });
    fastify.log.info('CSV Service Worker started processing jobs.');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
