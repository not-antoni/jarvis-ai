/**
 * Real-time Data Service
 * Provides weather, stocks, news, and other real-time information
 */

const axios = require('axios');
const weather = require('weather-js');

class RealtimeDataService {
    constructor() {
        this.newsApiKey = process.env.NEWS_API_KEY;
        this.stockApiKey = process.env.ALPHA_VANTAGE_API_KEY;
        this.cryptoApiKey = process.env.COINMARKETCAP_API_KEY;
        this.cache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    }

    // Weather Services
    async getWeather(location, options = {}) {
        const cacheKey = `weather_${location}`;
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        try {
            console.log(`Fetching weather for: ${location}`);
            
            return new Promise((resolve, reject) => {
                weather.find({
                    search: location,
                    degreeType: options.unit || 'F'
                }, (err, result) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    if (result && result.length > 0) {
                        const data = result[0];
                        const weatherData = {
                            location: data.location.name,
                            current: {
                                temperature: data.current.temperature,
                                skytext: data.current.skytext,
                                humidity: data.current.humidity,
                                winddisplay: data.current.winddisplay,
                                feelslike: data.current.feelslike
                            },
                            forecast: data.forecast.slice(0, 3).map(day => ({
                                day: day.day,
                                low: day.low,
                                high: day.high,
                                skytextday: day.skytextday
                            })),
                            unit: data.location.degreetype,
                            timestamp: new Date().toISOString()
                        };

                        this.setCache(cacheKey, weatherData);
                        resolve(weatherData);
                    } else {
                        reject(new Error('Location not found'));
                    }
                });
            });
        } catch (error) {
            console.error('Weather fetch error:', error);
            throw error;
        }
    }

    // Stock Market Services
    async getStockQuote(symbol) {
        const cacheKey = `stock_${symbol}`;
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        try {
            console.log(`Fetching stock data for: ${symbol}`);
            
            if (this.stockApiKey) {
                // Use Alpha Vantage API
                const response = await axios.get(
                    `https://www.alphavantage.co/query`,
                    {
                        params: {
                            function: 'GLOBAL_QUOTE',
                            symbol: symbol,
                            apikey: this.stockApiKey
                        },
                        timeout: 10000
                    }
                );

                if (response.data && response.data['Global Quote']) {
                    const quote = response.data['Global Quote'];
                    const stockData = {
                        symbol: quote['01. symbol'],
                        price: parseFloat(quote['05. price']),
                        change: parseFloat(quote['09. change']),
                        changePercent: quote['10. change percent'],
                        volume: parseInt(quote['06. volume']),
                        high: parseFloat(quote['03. high']),
                        low: parseFloat(quote['04. low']),
                        open: parseFloat(quote['02. open']),
                        previousClose: parseFloat(quote['08. previous close']),
                        timestamp: new Date().toISOString()
                    };

                    this.setCache(cacheKey, stockData);
                    return stockData;
                } else {
                    throw new Error('Invalid API response');
                }
            } else {
                // Fallback to free API
                return await this.getStockQuoteFallback(symbol);
            }
        } catch (error) {
            console.error('Stock fetch error:', error);
            return await this.getStockQuoteFallback(symbol);
        }
    }

    async getStockQuoteFallback(symbol) {
        try {
            // Use Yahoo Finance or other free API
            const response = await axios.get(
                `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`,
                { timeout: 10000 }
            );

            if (response.data && response.data.chart && response.data.chart.result) {
                const result = response.data.chart.result[0];
                const meta = result.meta;
                const quote = result.indicators.quote[0];

                const stockData = {
                    symbol: meta.symbol,
                    price: meta.regularMarketPrice,
                    change: meta.regularMarketPrice - meta.previousClose,
                    changePercent: ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose * 100).toFixed(2) + '%',
                    volume: meta.regularMarketVolume,
                    high: meta.regularMarketDayHigh,
                    low: meta.regularMarketDayLow,
                    open: meta.regularMarketOpen,
                    previousClose: meta.previousClose,
                    timestamp: new Date().toISOString()
                };

                this.setCache(`stock_${symbol}`, stockData);
                return stockData;
            } else {
                throw new Error('No data available');
            }
        } catch (error) {
            console.error('Fallback stock fetch error:', error);
            throw error;
        }
    }

    // Cryptocurrency Services
    async getCryptoPrice(symbol) {
        const cacheKey = `crypto_${symbol}`;
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        try {
            console.log(`Fetching crypto data for: ${symbol}`);
            
            // Use CoinGecko free API
            const response = await axios.get(
                `https://api.coingecko.com/api/v3/simple/price`,
                {
                    params: {
                        ids: this.getCoinGeckoId(symbol),
                        vs_currencies: 'usd',
                        include_24hr_change: true,
                        include_24hr_vol: true,
                        include_market_cap: true
                    },
                    timeout: 10000
                }
            );

            if (response.data) {
                const coinId = this.getCoinGeckoId(symbol);
                const data = response.data[coinId];
                
                if (data) {
                    const cryptoData = {
                        symbol: symbol.toUpperCase(),
                        name: this.getCoinName(symbol),
                        price: data.usd,
                        change24h: data.usd_24h_change,
                        volume24h: data.usd_24h_vol,
                        marketCap: data.usd_market_cap,
                        timestamp: new Date().toISOString()
                    };

                    this.setCache(cacheKey, cryptoData);
                    return cryptoData;
                } else {
                    throw new Error('Cryptocurrency not found');
                }
            } else {
                throw new Error('Invalid API response');
            }
        } catch (error) {
            console.error('Crypto fetch error:', error);
            throw error;
        }
    }

    getCoinGeckoId(symbol) {
        const mapping = {
            'BTC': 'bitcoin',
            'ETH': 'ethereum',
            'ADA': 'cardano',
            'DOT': 'polkadot',
            'LINK': 'chainlink',
            'LTC': 'litecoin',
            'XRP': 'ripple',
            'DOGE': 'dogecoin',
            'SHIB': 'shiba-inu',
            'MATIC': 'matic-network'
        };
        return mapping[symbol.toUpperCase()] || symbol.toLowerCase();
    }

    getCoinName(symbol) {
        const names = {
            'BTC': 'Bitcoin',
            'ETH': 'Ethereum',
            'ADA': 'Cardano',
            'DOT': 'Polkadot',
            'LINK': 'Chainlink',
            'LTC': 'Litecoin',
            'XRP': 'Ripple',
            'DOGE': 'Dogecoin',
            'SHIB': 'Shiba Inu',
            'MATIC': 'Polygon'
        };
        return names[symbol.toUpperCase()] || symbol.toUpperCase();
    }

    // News Services
    async getNews(query = 'technology', options = {}) {
        const cacheKey = `news_${query}_${options.language || 'en'}`;
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        try {
            console.log(`Fetching news for: ${query}`);
            
            if (this.newsApiKey) {
                // Use NewsAPI
                const response = await axios.get(
                    `https://newsapi.org/v2/everything`,
                    {
                        params: {
                            q: query,
                            apiKey: this.newsApiKey,
                            language: options.language || 'en',
                            sortBy: 'publishedAt',
                            pageSize: options.limit || 5
                        },
                        timeout: 10000
                    }
                );

                if (response.data && response.data.articles) {
                    const newsData = {
                        query: query,
                        articles: response.data.articles.map(article => ({
                            title: article.title,
                            description: article.description,
                            url: article.url,
                            source: article.source.name,
                            publishedAt: article.publishedAt,
                            imageUrl: article.urlToImage
                        })),
                        totalResults: response.data.totalResults,
                        timestamp: new Date().toISOString()
                    };

                    this.setCache(cacheKey, newsData);
                    return newsData;
                } else {
                    throw new Error('Invalid API response');
                }
            } else {
                // Fallback to RSS or other free sources
                return await this.getNewsFallback(query, options);
            }
        } catch (error) {
            console.error('News fetch error:', error);
            return await this.getNewsFallback(query, options);
        }
    }

    async getNewsFallback(query, options = {}) {
        try {
            // Use RSS feeds or other free news sources
            const rssFeeds = {
                technology: 'https://feeds.feedburner.com/oreilly/radar',
                business: 'https://feeds.finance.yahoo.com/rss/2.0/headline',
                science: 'https://rss.cnn.com/rss/edition.rss',
                general: 'https://feeds.bbci.co.uk/news/rss.xml'
            };

            const feedUrl = rssFeeds[query.toLowerCase()] || rssFeeds.general;
            
            // For now, return mock data - in a real implementation,
            // you'd parse the RSS feed
            const mockNews = {
                query: query,
                articles: [
                    {
                        title: `Latest ${query} news`,
                        description: `Breaking news in ${query} field`,
                        url: 'https://example.com',
                        source: 'News Service',
                        publishedAt: new Date().toISOString(),
                        imageUrl: null
                    }
                ],
                totalResults: 1,
                timestamp: new Date().toISOString()
            };

            this.setCache(`news_${query}_${options.language || 'en'}`, mockNews);
            return mockNews;
        } catch (error) {
            console.error('Fallback news fetch error:', error);
            throw error;
        }
    }

    // Utility Methods
    getCached(key) {
        const cached = this.cache.get(key);
        if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
            return cached.data;
        }
        this.cache.delete(key);
        return null;
    }

    setCache(key, data) {
        this.cache.set(key, {
            data: data,
            timestamp: Date.now()
        });
    }

    clearCache() {
        this.cache.clear();
        console.log('Cache cleared');
    }

    getCacheStats() {
        return {
            size: this.cache.size,
            keys: Array.from(this.cache.keys()),
            timeout: this.cacheTimeout
        };
    }

    // Combined Data Methods
    async getMarketOverview() {
        try {
            const [btc, eth, spy, nasdaq] = await Promise.allSettled([
                this.getCryptoPrice('BTC'),
                this.getCryptoPrice('ETH'),
                this.getStockQuote('SPY'),
                this.getStockQuote('QQQ')
            ]);

            return {
                crypto: {
                    bitcoin: btc.status === 'fulfilled' ? btc.value : null,
                    ethereum: eth.status === 'fulfilled' ? eth.value : null
                },
                stocks: {
                    sp500: spy.status === 'fulfilled' ? spy.value : null,
                    nasdaq: nasdaq.status === 'fulfilled' ? nasdaq.value : null
                },
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('Market overview error:', error);
            throw error;
        }
    }

    async getPersonalizedFeed(userId, preferences = {}) {
        try {
            const topics = preferences.topics || ['technology', 'science', 'business'];
            const promises = topics.map(topic => this.getNews(topic, { limit: 2 }));
            
            const results = await Promise.allSettled(promises);
            const articles = results
                .filter(result => result.status === 'fulfilled')
                .flatMap(result => result.value.articles);

            return {
                userId: userId,
                articles: articles.slice(0, 10), // Limit to 10 articles
                preferences: preferences,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('Personalized feed error:', error);
            throw error;
        }
    }
}

module.exports = new RealtimeDataService();
