require('dotenv').config();

// Use your personal account credentials
process.env.TFVC_USERNAME = 'buildsvc@example.com';
process.env.TFVC_PASSWORD = 'YOUR_TFVC_PAT_OR_PASSWORD';

const { spawn } = require('child_process');

async function testManualCommand() {
    console.log('ðŸ§ª Manual TFVC Command Test');
    console.log('==========================\n');

    const tfPath = 'C:\\Program Files\\Microsoft Visual Studio\\2022\\Professional\\Common7\\IDE\\CommonExtensions\\Microsoft\\TeamFoundation\\Team Explorer\\tf.exe';
    const username = process.env.TFVC_USERNAME;
    const patToken = process.env.TFVC_PASSWORD;

    console.log('Testing with account:', username);
    console.log('');

    // Test 1: Simple workspaces command
    console.log('1. Testing workspaces command...');
    await runCommand(tfPath, ['workspaces', '/login:' + username + ',' + patToken]);

    // Test 2: Test merge with properly quoted paths
    console.log('\n2. Testing merge command...');
    await runCommand(tfPath, [
        'merge',
        '"$/Your TFVC Project/Auto-Deployment-Dev"',
        '"$/Your TFVC Project/Auto-Deployment-Test"',
        '/recursive',
        '/force',
        '/login:' + username + ',' + patToken
    ]);

    // Test 3: Test status
    console.log('\n3. Testing status command...');
    await runCommand(tfPath, ['status', '/recursive', '/login:' + username + ',' + patToken]);
}

async function runCommand(exePath, args) {
    return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';

        console.log(`   Running: "${exePath}" ${args.join(' ')}`);

        const process = spawn(exePath, args, {
            shell: true,
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 60000
        });

        process.stdout.on('data', (data) => {
            const output = data.toString();
            stdout += output;
            console.log('   STDOUT:', output.trim());
        });

        process.stderr.on('data', (data) => {
            const output = data.toString();
            stderr += output;
            console.log('   STDERR:', output.trim());
        });

        process.on('close', (code) => {
            console.log(`   Exit code: ${code}`);
            console.log(`   Success: ${code === 0}`);
            resolve({ success: code === 0, stdout, stderr, code });
        });

        process.on('error', (error) => {
            console.log('   ERROR:', error.message);
            resolve({ success: false, stdout: '', stderr: error.message, code: -1 });
        });
    });
}

testManualCommand();


