require('dotenv').config();

// Temporarily override the credentials for testing
process.env.TFVC_USERNAME = 'buildsvc@example.com';
process.env.TFVC_PASSWORD = 'YOUR_TFVC_PAT_OR_PASSWORD';

console.log('ðŸ§ª Testing with Personal Account Credentials');
console.log('==========================================\n');
console.log('Username:', process.env.TFVC_USERNAME);
console.log('Password (PAT):', process.env.TFVC_PASSWORD ? '[PAT_SET]' : '[NOT_SET]');
console.log('');

// Import and run the original TFVC merge script
const TFVCMerge = require('./tfvc-merge.js');

const tfvcMerge = new TFVCMerge();
tfvcMerge.execute()
    .then((result) => {
        console.log('\nðŸŽ‰ TFVC merge test completed successfully!');
        console.log(`âœ… Result: ${result.message}`);
        if (result.details && result.details.changeset) {
            console.log(`ðŸ”¢ Changeset: ${result.details.changeset}`);
        }
        process.exit(0);
    })
    .catch((error) => {
        console.error('\nðŸ’¥ TFVC merge test failed:', error.message);
        process.exit(1);
    });

