"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServiceAccessController = void 0;
const common_1 = require("@nestjs/common");
const service_access_service_1 = require("./service-access.service");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
const permissions_guard_1 = require("../auth/permissions.guard");
const permissions_decorator_1 = require("../auth/permissions.decorator");
let ServiceAccessController = class ServiceAccessController {
    constructor(serviceAccessService) {
        this.serviceAccessService = serviceAccessService;
    }
    findAll() {
        return this.serviceAccessService.findAllServices();
    }
    grantAccess(serviceId, orgId, req) {
        return this.serviceAccessService.grantAccess(orgId, serviceId, req.user.userId);
    }
    createToken(serviceId, scopes, req) {
        return this.serviceAccessService.createAccessGrant(req.user.orgId, serviceId, scopes);
    }
};
exports.ServiceAccessController = ServiceAccessController;
__decorate([
    (0, common_1.Get)(),
    (0, permissions_decorator_1.Permissions)('service:read'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ServiceAccessController.prototype, "findAll", null);
__decorate([
    (0, common_1.Post)(':serviceId/grant'),
    (0, permissions_decorator_1.Permissions)('service:grant_access'),
    __param(0, (0, common_1.Param)('serviceId')),
    __param(1, (0, common_1.Body)('orgId')),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", void 0)
], ServiceAccessController.prototype, "grantAccess", null);
__decorate([
    (0, common_1.Post)(':serviceId/token'),
    (0, permissions_decorator_1.Permissions)('service:read'),
    __param(0, (0, common_1.Param)('serviceId')),
    __param(1, (0, common_1.Body)('scopes')),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Array, Object]),
    __metadata("design:returntype", void 0)
], ServiceAccessController.prototype, "createToken", null);
exports.ServiceAccessController = ServiceAccessController = __decorate([
    (0, common_1.Controller)('services'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, permissions_guard_1.PermissionsGuard),
    __metadata("design:paramtypes", [service_access_service_1.ServiceAccessService])
], ServiceAccessController);
//# sourceMappingURL=service-access.controller.js.map