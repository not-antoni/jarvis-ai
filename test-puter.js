/**
 * Test script for Puter provider integration
 */

require('dotenv').config();
const AIProviderManager = require('./ai-providers');

async function testPuterProvider() {
    console.log('Testing Puter provider integration...\n');
    
    // Check if Puter tokens are available
    const puterTokens = [
        process.env.PUTER_TOKEN,
        process.env.PUTER_TOKEN2,
    ].filter(Boolean);
    
    if (puterTokens.length === 0) {
        console.log('❌ No Puter tokens found in environment variables.');
        console.log('Please set PUTER_TOKEN and/or PUTER_TOKEN2 environment variables.');
        console.log('Example: export PUTER_TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...');
        return;
    }
    
    console.log(`✅ Found ${puterTokens.length} Puter token(s)`);
    
    // Get provider status
    const status = AIProviderManager.getProviderStatus();
    const puterProviders = status.filter(p => p.name.startsWith('Puter'));
    
    console.log(`\nPuter providers found: ${puterProviders.length}`);
    puterProviders.forEach(provider => {
        console.log(`- ${provider.name}: ${provider.model} (Error: ${provider.hasError ? 'Yes' : 'No'})`);
    });
    
    if (puterProviders.length === 0) {
        console.log('❌ No Puter providers were initialized. Check your environment variables.');
        return;
    }
    
    // Test a simple AI request
    try {
        console.log('\n🧪 Testing AI request...');
        const result = await AIProviderManager.generateResponse(
            'You are a helpful assistant.',
            'Hello! Can you tell me what 2+2 equals?',
            100
        );
        
        console.log(`✅ Success! Provider: ${result.provider}`);
        console.log(`Response: ${result.content}`);
        
    } catch (error) {
        console.log(`❌ Error during AI request: ${error.message}`);
        
        // Show detailed provider status
        console.log('\nDetailed provider status:');
        status.forEach(provider => {
            if (provider.name.startsWith('Puter')) {
                console.log(`- ${provider.name}:`);
                console.log(`  Model: ${provider.model}`);
                console.log(`  Has Error: ${provider.hasError}`);
                if (provider.lastError) {
                    console.log(`  Last Error: ${provider.lastError.error}`);
                    console.log(`  Error Time: ${new Date(provider.lastError.timestamp).toISOString()}`);
                }
                console.log(`  Metrics: ${JSON.stringify(provider.metrics)}`);
            }
        });
    }
}

// Run the test
testPuterProvider().catch(console.error);
