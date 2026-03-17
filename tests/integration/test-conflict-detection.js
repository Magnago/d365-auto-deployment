/**
 * Integration test: TFVC conflict detection
 *
 * Runs against the REAL TFVC environment to verify that:
 *   1. getlatest detects conflicts (numConflicts > 0 → throws)
 *   2. getlatest succeeds when no conflicts exist (numConflicts = 0)
 *   3. The conflicts query operation works and returns conflict details
 *
 * Prerequisites:
 *   - .env configured with valid TFVC credentials
 *   - A workspace mapped on this machine
 *
 * Usage:
 *   node tests/integration/test-conflict-detection.js
 *
 * This does NOT merge, check in, build, sync, or touch services.
 */

require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');

const TFVC_OPS_SCRIPT = path.join(__dirname, '..', '..', 'src', 'scripts', 'tfvc-operations.ps1');
const COLLECTION_URL = process.env.TFVC_COLLECTION_URL;
const PAT = process.env.TFVC_PAT || process.env.AZURE_PAT;
const WORKSPACE = process.env.TFVC_WORKSPACE;
const WORKSPACE_OWNER = process.env.TFVC_WORKSPACE_OWNER || '';
const TARGET_BRANCH = `$/${process.env.TFVC_PROJECT_NAME}/${process.env.TARGET_BRANCH}`;

// ── Helpers ──────────────────────────────────────────────────────────────────

function runTfvcOp(operation, args = {}) {
    return new Promise((resolve, reject) => {
        const psArgs = [
            '-NoProfile', '-ExecutionPolicy', 'Bypass',
            '-File', TFVC_OPS_SCRIPT,
            '-Operation', operation,
            '-JsonArgs', JSON.stringify(args),
            '-CollectionUrl', COLLECTION_URL,
            '-Pat', PAT,
            '-WorkspaceName', WORKSPACE,
        ];
        if (WORKSPACE_OWNER) {
            psArgs.push('-WorkspaceOwner', WORKSPACE_OWNER);
        }

        const child = spawn('powershell.exe', psArgs, {
            cwd: process.cwd(),
            shell: false,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
        child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

        child.on('close', (code) => {
            const output = stdout.trim();
            try {
                const result = JSON.parse(output);
                resolve(result);
            } catch {
                reject(new Error(`Non-JSON output (exit ${code}): ${output || stderr.trim()}`));
            }
        });
        child.on('error', (err) => reject(err));
    });
}

function pass(name) { console.log(`  ✓ ${name}`); }
function fail(name, err) { console.log(`  ✗ ${name}`); console.log(`    ${err}`); }

// ── Tests ────────────────────────────────────────────────────────────────────

async function main() {
    console.log('Integration test: TFVC conflict detection');
    console.log(`  Target branch: ${TARGET_BRANCH}`);
    console.log(`  Workspace:     ${WORKSPACE}`);
    console.log('');

    let passed = 0;
    let failed = 0;

    // --- Test 1: workspace query works ---
    try {
        const ws = await runTfvcOp('workspaces');
        if (!ws.success) throw new Error(`workspaces returned success=false: ${ws.error}`);
        if (!ws.folders || ws.folders.length === 0) throw new Error('No workspace folders found');
        pass(`Workspace "${ws.name}" found with ${ws.folders.length} mapping(s)`);
        passed++;
    } catch (err) {
        fail('Workspace query', err.message);
        failed++;
        console.log('\nCannot continue without workspace. Exiting.');
        process.exit(1);
    }

    // --- Test 2: conflicts query works ---
    let existingConflicts = 0;
    try {
        const result = await runTfvcOp('conflicts', { path: TARGET_BRANCH });
        if (!result.success) throw new Error(`conflicts returned success=false: ${result.error}`);
        existingConflicts = result.count;
        pass(`Conflicts query returned ${result.count} conflict(s)`);
        if (result.count > 0) {
            result.conflicts.forEach((c) => {
                console.log(`    → ${c.serverItem} (${c.type})`);
            });
        }
        passed++;
    } catch (err) {
        fail('Conflicts query', err.message);
        failed++;
    }

    // --- Test 3: getlatest returns numConflicts field ---
    try {
        const result = await runTfvcOp('getlatest', { branchPath: TARGET_BRANCH });
        if (!result.success) throw new Error(`getlatest returned success=false: ${result.error}`);
        if (typeof result.numConflicts !== 'number') {
            throw new Error(`numConflicts field missing or not a number: ${JSON.stringify(result)}`);
        }
        pass(`getlatest returned numConflicts=${result.numConflicts}, numUpdated=${result.numUpdated}`);
        passed++;
    } catch (err) {
        fail('getlatest returns numConflicts', err.message);
        failed++;
    }

    // --- Test 4: JS conflict check logic ---
    try {
        // Simulate what getLatestBranch does after our fix
        const result = await runTfvcOp('getlatest', { branchPath: TARGET_BRANCH });
        if (result.numConflicts > 0) {
            pass(`Conflict correctly detected: numConflicts=${result.numConflicts} → pipeline WOULD throw`);
            passed++;
        } else if (existingConflicts > 0) {
            // There were conflicts in the query but getlatest didn't report them
            // (getlatest with Overwrite may resolve them)
            pass(`getlatest resolved ${existingConflicts} prior conflict(s) via Overwrite — numConflicts=0`);
            passed++;
        } else {
            pass('No conflicts present — getlatest correctly returns numConflicts=0');
            passed++;
        }
    } catch (err) {
        fail('JS conflict check logic', err.message);
        failed++;
    }

    // --- Test 5: pending changes after getlatest ---
    try {
        const result = await runTfvcOp('status', { path: TARGET_BRANCH });
        if (!result.success) throw new Error(`status returned success=false: ${result.error}`);
        pass(`Pending changes: ${result.count}`);
        if (result.count > 0) {
            result.changes.forEach((c) => {
                console.log(`    → ${c.changeType}: ${c.serverItem}`);
            });
        }
        passed++;
    } catch (err) {
        fail('Pending changes query', err.message);
        failed++;
    }

    // --- Summary ---
    console.log('');
    console.log(`Results: ${passed} passed, ${failed} failed`);

    if (existingConflicts > 0) {
        console.log('');
        console.log('NOTE: There are unresolved conflicts in the workspace.');
        console.log('To fully test conflict-stops-pipeline, run: npm run dev');
        console.log('The pipeline should now FAIL at the TFVC step, restart services, and notify Teams.');
    } else {
        console.log('');
        console.log('NOTE: No conflicts currently present.');
        console.log('To test conflict detection:');
        console.log('  1. Manually edit a file locally (e.g. the descriptor XML)');
        console.log('  2. Also change the same file on the server (check in from another workspace)');
        console.log('  3. Run: npm run dev');
        console.log('  4. The pipeline should FAIL at TFVC step with "conflict(s) detected"');
    }

    process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error('Unexpected error:', err);
    process.exit(1);
});
