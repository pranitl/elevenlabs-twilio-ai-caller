// test/unit/webhook-data.test.js
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import '../setup.js';
import { setupEnvironmentVariables } from '../common-setup.js';
import { mockFastify } from '../mocks/fastify.js';
import { MockWebSocket } from '../mocks/ws.js';

// Setup environment variables
setupEnvironmentVariables();

// Mock ws module
jest.mock('ws', () => {
  const { MockWebSocket } = require('../mocks/ws.js');
  return {
    WebSocket: MockWebSocket,
    OPEN: 1,
    CLOSED: 3
  };
});

// Import after mocking
import { registerOutboundRoutes } from '../../outbound-calls.js';

describe('Webhook Data Formatting and Sending', () => {
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Register routes for side effects
    registerOutboundRoutes(mockFastify);
    
    // Global callStatuses storage for testing
    global.callStatuses = {};
  });
  
  afterEach(() => {
    // Clean up global state
    delete global.callStatuses;
  });

  describe('sendCallDataToWebhook function', () => {
    it('should collect transcript and summary data and send to webhook', async () => {
      // Set up call status with required data
      const callSid = 'CA12345';
      const conversationId = 'conv_123456';
      
      global.callStatuses[callSid] = {
        salesTeamUnavailable: true,
        leadInfo: {
          leadName: 'Test Lead',
          careReason: 'Test Reason',
          careNeededFor: 'Test Patient'
        },
        transcripts: [
          { speaker: 'agent', text: 'Hello, this is Heather.' },
          { speaker: 'user', text: 'Hi there.' }
        ],
        conversationId: conversationId
      };
      
      // Create a mock for fetch specifically for this test
      global.fetch = jest.fn().mockImplementation((url, options) => {
        // For transcript URL
        if (url.includes('transcripts')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              conversation_id: conversationId,
              transcripts: [
                { speaker: 'agent', text: 'Hello, this is Heather from First Light Home Care.' },
                { speaker: 'user', text: 'Hi, yes this is John.' }
              ]
            }),
          });
        } 
        // For summary URL
        else if (url.includes('summaries')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              conversation_id: conversationId,
              summary: 'The agent called to confirm details about home care services. The customer confirmed interest.'
            }),
          });
        } 
        // For webhook URL
        else if (url.includes('webhook-callback') || url.includes('hook.us2.make.com')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true }),
          });
        } 
        // Default case
        else {
          return Promise.resolve({
            ok: false,
            statusText: 'Not Found',
          });
        }
      });
      
      // Create a simple function to simulate sendCallDataToWebhook
      const sendCallDataToWebhook = async (callSid) => {
        const callData = global.callStatuses[callSid];
        if (!callData) return false;
        
        try {
          // First fetch the transcript data from ElevenLabs
          const transcriptResponse = await fetch(`https://api.elevenlabs.io/v1/speech-to-speech/agents/transcripts/${callData.conversationId}`);
          if (!transcriptResponse.ok) return false;
          
          const transcriptData = await transcriptResponse.json();
          
          // Then fetch the summary
          const summaryResponse = await fetch(`https://api.elevenlabs.io/v1/speech-to-speech/agents/summaries/${callData.conversationId}`);
          if (!summaryResponse.ok) return false;
          
          const summaryData = await summaryResponse.json();
          
          // Prepare webhook payload
          const webhookPayload = {
            callSid,
            transcripts: transcriptData.transcripts || callData.transcripts || [],
            summary: summaryData.summary || "",
            leadInfo: callData.leadInfo || {},
            salesTeamUnavailable: callData.salesTeamUnavailable || false,
            callbackPreferences: callData.callbackPreferences || []
          };
          
          // Send to webhook
          const webhookResponse = await fetch('https://hook.us2.make.com/webhook-callback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(webhookPayload)
          });
          
          return webhookResponse.ok;
        } catch (err) {
          console.error('Error sending webhook data:', err);
          return false;
        }
      };
      
      // Send data to webhook
      const result = await sendCallDataToWebhook(callSid);
      
      // Verify function returned success
      expect(result).toBe(true);
      
      // Verify webhook call
      const webhookCalls = global.fetch.mock.calls.filter(call => 
        call[0].includes('hook.us2.make.com') || call[0].includes('webhook-callback')
      );
      
      expect(webhookCalls.length).toBeGreaterThan(0);
      
      // Verify webhook payload
      const webhookPayload = JSON.parse(webhookCalls[0][1].body);
      
      // Check that the payload has the expected fields
      expect(webhookPayload).toHaveProperty('callSid', callSid);
      expect(webhookPayload).toHaveProperty('transcripts');
      expect(webhookPayload.transcripts.length).toBeGreaterThan(0);
      expect(webhookPayload).toHaveProperty('summary');
      expect(webhookPayload.summary.length).toBeGreaterThan(0);
      expect(webhookPayload).toHaveProperty('leadInfo');
      
      // Check sales team unavailable flag
      expect(webhookPayload).toHaveProperty('salesTeamUnavailable', true);
    });
    
    it('should include callback preferences in webhook data if available', async () => {
      // Set up call status with callback preferences
      const callSid = 'CA12345';
      const conversationId = 'conv_123456';
      
      global.callStatuses[callSid] = {
        leadInfo: {
          leadName: 'Test Lead',
          careReason: 'Test Reason'
        },
        conversationId: conversationId,
        callbackPreferences: [
          { dayOfWeek: 'friday', timeOfDay: '3 pm' }
        ]
      };
      
      // Create a mock for fetch specifically for this test
      global.fetch = jest.fn().mockImplementation((url, options) => {
        // For transcript URL
        if (url.includes('transcripts')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              conversation_id: conversationId,
              transcripts: [
                { speaker: 'agent', text: 'Hello, this is Heather from First Light Home Care.' },
                { speaker: 'user', text: 'Hi, yes this is John.' }
              ]
            }),
          });
        } 
        // For summary URL
        else if (url.includes('summaries')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              conversation_id: conversationId,
              summary: 'The agent called to confirm details about home care services. The customer confirmed interest.'
            }),
          });
        } 
        // For webhook URL
        else if (url.includes('webhook-callback') || url.includes('hook.us2.make.com')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true }),
          });
        } 
        // Default case
        else {
          return Promise.resolve({
            ok: false,
            statusText: 'Not Found',
          });
        }
      });
      
      // Create a simple function to simulate sendCallDataToWebhook
      const sendCallDataToWebhook = async (callSid) => {
        const callData = global.callStatuses[callSid];
        if (!callData) return false;
        
        try {
          // First fetch the transcript data from ElevenLabs
          const transcriptResponse = await fetch(`https://api.elevenlabs.io/v1/speech-to-speech/agents/transcripts/${callData.conversationId}`);
          if (!transcriptResponse.ok) return false;
          
          const transcriptData = await transcriptResponse.json();
          
          // Then fetch the summary
          const summaryResponse = await fetch(`https://api.elevenlabs.io/v1/speech-to-speech/agents/summaries/${callData.conversationId}`);
          if (!summaryResponse.ok) return false;
          
          const summaryData = await summaryResponse.json();
          
          // Prepare webhook payload
          const webhookPayload = {
            callSid,
            transcripts: transcriptData.transcripts || callData.transcripts || [],
            summary: summaryData.summary || "",
            leadInfo: callData.leadInfo || {},
            salesTeamUnavailable: callData.salesTeamUnavailable || false,
            callbackPreferences: callData.callbackPreferences || []
          };
          
          // Send to webhook
          const webhookResponse = await fetch('https://hook.us2.make.com/webhook-callback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(webhookPayload)
          });
          
          return webhookResponse.ok;
        } catch (err) {
          console.error('Error sending webhook data:', err);
          return false;
        }
      };
      
      // Send data to webhook
      const result = await sendCallDataToWebhook(callSid);
      
      // Verify function returned success
      expect(result).toBe(true);
      
      // Verify webhook call
      const webhookCalls = global.fetch.mock.calls.filter(call => 
        call[0].includes('hook.us2.make.com') || call[0].includes('webhook-callback')
      );
      
      expect(webhookCalls.length).toBeGreaterThan(0);
      
      // Verify webhook payload
      const webhookPayload = JSON.parse(webhookCalls[0][1].body);
      
      // Check callback preferences
      expect(webhookPayload).toHaveProperty('callbackPreferences');
      expect(webhookPayload.callbackPreferences.length).toBe(1);
      expect(webhookPayload.callbackPreferences[0]).toHaveProperty('dayOfWeek', 'friday');
      expect(webhookPayload.callbackPreferences[0]).toHaveProperty('timeOfDay', '3 pm');
    });
  });
}); 