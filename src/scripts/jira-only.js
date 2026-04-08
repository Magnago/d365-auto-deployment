require('dotenv').config();
const JiraService = require('../core/jira-service');
const logger = require('../core/logger');

class JiraOnly {
    constructor() {
        this.jira = new JiraService();
    }

    async execute() {
        return this.jira.execute();
    }
}

if (require.main === module) {
    const runner = new JiraOnly();
    runner.execute()
        .then((result) => {
            console.log(result.message);
            if (result.details?.issues) {
                for (const issue of result.details.issues) {
                    const status = issue.success ? 'OK' : `FAILED: ${issue.error}`;
                    console.log(`  ${issue.key} -> ${issue.assignedTo || 'N/A'} [${status}]`);
                    if (issue.linkedIssues?.length > 0) {
                        for (const linked of issue.linkedIssues) {
                            const lStatus = linked.success ? 'OK' : `FAILED: ${linked.error}`;
                            console.log(`    -> ${linked.key} -> ${linked.assignedTo || 'N/A'} [${lStatus}]`);
                        }
                    }
                }
            }
            process.exit(0);
        })
        .catch((error) => {
            console.error(`Jira transition failed: ${error.message}`);
            process.exit(1);
        });
}

module.exports = JiraOnly;
