import { encrypt, decrypt } from '../src/crypto.js';
import crypto from 'node:crypto';

const masterKey = crypto.randomBytes(32).toString('hex');
const testText = 'test-api-key-123';

try {
  const encrypted = encrypt(testText, masterKey);
  console.log('Encrypted:', encrypted);
  
  const decrypted = decrypt(encrypted, masterKey);
  console.log('Decrypted:', decrypted);
  
  if (testText === decrypted) {
    console.log('Encryption/Decryption successful!');
  } else {
    console.error('Decryption failed: values do not match');
    process.exit(1);
  }
} catch (err) {
  console.error('Test failed:', err);
  process.exit(1);
}
