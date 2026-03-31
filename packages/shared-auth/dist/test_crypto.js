"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_js_1 = require("../src/crypto.js");
const node_crypto_1 = __importDefault(require("node:crypto"));
const masterKey = node_crypto_1.default.randomBytes(32).toString('hex');
const testText = 'test-api-key-123';
try {
    const encrypted = (0, crypto_js_1.encrypt)(testText, masterKey);
    console.log('Encrypted:', encrypted);
    const decrypted = (0, crypto_js_1.decrypt)(encrypted, masterKey);
    console.log('Decrypted:', decrypted);
    if (testText === decrypted) {
        console.log('Encryption/Decryption successful!');
    }
    else {
        console.error('Decryption failed: values do not match');
        process.exit(1);
    }
}
catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
}
//# sourceMappingURL=test_crypto.js.map