"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServiceAccessService = void 0;
const common_1 = require("@nestjs/common");
const db_module_1 = require("../db/db.module");
const schema = __importStar(require("@ecom-kit/shared-db"));
const drizzle_orm_1 = require("drizzle-orm");
const crypto = __importStar(require("node:crypto"));
let ServiceAccessService = class ServiceAccessService {
    constructor(db) {
        this.db = db;
    }
    async findAllServices() {
        return this.db.query.services.findMany();
    }
    async grantAccess(orgId, serviceId, grantedBy) {
        const [access] = await this.db.insert(schema.serviceAccess).values({
            orgId,
            serviceId,
            grantedBy,
            enabled: true,
        }).returning();
        return access;
    }
    async createAccessGrant(orgId, serviceId, scopes) {
        const access = await this.db.query.serviceAccess.findFirst({
            where: (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema.serviceAccess.orgId, orgId), (0, drizzle_orm_1.eq)(schema.serviceAccess.serviceId, serviceId), (0, drizzle_orm_1.eq)(schema.serviceAccess.enabled, true)),
        });
        if (!access) {
            throw new common_1.UnauthorizedException('Organization does not have access to this service');
        }
        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
        const [grant] = await this.db.insert(schema.accessGrants).values({
            orgId,
            serviceId,
            tokenHash,
            scopes,
            expiresAt,
        }).returning();
        return {
            ...grant,
            token: rawToken,
        };
    }
};
exports.ServiceAccessService = ServiceAccessService;
exports.ServiceAccessService = ServiceAccessService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(db_module_1.DRIZZLE)),
    __metadata("design:paramtypes", [Object])
], ServiceAccessService);
//# sourceMappingURL=service-access.service.js.map