async function runTenantIsolationCheck() {
  console.log("===============================================================================");
  console.log("   D-ARROW TENANT ISOLATION AUDIT — API LEVEL SECURITY VERIFICATION             ");
  console.log("   Target: http://localhost:3005/api/v1                                       ");
  console.log("===============================================================================\n");

  // 1. Authenticate Company A
  const loginARes = await fetch('http://localhost:3005/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'alpha-admin@darrow.local', password: 'Password123!' }),
  });
  const loginA = await loginARes.json();
  const tokenA = loginA.data?.accessToken;
  if (!tokenA) throw new Error("Company A login failed");

  // 2. Authenticate Company B
  const loginBRes = await fetch('http://localhost:3005/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'beta-admin@darrow.local', password: 'Password123!' }),
  });
  const loginB = await loginBRes.json();
  const tokenB = loginB.data?.accessToken;
  if (!tokenB) throw new Error("Company B login failed");

  console.log("[AUTH OK] Company A Token acquired.");
  console.log("[AUTH OK] Company B Token acquired.");

  // 3. Create a private Customer in Company A
  const createCustRes = await fetch('http://localhost:3005/api/v1/crm/customers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({
      accountName: 'Alpha Secret Client',
      type: 'COMPANY',
      status: 'active',
    }),
  });
  const custA = await createCustRes.json();
  const custAId = custA.data?.id;
  console.log(`[COMPANY A] Created private Customer: ${custA.data?.accountName} (ID: ${custAId})`);

  // 4. Create a private Contract in Company A
  const createContractRes = await fetch('http://localhost:3005/api/v1/crm/contracts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({
      title: 'Alpha Classified NDA & SLA',
      status: 'draft',
      form: { preamble: 'Confidential to Company A' },
      contactId: custAId,
    }),
  });
  const contractA = await createContractRes.json();
  const contractAId = contractA.data?.id;
  console.log(`[COMPANY A] Created private Contract: ${contractA.data?.title} (ID: ${contractAId})`);

  // 5. Create a private Task in Company A
  const createTaskRes = await fetch('http://localhost:3005/api/v1/crm/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({
      title: 'Company A Secret Task',
      entityType: 'contact',
      entityId: custAId,
      status: 'pending',
    }),
  });
  const taskA = await createTaskRes.json();
  const taskAId = taskA.data?.id;
  console.log(`[COMPANY A] Created private Task: ${taskA.data?.title} (ID: ${taskAId})`);

  console.log("\n--- EXECUTING ADVERSARIAL CROSS-TENANT ATTACKS FROM COMPANY B ---");

  // Attack 1: Company B attempts to read Company A's customer
  const crossReadCust = await fetch(`http://localhost:3005/api/v1/crm/customers/${custAId}`, {
    headers: { Authorization: `Bearer ${tokenB}` },
  });
  console.log(`[ATTACK 1] Cross-tenant Customer Read: Status ${crossReadCust.status} (Expected 404)`);
  if (crossReadCust.status !== 404) throw new Error("LEAK DETECTED: Company B read Company A customer!");

  // Attack 2: Company B attempts to update Company A's customer
  const crossUpdateCust = await fetch(`http://localhost:3005/api/v1/crm/customers/${custAId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` },
    body: JSON.stringify({ accountName: 'HACKED BY B' }),
  });
  console.log(`[ATTACK 2] Cross-tenant Customer Update: Status ${crossUpdateCust.status} (Expected 404)`);
  if (crossUpdateCust.status !== 404) throw new Error("LEAK DETECTED: Company B updated Company A customer!");

  // Attack 3: Company B attempts to read Company A's contract
  const crossReadContract = await fetch(`http://localhost:3005/api/v1/crm/contracts/${contractAId}`, {
    headers: { Authorization: `Bearer ${tokenB}` },
  });
  console.log(`[ATTACK 3] Cross-tenant Contract Read: Status ${crossReadContract.status} (Expected 404)`);
  if (crossReadContract.status !== 404) throw new Error("LEAK DETECTED: Company B read Company A contract!");

  // Attack 4: Company B attempts to read Company A's task
  const crossReadTask = await fetch(`http://localhost:3005/api/v1/crm/tasks/${taskAId}`, {
    headers: { Authorization: `Bearer ${tokenB}` },
  });
  console.log(`[ATTACK 4] Cross-tenant Task Read: Status ${crossReadTask.status} (Expected 404)`);
  if (crossReadTask.status !== 404) throw new Error("LEAK DETECTED: Company B read Company A task!");

  // Attack 5: Company B attempts to create a contract linked to Company A's customer (Cross-tenant Foreign Key Injection)
  const crossInjectRes = await fetch('http://localhost:3005/api/v1/crm/contracts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` },
    body: JSON.stringify({
      title: 'Sneaky Cross Contract',
      form: { preamble: 'Trying to steal Company A contact' },
      contactId: custAId, // Belongs to Company A
    }),
  });
  console.log(`[ATTACK 5] Cross-tenant Foreign Key Injection: Status ${crossInjectRes.status} (Expected 400)`);
  if (crossInjectRes.status !== 400) throw new Error("LEAK DETECTED: Foreign key validation failed!");

  // Attack 6: Company B listing should contain ZERO Company A records
  const listCustB = await (await fetch('http://localhost:3005/api/v1/crm/customers', { headers: { Authorization: `Bearer ${tokenB}` } })).json();
  const listContractsB = await (await fetch('http://localhost:3005/api/v1/crm/contracts', { headers: { Authorization: `Bearer ${tokenB}` } })).json();
  const listTasksB = await (await fetch('http://localhost:3005/api/v1/crm/tasks', { headers: { Authorization: `Bearer ${tokenB}` } })).json();

  const leakedCust = (listCustB.data || []).filter((c: any) => c.id === custAId);
  const leakedContract = (listContractsB.data || []).filter((c: any) => c.id === contractAId);
  const leakedTask = (listTasksB.data || []).filter((t: any) => t.id === taskAId);

  console.log(`[AUDIT LIST] Leaked Customers in Company B list: ${leakedCust.length}`);
  console.log(`[AUDIT LIST] Leaked Contracts in Company B list: ${leakedContract.length}`);
  console.log(`[AUDIT LIST] Leaked Tasks in Company B list: ${leakedTask.length}`);

  if (leakedCust.length > 0 || leakedContract.length > 0 || leakedTask.length > 0) {
    throw new Error("LEAK DETECTED in list endpoints!");
  }

  console.log("\n===============================================================================");
  console.log("   TENANT ISOLATION VERIFICATION: 100% PASS — ZERO CROSS-TENANT DATA LEAKAGE   ");
  console.log("===============================================================================");
}

runTenantIsolationCheck().catch((err) => {
  console.error("Tenant Isolation Error:", err);
  process.exit(1);
});
