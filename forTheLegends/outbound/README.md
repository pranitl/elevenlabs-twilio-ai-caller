# Enhanced Outbound Call System

This directory contains modules for an enhanced AI-powered outbound calling system that handles various scenarios including call quality issues, interruptions, intent detection, and retry logic.

## Features

### 1. Enhanced Call Handler (`enhanced-call-handler.js`)
- Primary integration point for all enhanced outbound call features
- Manages routes for initiating, processing, and handling calls
- Integrates with ElevenLabs and Twilio for AI-powered conversations
- Coordinates real-time audio processing and transcription

### 2. Call Quality Monitoring (`call-quality-monitor.js`)
- Detects technical issues during calls (silence, low audio)
- Provides real-time instructions to the AI agent on how to handle quality issues
- Tracks quality metrics for post-call analysis
- Helps ensure optimal conversation experience

### 3. Interruption Handler (`interruption-handler.js`)
- Detects when the lead needs to pause or reschedule the conversation
- Recognizes phrases indicating interruptions or rescheduling needs
- Extracts time-related information for scheduling callbacks
- Provides instructions to the AI on how to respond appropriately

### 4. Intent Detector (`intent-detector.js`)
- Identifies key intents from lead's responses
- Recognizes patterns in speech that indicate various intents
- Categorizes intents by priority and provides relevant handling instructions
- Helps identify qualified leads and those needing follow-up

### 5. Retry Manager (`retry-manager.js`)
- Handles calls that go to voicemail, are unanswered, or have technical issues
- Implements configurable retry logic with appropriate delay
- Tracks retry attempts and reasons
- Ensures important leads aren't missed due to connection issues

### 6. Webhook Enhancer (`webhook-enhancer.js`)
- Enriches webhook payloads sent to external systems
- Aggregates data from all modules for comprehensive reporting
- Generates call summaries for human follow-up
- Ensures all relevant call information is captured for CRM integration

## How to Use

1. Initialize the system:
```javascript
import { initialize, registerEnhancedOutboundRoutes } from './forTheLegends/outbound';

// Initialize with custom configuration if needed
initialize({
  maxRetries: 2,
  retryDelayMs: 60000 // 1 minute
});

// Register routes with your Express app
registerEnhancedOutboundRoutes(app);
```

2. Make enhanced outbound calls by sending a POST request to `/enhanced-outbound-call` with the following payload:
```json
{
  "leadId": "unique-lead-id",
  "phoneNumber": "+1234567890",
  "leadInfo": {
    "name": "John Doe",
    "additional": "Any additional lead information",
    "customPrompt": "Optional custom prompt for the AI agent"
  }
}
```

3. The system will handle the call flow, including:
   - Call quality monitoring
   - Interruption detection
   - Intent recognition
   - Retry logic for unanswered calls
   - Webhook notifications with enhanced data

## Dependencies

- Twilio for call handling
- ElevenLabs for AI voice and conversation
- Express for API routes
- WebSocket for real-time audio processing

## Configuration

Various aspects of the system can be configured, including:
- Retry attempts and delay between retries
- Quality monitoring thresholds
- Intent detection patterns
- Webhook endpoints and payload structure

Refer to the individual module documentation for specific configuration options. 