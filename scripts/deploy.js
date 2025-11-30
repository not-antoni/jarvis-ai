/**
 * Deployment verification script
 * Run this to check if everything is ready for Render deployment
 */

const { gatherHealthSnapshot } = require('./diagnostics');

async function verifyDeployment() {
    console.log('🔍 Verifying Jarvis deployment readiness...\n');

    const snapshot = await gatherHealthSnapshot({
        pingDatabase: true,
        attemptReconnect: true,
        includeProviders: true,
        redactProviders: false
    });

    console.log('✅ Environment Variables:');
    snapshot.env.required.forEach(({ name, present }) => {
        console.log(`  ${present ? '✅' : '❌'} ${name}: ${present ? 'Set' : 'Missing (REQUIRED)'}`);
    });

    snapshot.env.optional.forEach(({ name, present }) => {
        console.log(`  ${present ? '✅' : '⚠️ '} ${name}: ${present ? 'Set' : 'Not set (optional)'}`);
    });

    console.log(
        `\n📊 AI Providers: ${snapshot.providers.length} configured (${snapshot.providers.filter(p => !p.hasError && !p.isDisabled).length} healthy)`
    );
    console.log(
        `📊 Optional APIs: ${snapshot.env.optionalConfigured}/${snapshot.env.optionalTotal} configured`
    );

    if (!snapshot.env.hasAllRequired) {
        console.log('\n❌ Deployment will fail - missing required environment variables');
        return false;
    }

    if (!snapshot.providers.length) {
        console.log('\n⚠️  Warning: No AI providers configured - bot will have limited functionality');
    }

    console.log('\n🔗 Testing database connection...');
    if (snapshot.database.ping === 'ok') {
        console.log('✅ Database connection successful');
    } else if (snapshot.database.error) {
        console.log(`❌ Database connection failed: ${snapshot.database.error}`);
        return false;
    } else {
        console.log('⚠️  Database ping skipped');
    }

    console.log('\n✅ Deployment verification complete!');
    console.log('🚀 Your bot is ready for Render deployment');
    return true;
}

// Run verification if this file is executed directly
if (require.main === module) {
    verifyDeployment()
        .then(success => process.exit(success ? 0 : 1))
        .catch(error => {
            console.error('Verification failed:', error);
            process.exit(1);
        });
}

module.exports = verifyDeployment;
