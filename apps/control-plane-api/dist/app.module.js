"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const core_1 = require("@nestjs/core");
const db_module_1 = require("./db/db.module");
const auth_module_1 = require("./auth/auth.module");
const organizations_module_1 = require("./organizations/organizations.module");
const users_module_1 = require("./users/users.module");
const roles_module_1 = require("./roles/roles.module");
const service_access_module_1 = require("./service-access/service-access.module");
const audit_module_1 = require("./audit/audit.module");
const permissions_guard_1 = require("./auth/permissions.guard");
const audit_interceptor_1 = require("./audit/audit.interceptor");
const tenant_interceptor_1 = require("./auth/tenant.interceptor");
const health_controller_1 = require("./health.controller");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
            }),
            db_module_1.DbModule,
            auth_module_1.AuthModule,
            organizations_module_1.OrganizationsModule,
            users_module_1.UsersModule,
            roles_module_1.RolesModule,
            service_access_module_1.ServiceAccessModule,
            audit_module_1.AuditModule,
        ],
        controllers: [health_controller_1.HealthController],
        providers: [
            {
                provide: core_1.APP_GUARD,
                useClass: permissions_guard_1.PermissionsGuard,
            },
            {
                provide: core_1.APP_INTERCEPTOR,
                useClass: tenant_interceptor_1.TenantInterceptor,
            },
            {
                provide: core_1.APP_INTERCEPTOR,
                useClass: audit_interceptor_1.AuditInterceptor,
            },
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map