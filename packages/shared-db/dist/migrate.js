"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const migrator_1 = require("drizzle-orm/postgres-js/migrator");
const postgres_1 = __importDefault(require("postgres"));
const postgres_js_1 = require("drizzle-orm/postgres-js");
const connectionString = process.env.DATABASE_URL || 'postgres://ecom_user:ecom_password@localhost:5432/ecom_platform';
async function main() {
    console.log('Running migrations...');
    const migrationClient = (0, postgres_1.default)(connectionString, { max: 1 });
    const db = (0, postgres_js_1.drizzle)(migrationClient);
    await (0, migrator_1.migrate)(db, { migrationsFolder: './drizzle' });
    console.log('Migrations complete!');
    await migrationClient.end();
}
main().catch((err) => {
    console.error('Migration failed!', err);
    process.exit(1);
});
//# sourceMappingURL=migrate.js.map