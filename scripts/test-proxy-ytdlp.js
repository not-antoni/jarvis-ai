/**
 * Proxy + yt-dlp Test Script
 * Tests Webshare proxies for YouTube video downloading
 * 
 * Usage: node scripts/test-proxy-ytdlp.js [video_url]
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Webshare proxies (ip:port:user:pass format)
const WEBSHARE_PROXIES = [
    '142.111.48.253:7030:wojmwcoa:9vkd3d8e2ehl',
    '23.95.150.145:6114:wojmwcoa:9vkd3d8e2ehl',
    '198.23.239.134:6540:wojmwcoa:9vkd3d8e2ehl',
    '107.172.163.27:6543:wojmwcoa:9vkd3d8e2ehl',
    '198.105.121.200:6462:wojmwcoa:9vkd3d8e2ehl',
    '64.137.96.74:6641:wojmwcoa:9vkd3d8e2ehl',
    '84.247.60.125:6095:wojmwcoa:9vkd3d8e2ehl',
    '216.10.27.159:6837:wojmwcoa:9vkd3d8e2ehl',
    '23.26.71.145:5628:wojmwcoa:9vkd3d8e2ehl',
    '23.27.208.120:5830:wojmwcoa:9vkd3d8e2ehl'
];

// Convert to yt-dlp proxy format: http://user:pass@ip:port
function formatProxy(proxyString) {
    const [ip, port, user, pass] = proxyString.split(':');
    return `http://${user}:${pass}@${ip}:${port}`;
}

// Test a single proxy with yt-dlp
async function testProxy(proxyString, videoUrl) {
    const proxy = formatProxy(proxyString);
    const [ip, port] = proxyString.split(':');
    
    console.log(`\n🔄 Testing proxy: ${ip}:${port}`);
    
    return new Promise((resolve) => {
        const startTime = Date.now();
        
        // Use yt-dlp to get video info (fast test, no download)
        const ytdlp = spawn('yt-dlp', [
            '--proxy', proxy,
            '--socket-timeout', '10',
            '--no-warnings',
            '--print', 'title',
            '--print', 'duration',
            videoUrl
        ], {
            timeout: 15000
        });
        
        let stdout = '';
        let stderr = '';
        
        ytdlp.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        
        ytdlp.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        ytdlp.on('close', (code) => {
            const elapsed = Date.now() - startTime;
            
            if (code === 0 && stdout.trim()) {
                const lines = stdout.trim().split('\n');
                console.log(`   ✅ SUCCESS in ${elapsed}ms`);
                console.log(`   📹 Title: ${lines[0]}`);
                console.log(`   ⏱️  Duration: ${lines[1]}s`);
                resolve({ success: true, proxy: `${ip}:${port}`, elapsed, title: lines[0] });
            } else {
                console.log(`   ❌ FAILED in ${elapsed}ms`);
                if (stderr) console.log(`   Error: ${stderr.slice(0, 100)}`);
                resolve({ success: false, proxy: `${ip}:${port}`, elapsed, error: stderr.slice(0, 100) });
            }
        });
        
        ytdlp.on('error', (err) => {
            console.log(`   ❌ SPAWN ERROR: ${err.message}`);
            resolve({ success: false, proxy: `${ip}:${port}`, error: err.message });
        });
        
        // Timeout fallback
        setTimeout(() => {
            ytdlp.kill('SIGTERM');
        }, 15000);
    });
}

// Test downloading audio with a working proxy
async function testDownload(proxyString, videoUrl) {
    const proxy = formatProxy(proxyString);
    const [ip, port] = proxyString.split(':');
    const outputPath = path.join(__dirname, 'test_download.mp3');
    
    console.log(`\n📥 Testing download via ${ip}:${port}...`);
    
    return new Promise((resolve) => {
        const startTime = Date.now();
        
        const ytdlp = spawn('yt-dlp', [
            '--proxy', proxy,
            '--socket-timeout', '30',
            '-x',                      // Extract audio
            '--audio-format', 'mp3',
            '--audio-quality', '5',    // Lower quality for faster test
            '-o', outputPath,
            '--no-playlist',
            videoUrl
        ]);
        
        let stderr = '';
        
        ytdlp.stdout.on('data', (data) => {
            process.stdout.write(data.toString());
        });
        
        ytdlp.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        ytdlp.on('close', (code) => {
            const elapsed = Date.now() - startTime;
            
            if (code === 0 && fs.existsSync(outputPath)) {
                const stats = fs.statSync(outputPath);
                console.log(`\n   ✅ DOWNLOAD SUCCESS in ${(elapsed / 1000).toFixed(1)}s`);
                console.log(`   📦 File size: ${(stats.size / 1024).toFixed(1)} KB`);
                
                // Clean up test file
                fs.unlinkSync(outputPath);
                console.log(`   🗑️  Cleaned up test file`);
                
                resolve({ success: true, elapsed, size: stats.size });
            } else {
                console.log(`\n   ❌ DOWNLOAD FAILED`);
                resolve({ success: false, error: stderr.slice(0, 200) });
            }
        });
    });
}

// Main test runner
async function main() {
    console.log('═══════════════════════════════════════════════════════');
    console.log('   🧪 PROXY + YT-DLP TEST SCRIPT');
    console.log('═══════════════════════════════════════════════════════');
    
    // Get video URL from args or use default test video
    const videoUrl = process.argv[2] || 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    console.log(`\n🎬 Test video: ${videoUrl}`);
    console.log(`📡 Testing ${WEBSHARE_PROXIES.length} Webshare proxies...\n`);
    
    const results = [];
    
    // Test each proxy (limit to 3 for speed)
    const proxiesToTest = WEBSHARE_PROXIES.slice(0, 3);
    
    for (const proxy of proxiesToTest) {
        const result = await testProxy(proxy, videoUrl);
        results.push(result);
    }
    
    // Summary
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('   📊 RESULTS SUMMARY');
    console.log('═══════════════════════════════════════════════════════');
    
    const working = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    console.log(`\n✅ Working: ${working.length}/${results.length}`);
    working.forEach(r => console.log(`   - ${r.proxy} (${r.elapsed}ms)`));
    
    if (failed.length > 0) {
        console.log(`\n❌ Failed: ${failed.length}/${results.length}`);
        failed.forEach(r => console.log(`   - ${r.proxy}`));
    }
    
    // Test actual download with first working proxy
    if (working.length > 0) {
        const bestProxy = working.sort((a, b) => a.elapsed - b.elapsed)[0];
        const proxyString = WEBSHARE_PROXIES.find(p => p.startsWith(bestProxy.proxy.split(':')[0]));
        
        console.log(`\n🚀 Testing download with fastest proxy (${bestProxy.proxy})...`);
        await testDownload(proxyString, videoUrl);
    }
    
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('   ✨ TEST COMPLETE');
    console.log('═══════════════════════════════════════════════════════\n');
}

main().catch(console.error);
