require('dotenv').config();
const { spawn } = require('child_process');

class SimpleBranchTest {
    constructor() {
        this.collectionUrl = process.env.TFVC_COLLECTION_URL;
        this.username = process.env.TFVC_USERNAME;
        this.password = process.env.TFVC_PASSWORD;
    }

    async test() {
        console.log('🔍 Simple Branch Test');
        console.log('====================\n');

        const tfPath = this.findTFExecutable();
        if (!tfPath) {
            console.log('❌ TF.exe not found');
            return;
        }

        console.log(`✅ Using TF at: ${tfPath}`);

        try {
            // Test 1: List all projects in the collection
            console.log('\n📋 Testing collection access:');
            const collectionTest = await this.runTF(tfPath, 'workspaces', [
                '/collection:' + this.collectionUrl,
                '/noprompt',
                '/login:' + this.username + ',' + this.password
            ]);

            console.log('Collection result:');
            console.log('Success:', collectionTest.success);
            console.log('Stdout:', collectionTest.stdout);
            console.log('Stderr:', collectionTest.stderr);

            // Test 2: Try to list the root directory
            console.log('\n📁 Testing root directory:');
            const rootTest = await this.runTF(tfPath, 'dir', [
                '$/',
                '/collection:' + this.collectionUrl,
                '/noprompt',
                '/login:' + this.username + ',' + this.password
            ]);

            console.log('Root directory result:');
            console.log('Success:', rootTest.success);
            console.log('Stdout:', rootTest.stdout);
            console.log('Stderr:', rootTest.stderr);

            // Test 3: Try without collection URL
            console.log('\n🔧 Testing without collection URL:');
            const simpleTest = await this.runTF(tfPath, 'workspaces', [
                '/noprompt',
                '/login:' + this.username + ',' + this.password
            ]);

            console.log('Simple workspaces result:');
            console.log('Success:', simpleTest.success);
            console.log('Stdout:', simpleTest.stdout);
            console.log('Stderr:', simpleTest.stderr);

        } catch (error) {
            console.error('❌ Test failed:', error.message);
        }
    }

    findTFExecutable() {
        const possiblePaths = [
            'C:\\Program Files\\Microsoft Visual Studio\\2022\\Professional\\Common7\\IDE\\CommonExtensions\\Microsoft\\TeamFoundation\\Team Explorer\\tf.exe',
            'C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise\\Common7\\IDE\\CommonExtensions\\Microsoft\\TeamFoundation\\Team Explorer\\tf.exe',
            'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\Common7\\IDE\\CommonExtensions\\Microsoft\\TeamFoundation\\Team Explorer\\tf.exe',
            'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Enterprise\\Common7\\IDE\\CommonExtensions\\Microsoft\\TeamFoundation\\Team Explorer\\tf.exe',
            'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Professional\\Common7\\IDE\\CommonExtensions\\Microsoft\\TeamFoundation\\Team Explorer\\tf.exe',
            'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Community\\Common7\\IDE\\CommonExtensions\\Microsoft\\TeamFoundation\\Team Explorer\\tf.exe'
        ];

        for (const tfPath of possiblePaths) {
            const fs = require('fs');
            if (fs.existsSync(tfPath)) {
                return tfPath;
            }
        }
        return null;
    }

    async runTF(tfPath, command, args) {
        return new Promise((resolve) => {
            let stdout = '';
            let stderr = '';

            console.log(`Running: ${tfPath} ${command} ${args.join(' ')}`);

            const tf = spawn(`"${tfPath}"`, [command, ...args], {
                shell: true,
                stdio: ['pipe', 'pipe', 'pipe'],
                timeout: 30000
            });

            tf.stdout.on('data', (data) => {
                const output = data.toString();
                stdout += output;
            });

            tf.stderr.on('data', (data) => {
                const output = data.toString();
                stderr += output;
            });

            tf.on('close', (code) => {
                resolve({
                    success: code === 0,
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    code
                });
            });

            tf.on('error', (error) => {
                resolve({
                    success: false,
                    stdout: '',
                    stderr: error.message,
                    code: -1
                });
            });
        });
    }
}

// Execute if run directly
if (require.main === module) {
    const tester = new SimpleBranchTest();
    tester.test();
}

module.exports = SimpleBranchTest;