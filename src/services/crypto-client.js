const fetch = require('node-fetch');
const config = require('../../config');

const BASE_URL = 'https://pro-api.coinmarketcap.com/v1';

class CryptoClient {
    constructor() {
        this.apiKey = config.crypto?.apiKey || null;
    }

    ensureApiKey() {
        if (!this.apiKey) {
            const error = new Error('CRYPTO_API_KEY is not configured');
            error.code = 'CRYPTO_API_KEY_MISSING';
            throw error;
        }
    }

    async getQuote({ symbol, convert = 'USD' }) {
        this.ensureApiKey();

        const upperSymbol = String(symbol || '')
            .trim()
            .toUpperCase();
        const upperConvert = String(convert || 'USD')
            .trim()
            .toUpperCase();

        if (!upperSymbol) {
            const error = new Error('Missing cryptocurrency symbol');
            error.code = 'CRYPTO_SYMBOL_REQUIRED';
            throw error;
        }

        const url = new URL(`${BASE_URL}/cryptocurrency/quotes/latest`);
        url.searchParams.set('symbol', upperSymbol);
        url.searchParams.set('convert', upperConvert);

        const response = await fetch(url.toString(), {
            headers: {
                'X-CMC_PRO_API_KEY': this.apiKey,
                Accept: 'application/json'
            }
        });

        if (!response.ok) {
            const text = await response.text();
            const error = new Error(`CoinMarketCap request failed with status ${response.status}`);
            error.code = 'CRYPTO_HTTP_ERROR';
            error.status = response.status;
            error.body = text;
            throw error;
        }

        const payload = await response.json();
        if (payload?.status?.error_code) {
            const error = new Error(payload.status.error_message || 'CoinMarketCap API error');
            error.code = 'CRYPTO_API_ERROR';
            error.status = payload.status.error_code;
            throw error;
        }

        const asset = payload?.data?.[upperSymbol];
        if (!asset) {
            const error = new Error(`No market data available for ${upperSymbol}`);
            error.code = 'CRYPTO_UNKNOWN_SYMBOL';
            throw error;
        }

        const quote = asset.quote?.[upperConvert];
        if (!quote) {
            const error = new Error(`No ${upperConvert} quote available for ${upperSymbol}`);
            error.code = 'CRYPTO_UNSUPPORTED_CONVERT';
            throw error;
        }

        return {
            asset,
            quote,
            convert: upperConvert
        };
    }
}

module.exports = new CryptoClient();
