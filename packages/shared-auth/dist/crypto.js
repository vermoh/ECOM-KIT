"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.encrypt = encrypt;
exports.decrypt = decrypt;
const node_crypto_1 = __importDefault(require("node:crypto"));
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
/**
 * Encrypts a string using AES-256-GCM.
 * Returns a string in the format: iv:authTag:ciphertext (all base64)
 */
function encrypt(text, masterKey) {
    const iv = node_crypto_1.default.randomBytes(IV_LENGTH);
    const cipher = node_crypto_1.default.createCipheriv(ALGORITHM, Buffer.from(masterKey, 'hex'), iv);
    let encrypted = cipher.update(text, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const authTag = cipher.getAuthTag().toString('base64');
    return `${iv.toString('base64')}:${authTag}:${encrypted}`;
}
/**
 * Decrypts a string encrypted with the above function.
 */
function decrypt(encryptedData, masterKey) {
    const [ivBase64, authTagBase64, ciphertextBase64] = encryptedData.split(':');
    if (!ivBase64 || !authTagBase64 || !ciphertextBase64) {
        throw new Error('Invalid encrypted data format');
    }
    const iv = Buffer.from(ivBase64, 'base64');
    const authTag = Buffer.from(authTagBase64, 'base64');
    const decipher = node_crypto_1.default.createDecipheriv(ALGORITHM, Buffer.from(masterKey, 'hex'), iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(ciphertextBase64, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}
//# sourceMappingURL=crypto.js.map