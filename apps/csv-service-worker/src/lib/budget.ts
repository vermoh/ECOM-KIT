const CP_URL = process.env.CONTROL_PLANE_URL || 'http://localhost:4000';

// In production, this would be a real AccessGrant token
const SERVICE_TOKEN = process.env.CSV_SERVICE_TOKEN || 'csv-service-shared-secret';

export async function checkBudget(orgId: string, requiredTokens: number): Promise<boolean> {
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
      // Fail open: billing service errors should not block AI operations.
      // The real token limit is enforced at the provider (OpenRouter) level.
      console.warn(`[Budget] Check HTTP ${res.status} for org ${orgId} — proceeding anyway`);
      return true;
    }
    const data = await res.json() as { canProceed: boolean };
    if (!data.canProceed) {
      console.warn(`[Budget] Org ${orgId} is out of internal token budget`);
    }
    return data.canProceed;
  } catch (err) {
    // Network/parse error — fail open so connectivity issues don't block jobs
    console.warn(`[Budget] Check unreachable for org ${orgId} — proceeding anyway:`, err);
    return true;
  }
}

export async function consumeBudget(data: {
  orgId: string;
  serviceId?: string;
  jobId?: string;
  tokensUsed: number;
  model: string;
  purpose: string;
}) {
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
  } catch (err) {
    console.error(`[Budget] Consumption error:`, err);
  }
}
