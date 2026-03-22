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
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const users_service_1 = require("../users/users.service");
const roles_service_1 = require("../roles/roles.service");
const bcrypt = __importStar(require("bcrypt"));
const db_module_1 = require("../db/db.module");
const schema = __importStar(require("@ecom-kit/shared-db"));
const drizzle_orm_1 = require("drizzle-orm");
const crypto = __importStar(require("node:crypto"));
let AuthService = class AuthService {
    constructor(usersService, rolesService, jwtService, db) {
        this.usersService = usersService;
        this.rolesService = rolesService;
        this.jwtService = jwtService;
        this.db = db;
    }
    async validateUser(email, pass) {
        const user = await this.usersService.findByEmail(email);
        if (user && await bcrypt.compare(pass, user.passwordHash)) {
            const { passwordHash, ...result } = user;
            return result;
        }
        return null;
    }
    async login(user, orgId) {
        const membership = await this.db.query.memberships.findFirst({
            where: (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema.memberships.userId, user.id), (0, drizzle_orm_1.eq)(schema.memberships.orgId, orgId), (0, drizzle_orm_1.eq)(schema.memberships.status, 'active'))
        });
        if (!membership) {
            throw new common_1.UnauthorizedException('User is not a member of this organization');
        }
        const roleWithPerms = await this.rolesService.findRoleWithPermissions(membership.roleId);
        const payload = {
            sub: user.id,
            org_id: orgId,
            role: roleWithPerms.name,
            permissions: roleWithPerms.permissions,
            valid_until: membership.validUntil?.toISOString(),
            iss: 'ecomkit-cp',
        };
        return {
            access_token: this.jwtService.sign(payload),
        };
    }
    async verifyServiceToken(token) {
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const grant = await this.db.query.accessGrants.findFirst({
            where: (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema.accessGrants.tokenHash, tokenHash), (0, drizzle_orm_1.isNull)(schema.accessGrants.revokedAt))
        });
        if (grant && grant.expiresAt > new Date()) {
            return {
                userId: `service:${grant.serviceId}`,
                orgId: grant.orgId,
                roles: [],
                permissions: grant.scopes,
                exp: Math.floor(grant.expiresAt.getTime() / 1000)
            };
        }
        return null;
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __param(3, (0, common_1.Inject)(db_module_1.DRIZZLE)),
    __metadata("design:paramtypes", [users_service_1.UsersService,
        roles_service_1.RolesService,
        jwt_1.JwtService, Object])
], AuthService);
//# sourceMappingURL=auth.service.js.map