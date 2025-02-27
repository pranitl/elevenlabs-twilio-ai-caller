# Common Outbound Webhook Implementation Guide

## Overview

This guide outlines the implementation of a common outbound webhook function for sending ElevenLabs Conversational AI transcripts and summaries to make.com. The webhook is triggered after any interaction with the ElevenLabs Conversational AI agent, allowing us to:

1. Capture conversation transcripts and summaries
2. Track scheduling preferences expressed by leads
3. Monitor agent performance and conversation quality
4. Improve lead follow-up processes

## Requirements

- Send webhook only when ElevenLabs AI was used (not when sales team handled the entire call)
- Capture full conversation transcripts and AI-generated summaries
- Include lead information and callback preferences
- Handle failures gracefully with retry mechanisms
- Support flexible integration with all ElevenLabs AI agent touchpoints

## Environment Variables

Add the following to your `.env` file:

```
# Webhook Configuration
MAKE_WEBHOOK_URL=https://hook.us2.make.com/your-endpoint-here
```

## Implementation Approach

### 1. Create Common Webhook Function Module

Create a new file `outbound-webhook.js` in the `forTheLegends/outbound` directory with the following structure:

```javascript
// outbound-webhook.js
// Common outbound webhook functionality for ElevenLabs conversations

import axios from 'axios';
import {
  enhanceWebhookPayload,
  sendEnhancedWebhook
} from './webhook-enhancer.js';

// Configuration
const DEFAULT_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL || 'https://hook.us2.make.com/your-endpoint-here';
let webhookConfig = {
  url: DEFAULT_WEBHOOK_URL,
  retryAttempts: 3,
  retryDelayMs: 1000,
  timeoutMs: 10000,
  enabled: true
};

/**
 * Send ElevenLabs conversation data to webhook
 * This is the main function that should be called by all modules
 * 
 * @param {string} callSid - Twilio call SID
 * @param {string} conversationId - ElevenLabs conversation ID
 * @param {Object} callStatuses - Object containing call status information
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} - Webhook response
 */
async function sendElevenLabsConversationData(callSid, conversationId, callStatuses, options = {}) {
  if (!webhookConfig.enabled) {
    console.log(`[Webhook] Webhooks are disabled. Not sending data for call ${callSid}`);
    return { success: false, reason: 'webhooks_disabled' };
  }

  try {
    console.log(`[Webhook] Preparing to send data for call ${callSid} with conversation ${conversationId}`);
    
    // Check if webhook should be sent
    if (!shouldSendWebhook(callSid, callStatuses)) {
      console.log(`[Webhook] No need to send data for call ${callSid} - criteria not met`);
      return { success: false, reason: 'criteria_not_met' };
    }
    
    // Get conversation data from ElevenLabs
    const { transcriptData, summaryData } = await fetchElevenLabsData(conversationId);
    
    // Prepare webhook payload
    const webhookPayload = prepareWebhookPayload(
      callSid, 
      conversationId, 
      callStatuses[callSid], 
      transcriptData, 
      summaryData,
      options
    );
    
    // Send to webhook with retries
    return await sendWebhookWithRetry(webhookPayload);
  } catch (error) {
    console.error(`[Webhook] Error sending webhook for call ${callSid}:`, error);
    return { 
      success: false, 
      error: error.message,
      callSid,
      conversationId,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Determine if webhook should be sent based on call status
 * 
 * @param {string} callSid - Twilio call SID
 * @param {Object} callStatuses - Object containing call status information
 * @returns {boolean} - Whether webhook should be sent
 */
function shouldSendWebhook(callSid, callStatuses) {
  if (!callSid || !callStatuses || !callStatuses[callSid]) {
    return false;
  }
  
  const callStatus = callStatuses[callSid];
  
  // Only send webhook if:
  // 1. This was a call where sales team was unavailable, OR
  // 2. This was a voicemail, OR
  // 3. The call used ElevenLabs and wasn't fully handled by sales team
  if (
    callStatus.salesTeamUnavailable || 
    callStatus.isVoicemail ||
    // Check if ElevenLabs was used and the call wasn't transferred/handled by sales team
    (callStatus.conversationId && !callStatus.transferComplete)
  ) {
    return true;
  }
  
  return false;
}

/**
 * Fetch conversation data from ElevenLabs API
 * 
 * @param {string} conversationId - ElevenLabs conversation ID
 * @returns {Promise<Object>} - Transcript and summary data
 */
async function fetchElevenLabsData(conversationId) {
  const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
  
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY is required but not configured');
  }
  
  let transcriptData = null;
  let summaryData = null;
  
  // Fetch transcript
  try {
    console.log(`[ElevenLabs] Fetching transcript for conversation ${conversationId}`);
    const transcriptResponse = await axios.get(
      `https://api.elevenlabs.io/v1/convai/conversation/${conversationId}/transcript`,
      {
        headers: { "xi-api-key": ELEVENLABS_API_KEY },
        timeout: webhookConfig.timeoutMs
      }
    );
    
    transcriptData = transcriptResponse.data;
    console.log(`[ElevenLabs] Successfully fetched transcript for conversation ${conversationId}`);
  } catch (error) {
    console.error(`[ElevenLabs] Error fetching transcript: ${error.message}`);
    // Continue execution even if transcript fetch fails
  }
  
  // Fetch summary
  try {
    console.log(`[ElevenLabs] Fetching summary for conversation ${conversationId}`);
    const summaryResponse = await axios.get(
      `https://api.elevenlabs.io/v1/convai/conversation/${conversationId}/summary`,
      {
        headers: { "xi-api-key": ELEVENLABS_API_KEY },
        timeout: webhookConfig.timeoutMs
      }
    );
    
    summaryData = summaryResponse.data;
    console.log(`[ElevenLabs] Successfully fetched summary for conversation ${conversationId}`);
  } catch (error) {
    console.error(`[ElevenLabs] Error fetching summary: ${error.message}`);
    // Continue execution even if summary fetch fails
  }
  
  return { transcriptData, summaryData };
}

/**
 * Prepare webhook payload
 * 
 * @param {string} callSid - Twilio call SID
 * @param {string} conversationId - ElevenLabs conversation ID
 * @param {Object} callStatus - Call status information
 * @param {Object} transcriptData - Transcript data from ElevenLabs
 * @param {Object} summaryData - Summary data from ElevenLabs
 * @param {Object} options - Additional options
 * @returns {Object} - Webhook payload
 */
function prepareWebhookPayload(callSid, conversationId, callStatus, transcriptData, summaryData, options = {}) {
  // Build basic payload
  const payload = {
    call_sid: callSid,
    conversation_id: conversationId,
    is_voicemail: callStatus?.isVoicemail || false,
    sales_team_unavailable: callStatus?.salesTeamUnavailable || false,
    lead_info: callStatus?.leadInfo || {},
    timestamp: new Date().toISOString(),
    source_module: options.sourceModule || 'outbound-webhook',
    call_metadata: {
      transferInitiated: callStatus?.transferInitiated || false,
      transferComplete: callStatus?.transferComplete || false,
      callbackScheduled: callStatus?.callbackScheduled || false,
      answeredBy: callStatus?.answeredBy || 'unknown'
    }
  };
  
  // Add transcript data if available
  if (transcriptData) {
    payload.transcript = transcriptData;
  } else if (callStatus?.transcripts && callStatus.transcripts.length > 0) {
    // Use stored transcripts if ElevenLabs API call failed
    payload.transcript = {
      conversation_id: conversationId,
      transcripts: callStatus.transcripts
    };
  }
  
  // Add summary data if available
  if (summaryData) {
    payload.summary = summaryData;
    
    // Include success criteria and data collection if present in the summary
    if (summaryData.success_criteria) {
      payload.success_criteria = summaryData.success_criteria;
    }
    
    if (summaryData.data_collection) {
      payload.data_collection = summaryData.data_collection;
    }
  }
  
  // Add callback preferences if they exist
  if (callStatus?.callbackPreferences) {
    payload.callbackPreferences = callStatus.callbackPreferences;
  }
  
  // Use webhook enhancer if lead ID is available
  const leadId = callStatus?.leadInfo?.LeadId || callStatus?.leadId || options.leadId;
  if (leadId) {
    try {
      // Enhance payload with additional data from other modules
      return enhanceWebhookPayload(callSid, leadId, payload);
    } catch (error) {
      console.error(`[Webhook] Error enhancing payload: ${error.message}`);
      // Return basic payload if enhancement fails
      return payload;
    }
  }
  
  return payload;
}

/**
 * Send webhook with retry logic
 * 
 * @param {Object} payload - Webhook payload
 * @returns {Promise<Object>} - Webhook response
 */
async function sendWebhookWithRetry(payload) {
  let attempts = 0;
  let lastError = null;
  
  while (attempts < webhookConfig.retryAttempts) {
    attempts++;
    
    try {
      console.log(`[Webhook] Sending webhook attempt ${attempts}/${webhookConfig.retryAttempts}`);
      
      const response = await axios.post(webhookConfig.url, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: webhookConfig.timeoutMs
      });
      
      console.log(`[Webhook] Successfully sent webhook, status: ${response.status}`);
      
      return {
        success: true,
        status: response.status,
        timestamp: new Date().toISOString(),
        attempts
      };
    } catch (error) {
      lastError = error;
      console.error(`[Webhook] Attempt ${attempts} failed: ${error.message}`);
      
      if (attempts < webhookConfig.retryAttempts) {
        const delay = webhookConfig.retryDelayMs * attempts; // Exponential backoff
        console.log(`[Webhook] Retrying in ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  console.error(`[Webhook] All ${webhookConfig.retryAttempts} webhook attempts failed`);
  return {
    success: false,
    error: lastError?.message || 'Unknown error',
    timestamp: new Date().toISOString(),
    attempts
  };
}

/**
 * Configure webhook settings
 * 
 * @param {Object} config - Configuration object
 */
function configureWebhook(config = {}) {
  webhookConfig = {
    ...webhookConfig,
    ...config
  };
  
  console.log('[Webhook] Configuration updated:', webhookConfig);
}

// Export functions for use in other modules
export {
  sendElevenLabsConversationData,
  configureWebhook,
  shouldSendWebhook, // Exported for testing
  fetchElevenLabsData, // Exported for testing
  prepareWebhookPayload // Exported for testing
};
```

### 2. Update `index.js` to Export the Webhook Function

Update the `forTheLegends/outbound/index.js` file to export the new webhook functions:

```javascript
// Add import for outbound webhook
import {
  sendElevenLabsConversationData,
  configureWebhook
} from './outbound-webhook.js';

// Add these to the existing exports
export {
  // Other exports...
  
  // Outbound webhook
  sendElevenLabsConversationData,
  configureWebhook
};
```

## Critical Integration Points

The most important part of this implementation is ensuring that our webhook is triggered at the right moments. Here are the key integration points:

### 1. Integration with `outbound-calls.js`

In the `outbound-calls.js` file, identify where ElevenLabs WebSocket closes and replace the existing webhook call with our new common function:

```javascript
// Find the websocket close event handler
elevenLabsWs.on("close", () => {
  console.log("[ElevenLabs] Disconnected");
  
  // When WebSocket closes, send data to webhook
  if (callSid && conversationId) {
    // Replace this:
    // sendCallDataToWebhook(callSid, conversationId);
    
    // With this:
    import { sendElevenLabsConversationData } from './forTheLegends/outbound';
    sendElevenLabsConversationData(callSid, conversationId, callStatuses, { 
      sourceModule: 'outbound-calls' 
    });
  }
});
```

### 2. Integration with `setupStreamingWebSocket.js`

Add webhook functionality to the WebSocket close handler:

```javascript
// Find the websocket close event handler
ws.on("close", () => {
  console.log("[Twilio] Client disconnected");
  
  // Close ElevenLabs connection if open
  if (elevenLabsWs?.readyState === 1) {
    elevenLabsWs.close();
  }
  
  // Send webhook data if we have a conversation
  if (callSid && conversationId) {
    import { sendElevenLabsConversationData } from './forTheLegends/outbound';
    sendElevenLabsConversationData(callSid, conversationId, callStatuses, { 
      sourceModule: 'streaming-websocket' 
    });
  }
});
```

### 3. Ensuring proper execution context

Make sure the imports are at the top of the file, not inside the event handler:

```javascript
// Add at the top of the file
import { sendElevenLabsConversationData } from './forTheLegends/outbound';

// Then in the event handler
elevenLabsWs.on("close", () => {
  // ...
  if (callSid && conversationId) {
    sendElevenLabsConversationData(callSid, conversationId, callStatuses, { 
      sourceModule: 'outbound-calls' 
    });
  }
});
```

## Test-Driven Development Approach

Create test cases in a new file `test/unit/outbound-webhook.test.js`:

```javascript
import { jest } from '@jest/globals';
import axios from 'axios';

// Mock axios
jest.mock('axios');

// Import the webhook functions
import {
  sendElevenLabsConversationData,
  shouldSendWebhook,
  fetchElevenLabsData,
  prepareWebhookPayload
} from '../../forTheLegends/outbound/outbound-webhook.js';

describe('Outbound Webhook', () => {
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock process.env
    process.env.ELEVENLABS_API_KEY = 'test-api-key';
    process.env.MAKE_WEBHOOK_URL = 'https://test-webhook-url.com';
    
    // Mock axios responses
    axios.get.mockImplementation((url) => {
      if (url.includes('/transcript')) {
        return Promise.resolve({
          data: {
            conversation_id: 'test-conv-id',
            transcripts: [
              { speaker: 'agent', text: 'Hello, how can I help you?' },
              { speaker: 'user', text: 'I need assistance with my account.' }
            ]
          }
        });
      } else if (url.includes('/summary')) {
        return Promise.resolve({
          data: {
            conversation_id: 'test-conv-id',
            summary: 'This is a test summary',
            success_criteria: [
              { title: "handled_inquiry", result: true, confidence: 0.92 }
            ],
            data_collection: [
              { title: "call_type", value: "support_issue", confidence: 0.85 }
            ]
          }
        });
      }
      return Promise.reject(new Error('Unknown URL'));
    });
    
    axios.post.mockResolvedValue({ status: 200 });
    
    // Set up global call statuses
    global.callStatuses = {
      'test-call-sid': {
        conversationId: 'test-conv-id',
        salesTeamUnavailable: true,
        leadInfo: { LeadId: 'test-lead-id', LeadName: 'Test Lead' },
        transcripts: [
          { speaker: 'ai', text: 'Hello, how can I help you?' },
          { speaker: 'user', text: 'I need assistance with my account.' }
        ]
      },
      'sales-handled-call': {
        conversationId: 'sales-conv-id',
        salesTeamUnavailable: false,
        transferComplete: true,
        leadInfo: { LeadId: 'sales-lead-id', LeadName: 'Sales Lead' }
      }
    };
  });
  
  afterEach(() => {
    // Clean up
    delete global.callStatuses;
  });
  
  describe('shouldSendWebhook', () => {
    it('should return true for calls where sales team was unavailable', () => {
      const result = shouldSendWebhook('test-call-sid', global.callStatuses);
      expect(result).toBe(true);
    });
    
    it('should return false for calls fully handled by sales team', () => {
      const result = shouldSendWebhook('sales-handled-call', global.callStatuses);
      expect(result).toBe(false);
    });
    
    it('should return false for non-existent call SIDs', () => {
      const result = shouldSendWebhook('non-existent', global.callStatuses);
      expect(result).toBe(false);
    });
  });
  
  describe('fetchElevenLabsData', () => {
    it('should fetch transcript and summary data from ElevenLabs API', async () => {
      const result = await fetchElevenLabsData('test-conv-id');
      
      expect(axios.get).toHaveBeenCalledTimes(2);
      expect(result.transcriptData).toBeDefined();
      expect(result.summaryData).toBeDefined();
    });
    
    it('should handle transcript fetch failure gracefully', async () => {
      axios.get.mockImplementationOnce(() => Promise.reject(new Error('API error')));
      
      const result = await fetchElevenLabsData('test-conv-id');
      
      expect(result.transcriptData).toBeNull();
      expect(result.summaryData).toBeDefined();
    });
  });
  
  describe('prepareWebhookPayload', () => {
    it('should create a proper payload with all available data', () => {
      const callStatus = global.callStatuses['test-call-sid'];
      const transcriptData = {
        conversation_id: 'test-conv-id',
        transcripts: [
          { speaker: 'agent', text: 'Hello' },
          { speaker: 'user', text: 'Hi' }
        ]
      };
      const summaryData = {
        conversation_id: 'test-conv-id',
        summary: 'Test summary',
        success_criteria: [
          { title: "handled_inquiry", result: true, confidence: 0.92 }
        ],
        data_collection: [
          { title: "call_type", value: "support_issue", confidence: 0.85 }
        ]
      };
      
      const payload = prepareWebhookPayload(
        'test-call-sid',
        'test-conv-id',
        callStatus,
        transcriptData,
        summaryData
      );
      
      expect(payload.call_sid).toBe('test-call-sid');
      expect(payload.conversation_id).toBe('test-conv-id');
      expect(payload.transcript).toBeDefined();
      expect(payload.summary).toBeDefined();
      expect(payload.success_criteria).toBeDefined();
      expect(payload.data_collection).toBeDefined();
      expect(payload.lead_info).toBeDefined();
    });
    
    it('should use stored transcripts if ElevenLabs data is not available', () => {
      const callStatus = global.callStatuses['test-call-sid'];
      
      const payload = prepareWebhookPayload(
        'test-call-sid',
        'test-conv-id',
        callStatus,
        null,
        null
      );
      
      expect(payload.transcript).toBeDefined();
      expect(payload.transcript.transcripts).toEqual(callStatus.transcripts);
    });
  });
  
  describe('sendElevenLabsConversationData', () => {
    it('should send data for eligible calls', async () => {
      const result = await sendElevenLabsConversationData(
        'test-call-sid',
        'test-conv-id',
        global.callStatuses
      );
      
      expect(result.success).toBe(true);
      expect(axios.post).toHaveBeenCalledTimes(1);
    });
    
    it('should not send data for ineligible calls', async () => {
      const result = await sendElevenLabsConversationData(
        'sales-handled-call',
        'sales-conv-id',
        global.callStatuses
      );
      
      expect(result.success).toBe(false);
      expect(result.reason).toBe('criteria_not_met');
      expect(axios.post).not.toHaveBeenCalled();
    });
    
    it('should handle API errors gracefully', async () => {
      axios.get.mockImplementation(() => Promise.reject(new Error('API error')));
      axios.post.mockImplementation(() => Promise.reject(new Error('Webhook error')));
      
      const result = await sendElevenLabsConversationData(
        'test-call-sid',
        'test-conv-id',
        global.callStatuses
      );
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
  
  // Integration test to ensure webhook is called when expected
  describe('Integration with WebSocket closure', () => {
    it('should be called when ElevenLabs WebSocket closes', () => {
      // This is a scaffold for an integration test
      // In a real implementation, you would:
      // 1. Mock the WebSocket
      // 2. Trigger the close event
      // 3. Verify sendElevenLabsConversationData was called with correct params
      
      // Example (pseudocode):
      // const mockWebSocket = createMockWebSocket();
      // simulateWebSocketClose(mockWebSocket);
      // expect(sendElevenLabsConversationData).toHaveBeenCalledWith(
      //   expect.any(String),
      //   expect.any(String),
      //   expect.any(Object),
      //   expect.objectContaining({ sourceModule: 'outbound-calls' })
      // );
    });
  });
});
```

## Manual Testing Procedure

After implementing the feature, follow these steps to manually test it:

1. Set up the webhook URL in your `.env` file
2. Make a test call that reaches the ElevenLabs AI
3. Monitor the server logs for webhook-related messages
4. Verify in make.com that the webhook was received with the expected data
5. Test the error case by temporarily setting an invalid webhook URL
6. Verify that retries occur as expected

## Implementation Plan

1. Create the `outbound-webhook.js` module with the basic functionality
2. Write unit tests first (TDD approach)
3. Update `index.js` to export the functions
4. Integrate with the existing WebSocket close handlers
5. Test in development environment
6. Deploy and monitor real-world usage

## Example Webhook Payload

Here's an example of what make.com can expect to receive:

```json
{
  "call_sid": "CA1234567890abcdef",
  "conversation_id": "elevenlabs-conv-id",
  "is_voicemail": false,
  "sales_team_unavailable": true,
  "lead_info": {
    "LeadId": "lead-123",
    "LeadName": "John Smith",
    "Email": "john@example.com"
  },
  "timestamp": "2023-07-15T13:45:23.123Z",
  "source_module": "outbound-calls",
  "call_metadata": {
    "transferInitiated": false,
    "transferComplete": false,
    "callbackScheduled": true,
    "answeredBy": "human"
  },
  "transcript": {
    "conversation_id": "elevenlabs-conv-id",
    "transcripts": [
      {
        "speaker": "agent",
        "text": "Hello, how can I help you today?"
      },
      {
        "speaker": "user",
        "text": "I'm interested in your services but can't talk right now."
      },
      {
        "speaker": "agent",
        "text": "No problem, when would be a good time to call you back?"
      },
      {
        "speaker": "user",
        "text": "Maybe Monday afternoon around 2pm?"
      }
    ]
  },
  "summary": {
    "conversation_id": "elevenlabs-conv-id",
    "summary": "The lead expressed interest but requested a callback on Monday at 2pm."
  },
  "success_criteria": [
    {
      "title": "handled_inquiry",
      "result": true,
      "confidence": 0.92
    }
  ],
  "data_collection": [
    {
      "title": "call_type",
      "value": "callback_request",
      "confidence": 0.89
    }
  ],
  "callbackPreferences": [
    {
      "hasTimeReference": true,
      "detectedDays": ["monday"],
      "detectedTimes": ["2pm"],
      "detectedPeriods": ["afternoon"],
      "fromIntent": true,
      "salesUnavailable": true,
      "detectedAt": "2023-07-15T13:45:23.123Z"
    }
  ]
}
```
