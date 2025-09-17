# GPT-5 Nano Testing Script

This script allows you to test OpenAI's GPT-5 nano model with the complete Jarvis personality and system prompt from your Discord bot.

## Features

- **Complete Jarvis Personality**: Uses the exact same system prompt as your Discord bot
- **Comprehensive Testing**: Includes 8 predefined test cases covering various scenarios
- **Performance Metrics**: Tracks latency, token usage, and success rates
- **Custom Testing**: Support for custom input via command line arguments
- **Conversation History**: Maintains a log of all interactions
- **Error Handling**: Detailed error reporting and debugging information

## Setup

### 1. Environment Variables

Set your OpenAI API key:

```bash
export OPENAI_API_KEY=your_openai_api_key_here
```

### 2. Install Dependencies

The script uses the existing dependencies from your project:

```bash
npm install
```

## Usage

### Run Full Test Suite

Test GPT-5 nano with 8 predefined test cases:

```bash
npm run test-gpt5
```

### Custom Testing

Test with your own input:

```bash
npm run test-gpt5-custom "jarvis, my toaster is exploding"
```

Or run directly:

```bash
node gpt_nano.js "garmin, what's the weather?"
```

## Test Cases

The script includes these predefined test cases:

1. **"jarvis, my toaster is exploding"** - Absurd request testing
2. **"garmin, what's the weather?"** - Weather query
3. **"okay garmin, help me build a flying bathtub"** - Complex absurd request
4. **"jarvis, initiate my grandma's crane startup sequence"** - Specific absurd request from prompt
5. **"garmin, calculate the probability of success"** - Mathematical request
6. **"jarvis, run diagnostics on my coffee maker"** - Tech diagnostics
7. **"ok garmin, what's 2+2?"** - Simple math
8. **"jarvis, prepare the Mark 42 suit for deployment"** - Marvel universe reference

## Configuration

The script uses the same configuration as your Discord bot:

```javascript
const CONFIG = {
    maxTokens: 500,        // Maximum response length
    temperature: 0.6,      // Response creativity (0-1)
    maxInputLength: 250    // Maximum input length
};
```

## Output Example

```
🚀 Starting GPT-5 Nano Test Suite
==================================================

📋 Test Case 1/8
🧪 Testing GPT-5 Nano with input: "jarvis, my toaster is exploding"
📊 Model: gpt-5-nano
⚙️  Config: max_tokens=500, temperature=0.6
📝 System prompt length: 12345 characters

✅ Success! Response received in 1250ms
📤 Response: "Quite the explosive breakfast, sir. I recommend evacuating the kitchen and calling the fire department."
📊 Usage: {
  "prompt_tokens": 150,
  "completion_tokens": 25,
  "total_tokens": 175
}

==================================================
📊 TEST SUMMARY
==================================================
✅ Successful: 8/8
❌ Failed: 0/8
⏱️  Average Latency: 1200ms
```

## API Documentation

### GPT-5 Nano Model

- **Model Name**: `gpt-5-nano`
- **Provider**: OpenAI
- **Endpoint**: `https://api.openai.com/v1/chat/completions`
- **Authentication**: Bearer token via `OPENAI_API_KEY`

### Request Format

```json
{
  "model": "gpt-5-nano",
  "messages": [
    {
      "role": "system",
      "content": "SYSTEM: You are J.A.R.V.I.S., Tony Stark's elite AI assistant..."
    },
    {
      "role": "user", 
      "content": "jarvis, my toaster is exploding"
    }
  ],
  "max_tokens": 500,
  "temperature": 0.6
}
```

### Response Format

```json
{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "created": 1234567890,
  "model": "gpt-5-nano",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Quite the explosive breakfast, sir. I recommend evacuating the kitchen and calling the fire department."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 150,
    "completion_tokens": 25,
    "total_tokens": 175
  }
}
```

## Error Handling

The script handles various error scenarios:

- **Missing API Key**: Clear error message with setup instructions
- **API Errors**: Detailed error reporting with status codes
- **Rate Limiting**: Automatic retry logic (if implemented)
- **Invalid Responses**: Validation of response content

## Performance Metrics

The script tracks:

- **Latency**: Response time in milliseconds
- **Token Usage**: Prompt, completion, and total tokens
- **Success Rate**: Percentage of successful requests
- **Error Details**: Specific error messages and codes

## Integration with Discord Bot

This script uses the exact same:

- **System Prompt**: Complete Jarvis personality from `jarvis-core.js`
- **Configuration**: Same settings as your Discord bot
- **Response Format**: Identical to what users see in Discord

## Troubleshooting

### Common Issues

1. **"OPENAI_API_KEY environment variable not set"**
   - Set your API key: `export OPENAI_API_KEY=your_key`

2. **"Model not found" errors**
   - Verify GPT-5 nano is available in your OpenAI account
   - Check if you have access to the model

3. **Rate limiting errors**
   - Add delays between requests
   - Check your OpenAI usage limits

4. **Invalid response format**
   - Check if the model is returning expected JSON structure
   - Verify API endpoint is correct

### Debug Mode

For detailed debugging, you can modify the script to log raw API responses:

```javascript
console.log("Raw API Response:", JSON.stringify(response, null, 2));
```

## Notes

- The script maintains conversation history for analysis
- All test cases are designed to test different aspects of Jarvis's personality
- The system prompt is identical to your Discord bot for consistency
- Performance metrics help optimize response times and costs
