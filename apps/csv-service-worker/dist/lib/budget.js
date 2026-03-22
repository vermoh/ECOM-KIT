"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkBudget = checkBudget;
exports.consumeBudget = consumeBudget;
const CP_URL = process.env.CONTROL_PLANE_URL || 'http://localhost:8080';
// In production, this would be a real AccessGrant token
const SERVICE_TOKEN = process.env.CSV_SERVICE_TOKEN || 'csv-service-shared-secret';
async function checkBudget(orgId, requiredTokens) {
    try {
        const res = await fetch(`${CP_URL}/api/v1/billing/budget/check`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SERVICE_TOKEN}`
            },
            body: JSON.stringify({ orgId, requiredTokens })
        });
        if (!res.ok) {
            console.error(`[Budget] Check failed for org ${orgId}: ${res.statusText}`);
            return false;
        }
        const data = await res.json();
        return data.canProceed;
    }
    catch (err) {
        console.error(`[Budget] Check error:`, err);
        return false;
    }
}
async function consumeBudget(data) {
    try {
        const res = await fetch(`${CP_URL}/api/v1/billing/budget/consume`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SERVICE_TOKEN}`
            },
            body: JSON.stringify(data)
        });
        if (!res.ok) {
            console.error(`[Budget] Consumption failed for org ${data.orgId}: ${res.statusText}`);
        }
    }
    catch (err) {
        console.error(`[Budget] Consumption error:`, err);
    }
}
//# sourceMappingURL=budget.js.map