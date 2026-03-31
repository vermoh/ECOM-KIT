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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasPermission = hasPermission;
exports.hasAllPermissions = hasAllPermissions;
__exportStar(require("./jwt.js"), exports);
__exportStar(require("./password.js"), exports);
__exportStar(require("./crypto.js"), exports);
function hasPermission(session, permission) {
    if (session.permissions.includes('*'))
        return true;
    return session.permissions.includes(permission);
}
function hasAllPermissions(session, permissions) {
    if (session.permissions.includes('*'))
        return true;
    return permissions.every(p => p === '*' || session.permissions.includes(p));
}
//# sourceMappingURL=index.js.map