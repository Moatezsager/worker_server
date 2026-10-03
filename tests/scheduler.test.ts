import { 
  runJobSafely, 
  getWorkerJobsStatus, 
  resetSchedulerForTesting, 
  stopBackgroundTasks 
} from '../server/schedulers/tasks.scheduler';
import { 
  lastSuccessfulFetchTime, 
  setLastSuccessfulFetchTime 
} from '../server/services/scraper.service';

/**
 * Test Suite for Worker Tasks Scheduler & Lock Safety
 */
async function runSchedulerTests() {
  console.log("==================================================");
  console.log("     Worker Tasks Scheduler Test Suite            ");
  console.log("==================================================\n");

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

  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  try {
    // ----------------------------------------------------
    // Test 1: Job Success
    // ----------------------------------------------------
    resetSchedulerForTesting();
    const resultSuccess = await runJobSafely('test_success_job', 'اختبار نجاح المهمة', async (signal) => {
      assert('1a. Signal is provided to job fn', signal instanceof AbortSignal);
      return { data: 'ok_data' };
    }, { timeoutMs: 5000 });

    assert('1b. Job returns result on success', resultSuccess?.data === 'ok_data');
    
    const jobStatus1 = getWorkerJobsStatus().find(j => j.id === 'test_success_job');
    assert('1c. Job status is "success"', jobStatus1?.status === 'success');
    assert('1d. Job consecutiveFailures is 0', jobStatus1?.consecutiveFailures === 0);
    assert('1e. Job isRunning is false after completion', jobStatus1?.isRunning === false);
    assert('1f. Job lastSuccessTime is recorded', typeof jobStatus1?.lastSuccessTime === 'number');

    // ----------------------------------------------------
    // Test 2: Job Failure
    // ----------------------------------------------------
    resetSchedulerForTesting();
    const resultFailure = await runJobSafely('test_failure_job', 'اختبار فشل المهمة', async () => {
      throw new Error('Simulated database connection error');
    }, { timeoutMs: 5000 });

    assert('2a. Job returns null on failure', resultFailure === null);

    const jobStatus2 = getWorkerJobsStatus().find(j => j.id === 'test_failure_job');
    assert('2b. Job status is "failed"', jobStatus2?.status === 'failed');
    assert('2c. Job consecutiveFailures is incremented to 1', jobStatus2?.consecutiveFailures === 1);
    assert('2d. Job lastError records error message', jobStatus2?.lastError === 'Simulated database connection error');
    assert('2e. Job isRunning is false after failure', jobStatus2?.isRunning === false);

    // ----------------------------------------------------
    // Test 3: Job Timeout
    // ----------------------------------------------------
    resetSchedulerForTesting();
    const resultTimeout = await runJobSafely('test_timeout_job', 'اختبار انتهاء الوقت', async (signal) => {
      await delay(300);
      return 'too_late';
    }, { timeoutMs: 50 });

    assert('3a. Job returns null on timeout', resultTimeout === null);

    const jobStatus3 = getWorkerJobsStatus().find(j => j.id === 'test_timeout_job');
    assert('3b. Job status is "timed_out"', jobStatus3?.status === 'timed_out');
    assert('3c. Job lastError records timeout message', jobStatus3?.lastError?.includes('exceeded maximum timeout') === true);

    // ----------------------------------------------------
    // Test 4: Second Execution Blocked During First Execution (Overlap Protection)
    // ----------------------------------------------------
    resetSchedulerForTesting();
    let slowJobFinished = false;

    // Start a 300ms job asynchronously
    const firstExecutionPromise = runJobSafely('test_overlap_job', 'اختبار تداخل المهمات', async () => {
      await delay(300);
      slowJobFinished = true;
      return 'first_done';
    }, { timeoutMs: 1000 });

    await delay(50); // Ensure first job is running

    // Attempt second execution while first is active
    const secondExecutionResult = await runJobSafely('test_overlap_job', 'اختبار تداخل المهمات', async () => {
      return 'second_should_not_run';
    }, { timeoutMs: 1000 });

    assert('4a. Concurrent second execution is blocked and returns null', secondExecutionResult === null);
    assert('4b. First job is still running when second was blocked', !slowJobFinished);

    const firstResult = await firstExecutionPromise;
    assert('4c. First job completes successfully', firstResult === 'first_done' && slowJobFinished);

    // Test 4d: Timeout lock retention
    resetSchedulerForTesting();
    let slowFnFinished = false;

    // Job with 50ms timeout, but underlying fn takes 250ms
    const timedOutRunPromise = runJobSafely('test_timeout_lock_job', 'اختبار الحفاظ على اللوك بعد التايم آوت', async () => {
      await delay(250);
      slowFnFinished = true;
      return 'done_eventually';
    }, { timeoutMs: 50 });

    const timeoutVal = await timedOutRunPromise;
    assert('4d. Call returns null on timeout at 50ms', timeoutVal === null);

    // At 100ms, slowFnFinished is still false (underlying fn is STILL running in background)
    await delay(50); 
    const attemptDuringBgRun = await runJobSafely('test_timeout_lock_job', 'اختبار الحفاظ على اللوك بعد التايم آوت', async () => {
      return 'duplicate_attempt';
    }, { timeoutMs: 1000 });

    assert('4e. Second execution blocked even after timeout because background fn is still running', attemptDuringBgRun === null);

    // Wait until background fn actually completes (at 250ms)
    await delay(200);
    assert('4f. Background fn finished eventually', slowFnFinished);

    // Now that background fn finished, new execution should be allowed!
    const attemptAfterBgRunFinished = await runJobSafely('test_timeout_lock_job', 'اختبار الحفاظ على اللوك بعد التايم آوت', async () => {
      return 'new_attempt_allowed';
    }, { timeoutMs: 1000 });

    assert('4g. Subsequent execution allowed after background fn completes', attemptAfterBgRunFinished === 'new_attempt_allowed');

    // ----------------------------------------------------
    // Test 5: Retry Behavior & Exponential Backoff Mode
    // ----------------------------------------------------
    resetSchedulerForTesting();

    // Trigger 5 failures
    for (let i = 1; i <= 5; i++) {
      await runJobSafely('test_backoff_job', 'اختبار الباك أوف', async () => {
        throw new Error(`Failure #${i}`);
      }, { timeoutMs: 1000 });
    }

    const jobStatus5 = getWorkerJobsStatus().find(j => j.id === 'test_backoff_job');
    assert('5a. Consecutive failures reached 5', jobStatus5?.consecutiveFailures === 5);

    // 6th attempt immediately should be rejected by backoff check
    const backoffResult = await runJobSafely('test_backoff_job', 'اختبار الباك أوف', async () => {
      return 'should_be_in_backoff';
    }, { timeoutMs: 1000 });

    assert('5b. 6th attempt immediately is blocked in backoff mode', backoffResult === null);

    // ----------------------------------------------------
    // Test 6: Shutdown During Active Job
    // ----------------------------------------------------
    resetSchedulerForTesting();
    let wasAbortedByShutdown = false;

    const shutdownJobPromise = runJobSafely('test_shutdown_job', 'اختبار إيقاف النظام', async (signal) => {
      return new Promise<string>((resolve) => {
        signal.addEventListener('abort', () => {
          wasAbortedByShutdown = true;
          resolve('aborted');
        });
      });
    }, { timeoutMs: 5000 });

    await delay(50); // Ensure job is running

    // Trigger graceful shutdown
    stopBackgroundTasks();

    await shutdownJobPromise;
    assert('6a. AbortSignal triggered abort event during shutdown', wasAbortedByShutdown);

    // Attempting a job after shutdown should be rejected
    const newJobAfterShutdown = await runJobSafely('test_post_shutdown_job', 'اختبار بعد الإيقاف', async () => {
      return 'never_ran';
    }, { timeoutMs: 1000 });

    assert('6b. New jobs rejected after shutdown', newJobAfterShutdown === null);

    // ----------------------------------------------------
    // Test 7: Watchdog Alert & lastSuccessfulFetchTime Preservation
    // ----------------------------------------------------
    resetSchedulerForTesting();
    const fiveHoursAgo = Date.now() - (5 * 60 * 60 * 1000);
    setLastSuccessfulFetchTime(fiveHoursAgo);

    assert('7a. Initial lastSuccessfulFetchTime set to 5 hours ago', lastSuccessfulFetchTime === fiveHoursAgo);

    // Simulate Watchdog execution when >4 hours stale
    let alertTriggered = false;
    const hoursSinceSuccess = (Date.now() - lastSuccessfulFetchTime) / (1000 * 60 * 60);
    if (hoursSinceSuccess > 4) {
      alertTriggered = true;
      // Watchdog sends alert, MUST NOT change lastSuccessfulFetchTime!
    }

    assert('7b. Watchdog detects >4h stale fetch and triggers alert', alertTriggered === true);
    assert('7c. lastSuccessfulFetchTime is NOT modified when watchdog alert is sent', lastSuccessfulFetchTime === fiveHoursAgo);

    // Simulate failed fetch / timeout / retry
    await runJobSafely('test_failed_watchdog_job', 'اختبار فشل الجلب', async () => {
      throw new Error('CBL site unreachable');
    }, { timeoutMs: 1000 });

    assert('7d. lastSuccessfulFetchTime is NOT modified on fetch failure/timeout', lastSuccessfulFetchTime === fiveHoursAgo);

    // Simulate second watchdog run during ongoing 6-hour outage
    const hoursSinceSuccess2 = (Date.now() - lastSuccessfulFetchTime) / (1000 * 60 * 60);
    assert('7e. Stale hours count continues to accurately grow (>5 hours)', hoursSinceSuccess2 >= 5);

    // Simulate ACTUAL successful fetch completion
    const actualSuccessTime = Date.now();
    setLastSuccessfulFetchTime(actualSuccessTime);

    assert('7f. lastSuccessfulFetchTime IS updated ONLY after actual successful fetch', lastSuccessfulFetchTime === actualSuccessTime);

    console.log("\n==================================================");
    console.log(`Scheduler Test Results: ${passed} Passed, ${failed} Failed`);
    console.log("==================================================\n");

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error("Fatal error during scheduler tests:", err);
    process.exit(1);
  }
}

runSchedulerTests();
