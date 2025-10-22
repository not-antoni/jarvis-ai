/**
 * Deployment verification script
 * Run this to check if everything is ready for Render deployment
 */

const config = require('./config');
const database = require('./database');
const aiManager = require('./ai-providers');

async function verifyDeployment() {
    console.log('🔍 Verifying Jarvis deployment readiness...\n');
    
    // Check environment variables
    console.log('✅ Environment Variables:');
    const requiredVars = ['DISCORD_TOKEN', 'MONGO_PW'];
    const optionalVars = [
        'OPENROUTER_API_KEY', 'GROQ_API_KEY', 'GOOGLE_AI_API_KEY',
        'MIXTRAL_API_KEY', 'HF_TOKEN', 'OPENAI_API_KEY'
    ];
    
    let hasRequired = true;
    requiredVars.forEach(varName => {
        if (process.env[varName]) {
            console.log(`  ✅ ${varName}: Set`);
        } else {
            console.log(`  ❌ ${varName}: Missing (REQUIRED)`);
            hasRequired = false;
        }
    });
    
    let hasOptional = 0;
    optionalVars.forEach(varName => {
        if (process.env[varName]) {
            console.log(`  ✅ ${varName}: Set`);
            hasOptional++;
        } else {
            console.log(`  ⚠️  ${varName}: Not set (optional)`);
        }
    });
    
    console.log(`\n📊 AI Providers: ${aiManager.providers.length} configured`);
    console.log(`📊 Optional APIs: ${hasOptional}/${optionalVars.length} configured`);
    
    if (!hasRequired) {
        console.log('\n❌ Deployment will fail - missing required environment variables');
        return false;
    }
    
    if (aiManager.providers.length === 0) {
        console.log('\n⚠️  Warning: No AI providers configured - bot will have limited functionality');
    }
    
    // Test database connection
    console.log('\n🔗 Testing database connection...');
    try {
        await database.connect();
        console.log('✅ Database connection successful');
        await database.disconnect();
    } catch (error) {
        console.log('❌ Database connection failed:', error.message);
        return false;
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
