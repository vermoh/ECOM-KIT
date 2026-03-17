import axios from 'axios';

const BASE_URL = 'http://localhost:8081/api/v1';

async function verify() {
  console.log('--- Phase 3: Service Registry & Access Grants Verification ---');

  // 1. Login as admin
  console.log('1. Logging in as admin...');
  const loginRes = await axios.post(`${BASE_URL}/auth/login`, {
    email: 'admin@ecomkit.com',
    password: 'admin123'
  });
  const { accessToken } = loginRes.data;
  const initialHeaders = { Authorization: `Bearer ${accessToken}` };
  console.log('Login Success.');

  // 2. Get organization ID
  console.log('2. Fetching organizations...');
  const orgsRes = await axios.get(`${BASE_URL}/organizations`, { headers: initialHeaders });
  let orgId;
  if (orgsRes.data.length > 0) {
    orgId = orgsRes.data[0].id;
  } else {
    console.log('No orgs found, creating one...');
    const newOrgRes = await axios.post(`${BASE_URL}/organizations`, {
      name: 'Test Org',
      slug: `test-org-${Date.now()}`
    }, { headers: initialHeaders });
    orgId = newOrgRes.data.id;
  }
  console.log('Using OrgId:', orgId);

  // 3. Switch to the organization context
  console.log('3. Switching to organization context...');
  const switchRes = await axios.post(`${BASE_URL}/auth/switch-org`, { orgId }, { headers: initialHeaders });
  const activeHeaders = { Authorization: `Bearer ${switchRes.data.accessToken}` };
  console.log('Context switched.');

  // 4. Register a service
  const serviceSlug = `test-service-${Date.now()}`;
  console.log(`4. Registering service: ${serviceSlug}...`);
  const serviceRes = await axios.post(`${BASE_URL}/services`, {
    slug: serviceSlug,
    name: 'Test Service',
    baseUrl: 'http://localhost:9999',
    version: '1.0.0'
  }, { headers: activeHeaders });
  const serviceId = serviceRes.data.id;
  console.log('Service Registered:', serviceId);

  // 5. Grant access to service
  console.log('5. Granting access to service...');
  await axios.post(`${BASE_URL}/services/grant`, {
    orgId,
    serviceId
  }, { headers: activeHeaders });
  console.log('Access Granted.');

  // 6. Create ProviderConfig
  console.log('6. Creating ProviderConfig...');
  const providerRes = await axios.post(`${BASE_URL}/providers`, {
    provider: 'openrouter',
    value: 'sk-test-token-val-123456789'
  }, { headers: activeHeaders });
  console.log('ProviderConfig created:', providerRes.data.id, 'Hint:', providerRes.data.keyHint);

  // 7. Issue AccessGrant
  console.log('7. Issuing AccessGrant...');
  const grantRes = await axios.post(`${BASE_URL}/grants/issue`, {
    serviceSlug,
    scopes: ['enrichment:write']
  }, { headers: activeHeaders });
  const { token, grantId } = grantRes.data;
  console.log('AccessGrant issued:', grantId);

  // 8. Verify AccessGrant (Public verify endpoint)
  console.log('8. Verifying AccessGrant...');
  const verifyRes = await axios.post(`${BASE_URL}/grants/verify`, { token });
  console.log('Verification Result:', verifyRes.data);

  if (verifyRes.data.valid && verifyRes.data.orgId === orgId) {
    console.log('--- VERIFICATION SUCCESSFUL ---');
  } else {
    console.error('--- VERIFICATION FAILED ---');
    process.exit(1);
  }
}

verify().catch(err => {
  console.error('Verification FAILED:', err.response?.data || err.message);
  process.exit(1);
});
