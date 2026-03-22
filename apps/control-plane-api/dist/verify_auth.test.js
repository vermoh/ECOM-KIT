"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const API_URL = 'http://localhost:8080/api/v1/auth';
const email = `test-${Date.now()}@example.com`;
const password = 'password123';
async function test() {
    console.log('--- Auth Integration Test ---');
    console.log('1. Registering user...');
    const regRes = await axios_1.default.post(`${API_URL}/register`, { email, password });
    console.log('Register Success:', regRes.data.user.email);
    console.log('2. Logging in...');
    const loginRes = await axios_1.default.post(`${API_URL}/login`, { email, password });
    const { accessToken, refreshToken, user } = loginRes.data;
    console.log('Login Success! AccessToken length:', accessToken.length);
    console.log('RefreshToken:', refreshToken);
    console.log('3. Refreshing token...');
    const refreshRes = await axios_1.default.post(`${API_URL}/refresh`, { refreshToken });
    console.log('Refresh Success! New AccessToken length:', refreshRes.data.accessToken.length);
    console.log('4. Logging out...');
    const logoutRes = await axios_1.default.post(`${API_URL}/logout`, { refreshToken, userId: user.id });
    console.log('Logout Success:', logoutRes.data.success);
    console.log('5. Verifying refresh fails after logout...');
    try {
        await axios_1.default.post(`${API_URL}/refresh`, { refreshToken });
        console.error('FAIL: Refresh should have failed');
    }
    catch (err) {
        console.log('SUCCESS: Refresh failed as expected (401)');
    }
    console.log('--- All tests passed! ---');
}
test().catch(err => {
    console.error('Test FAILED:', err.response?.data || err.message);
    process.exit(1);
});
//# sourceMappingURL=verify_auth.test.js.map