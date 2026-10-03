import { createWorkerApp } from "../server/worker";
import http from "http";

/**
 * Test Suite for Worker Internal API (Server-to-Server)
 */
async function runInternalApiTests() {
  console.log("==================================================");
  console.log("     Worker Internal API Test Suite (S2S)         ");
  console.log("==================================================\n");

  const TEST_SECRET = "super-secret-worker-key-1234567890";
  process.env.WORKER_INTERNAL_SECRET = TEST_SECRET;

  const app = createWorkerApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  let passed = 0;
  let failed = 0;

  function assert(name: string, condition: boolean, details?: string) {
    if (condition) {
      console.log(`[PASS] ${name}`);
      passed++;
    } else {
      console.error(`[FAIL] ${name} ${details ? '- ' + details : ''}`);
      failed++;
    }
  }

  try {
    // 1. Missing secret header returns 401
    const resNoAuth = await fetch(`${baseUrl}/internal/health`);
    const dataNoAuth: any = await resNoAuth.json();
    assert("1. Missing internal secret header returns 401 Unauthorized", resNoAuth.status === 401 && dataNoAuth.status === "failed");

    // 2. Invalid secret header returns 403
    const resBadAuth = await fetch(`${baseUrl}/internal/health`, {
      headers: { "x-worker-secret": "wrong-secret-value-123" }
    });
    const dataBadAuth: any = await resBadAuth.json();
    assert("2. Invalid secret header returns 403 Forbidden", resBadAuth.status === 403 && dataBadAuth.status === "failed");

    // 3. Valid secret via x-worker-secret header returns 200
    const resOkAuth = await fetch(`${baseUrl}/internal/health`, {
      headers: { "x-worker-secret": TEST_SECRET }
    });
    const dataOkAuth: any = await resOkAuth.json();
    assert("3. Valid secret via x-worker-secret returns 200 OK", resOkAuth.status === 200 && dataOkAuth.status === "online");

    // 4. Valid secret via Authorization Bearer returns 200
    const resBearerAuth = await fetch(`${baseUrl}/internal/health`, {
      headers: { "Authorization": `Bearer ${TEST_SECRET}` }
    });
    const dataBearerAuth: any = await resBearerAuth.json();
    assert("4. Valid secret via Authorization Bearer returns 200 OK", resBearerAuth.status === 200 && dataBearerAuth.status === "online");

    // 5. Unknown job returns 400 Bad Request
    const resUnknownJob = await fetch(`${baseUrl}/internal/jobs/hack_system`, {
      method: "POST",
      headers: { "x-worker-secret": TEST_SECRET }
    });
    const dataUnknown: any = await resUnknownJob.json();
    assert("5. Unknown job name rejected with 400 Bad Request", resUnknownJob.status === 400 && dataUnknown.status === "failed");

    // 6. Trigger allowlisted job: CBL (returns 202 Accepted)
    const resCbl = await fetch(`${baseUrl}/internal/jobs/cbl`, {
      method: "POST",
      headers: { "x-worker-secret": TEST_SECRET }
    });
    const dataCbl: any = await resCbl.json();
    assert("6. Allowlisted job 'cbl' accepted with 202 Accepted", (resCbl.status === 202 || resCbl.status === 409) && (dataCbl.status === "accepted" || dataCbl.status === "already_running"));

    // 7. Trigger allowlisted job: Telegram (returns 202 Accepted or 409 already_running)
    const resTg = await fetch(`${baseUrl}/internal/jobs/telegram`, {
      method: "POST",
      headers: { "x-worker-secret": TEST_SECRET }
    });
    const dataTg: any = await resTg.json();
    assert("7. Allowlisted job 'telegram' accepted with 202 or 409", (resTg.status === 202 || resTg.status === 409) && (dataTg.status === "accepted" || dataTg.status === "already_running"));

    // 8. Trigger allowlisted job: Refresh (returns 202 Accepted or 409 already_running)
    const resRefresh = await fetch(`${baseUrl}/internal/jobs/refresh`, {
      method: "POST",
      headers: { "x-worker-secret": TEST_SECRET }
    });
    const dataRefresh: any = await resRefresh.json();
    assert("8. Allowlisted job 'refresh' accepted with 202 or 409", (resRefresh.status === 202 || resRefresh.status === 409));

    // 9. Trigger allowlisted job: Maintenance (returns 202 Accepted or 409 already_running)
    const resMaint = await fetch(`${baseUrl}/internal/jobs/maintenance`, {
      method: "POST",
      headers: { "x-worker-secret": TEST_SECRET }
    });
    const dataMaint: any = await resMaint.json();
    assert("9. Allowlisted job 'maintenance' accepted with 202 or 409", (resMaint.status === 202 || resMaint.status === 409));

    // 10. Query all jobs status (GET /internal/jobs)
    const resJobsList = await fetch(`${baseUrl}/internal/jobs`, {
      headers: { "x-worker-secret": TEST_SECRET }
    });
    const dataJobsList: any = await resJobsList.json();
    assert("10. GET /internal/jobs returns jobs registry", resJobsList.status === 200 && dataJobsList.status === "success" && Array.isArray(dataJobsList.jobs));

    // 11. Render root health probe (GET /health) returns 200 OK with runtime diagnostics
    const resRenderHealth = await fetch(`${baseUrl}/health`);
    const dataRenderHealth: any = await resRenderHealth.json();
    assert("11. Render health probe GET /health returns 200 OK with online status", resRenderHealth.status === 200 && dataRenderHealth.status === "online" && typeof dataRenderHealth.uptimeSeconds === "number");

  } finally {
    server.close();
  }

  console.log("\n==================================================");
  console.log(`Internal API Test Results: ${passed} Passed, ${failed} Failed`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runInternalApiTests();
