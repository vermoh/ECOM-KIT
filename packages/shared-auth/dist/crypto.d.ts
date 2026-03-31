/**
 * Encrypts a string using AES-256-GCM.
 * Returns a string in the format: iv:authTag:ciphertext (all base64)
 */
export declare function encrypt(text: string, masterKey: string): string;
/**
 * Decrypts a string encrypted with the above function.
 */
export declare function decrypt(encryptedData: string, masterKey: string): string;
//# sourceMappingURL=crypto.d.ts.map