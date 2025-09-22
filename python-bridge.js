/**
 * Python Bridge - Execute Python scripts from Node.js
 * Uses child_process.spawn for efficient communication
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const jsWikiScraper = require('./js-wiki-scraper');

class PythonBridge {
    constructor() {
        // Try different Python paths for different environments
        this.pythonPaths = ['python', 'python3', 'python3.9', 'python3.10', 'python3.11', 'python3.12'];
        this.pythonPath = 'python'; // Default fallback
    }

    /**
     * Execute the wiki scraper with search functionality
     * @param {string} searchQuery - The search query for the wiki
     * @returns {Promise<Object>} - The scraped data or error
     */
    async searchWiki(searchQuery) {
        // Check if Python is available first
        const pythonAvailable = await this.checkPythonAvailability();
        if (!pythonAvailable) {
            return this.fallbackSearch(searchQuery);
        }

        return new Promise((resolve, reject) => {
            console.log(`Executing wiki search for: "${searchQuery}"`);
            
            // Spawn Python process with scraper.py
            const pythonProcess = spawn(this.pythonPath, [
                'scraper.py',
                searchQuery,
                '--search-query',
                '--no-link-repeat'
            ]);

            let stdout = '';
            let stderr = '';

            // Collect stdout data
            pythonProcess.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            // Collect stderr data
            pythonProcess.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            // Handle process completion
            pythonProcess.on('close', (code) => {
                console.log(`Python process exited with code: ${code}`);
                
                if (code !== 0) {
                    console.error('Python process error:', stderr);
                    reject(new Error(`Python process failed with code ${code}: ${stderr}`));
                    return;
                }

                try {
                    // Parse the stdout data directly (Python script outputs JSONL to stdout)
                    const lines = stdout.trim().split('\n').filter(line => line.trim());
                    
                    if (lines.length === 0) {
                        console.log('No data found in Python output. This might mean:');
                        console.log('1. The search query returned no results');
                        console.log('2. The search results were filtered out');
                        console.log('3. There was an issue with the search parsing');
                        reject(new Error('No data found in Python output - search may have returned no results'));
                        return;
                    }

                    // Parse each line as JSON
                    const scrapedData = lines.map(line => {
                        try {
                            return JSON.parse(line);
                        } catch (parseError) {
                            console.error('Error parsing JSON line:', line);
                            return null;
                        }
                    }).filter(item => item !== null);

                    resolve({
                        success: true,
                        data: scrapedData,
                        query: searchQuery,
                        pagesFound: scrapedData.length
                    });

                } catch (error) {
                    console.error('Error processing Python output:', error);
                    reject(new Error(`Failed to process Python output: ${error.message}`));
                }
            });

            // Handle process errors
            pythonProcess.on('error', (error) => {
                console.error('Failed to start Python process:', error);
                reject(new Error(`Failed to start Python process: ${error.message}`));
            });

            // Set a timeout to prevent hanging
            setTimeout(() => {
                pythonProcess.kill();
                reject(new Error('Python process timed out'));
            }, 30000); // 30 second timeout
        });
    }

    /**
     * Check if Python is available and find the correct path
     * @returns {Promise<boolean>}
     */
    async checkPythonAvailability() {
        for (const pythonPath of this.pythonPaths) {
            const isAvailable = await this.testPythonPath(pythonPath);
            if (isAvailable) {
                this.pythonPath = pythonPath;
                console.log(`Found Python at: ${pythonPath}`);
                return true;
            }
        }
        console.warn('No Python installation found, will use JS fallback');
        return false;
    }

    /**
     * Test a specific Python path
     * @param {string} pythonPath - Path to test
     * @returns {Promise<boolean>}
     */
    async testPythonPath(pythonPath) {
        return new Promise((resolve) => {
            const pythonProcess = spawn(pythonPath, ['--version']);
            
            pythonProcess.on('close', (code) => {
                resolve(code === 0);
            });
            
            pythonProcess.on('error', () => {
                resolve(false);
            });
        });
    }

    /**
     * Fallback search when Python is not available
     * @param {string} searchQuery - The search query
     * @returns {Promise<Object>} - Fallback response
     */
    async fallbackSearch(searchQuery) {
        console.log('Python not available, using JS wiki scraper fallback');
        
        try {
            // Use the JavaScript wiki scraper
            const pages = await jsWikiScraper.searchAndScrape(searchQuery);
            
            if (pages.length === 0) {
                // Return a helpful message with common wiki terms
                const commonTerms = [
                    'D.E.M', 'S.T.F.R', 'C.R.R', 'Battery Array', 'Hadron Collider',
                    'OpenCore', 'Music and credits', 'The D.E.M', 'S.T.F.R Stabilization'
                ];
                
                const suggestions = commonTerms.filter(term => 
                    term.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    searchQuery.toLowerCase().includes(term.toLowerCase().replace(/[^a-z]/g, ''))
                );
                
                return {
                    success: false,
                    data: [],
                    query: searchQuery,
                    pagesFound: 0,
                    fallback: true,
                    suggestions: suggestions.slice(0, 3)
                };
            }
            
            return {
                success: true,
                data: pages,
                query: searchQuery,
                pagesFound: pages.length,
                fallback: true
            };
            
        } catch (error) {
            console.error('JS Wiki Scraper fallback error:', error);
            
            // Ultimate fallback with static suggestions
            const commonTerms = [
                'D.E.M', 'S.T.F.R', 'C.R.R', 'Battery Array', 'Hadron Collider',
                'OpenCore', 'Music and credits', 'The D.E.M', 'S.T.F.R Stabilization'
            ];
            
            const suggestions = commonTerms.filter(term => 
                term.toLowerCase().includes(searchQuery.toLowerCase()) ||
                searchQuery.toLowerCase().includes(term.toLowerCase().replace(/[^a-z]/g, ''))
            );
            
            return {
                success: false,
                data: [],
                query: searchQuery,
                pagesFound: 0,
                fallback: true,
                suggestions: suggestions.slice(0, 3)
            };
        }
    }

    /**
     * Set custom Python path
     * @param {string} pythonPath - Path to Python executable
     */
    setPythonPath(pythonPath) {
        this.pythonPath = pythonPath;
    }
}

module.exports = new PythonBridge();
