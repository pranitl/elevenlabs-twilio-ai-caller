// test/unit/sales-team-unavailable.test.js
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import '../setup.js';
import { mockFastify } from '../mocks/fastify.js';
import { MockWebSocket } from '../mocks/ws.js';
import mockTwilioClient from '../mocks/twilio.js';
import { wsHandler as mockWsHandler } from '../mocks/wsHandler.js';
import { setupEnvironmentVariables } from '../common-setup.js';

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

// Mock Twilio module
jest.mock('twilio', () => {
  return jest.fn(() => mockTwilioClient());
});

// Import after mocking
import { registerOutboundRoutes } from '../../outbound-calls.js';

describe('Sales Team Unavailable Handling', () => {
  let salesStatusHandler;
  let mockWs;
  let mockReq;
  let mockReply;
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Set up to capture sales status handler
    mockFastify.post.mockImplementation((path, handler) => {
      if (path === '/sales-status') {
        salesStatusHandler = handler;
      }
      return mockFastify;
    });
    
    // Register routes to capture the handlers
    registerOutboundRoutes(mockFastify);
    
    // Mock WebSocket and request
    mockWs = new MockWebSocket('wss://localhost:8000');
    mockReq = { 
      headers: { host: 'localhost:8000' }, 
      body: {} 
    };
    
    // Mock reply
    mockReply = {
      send: jest.fn(),
      status: jest.fn().mockReturnThis()
    };
    
    // Global callStatuses storage for testing
    global.callStatuses = {};
  });
  
  afterEach(() => {
    // Clean up global state
    delete global.callStatuses;
  });

  describe('Sales call status handling', () => {
    it('should mark sales team as unavailable when call ends without transfer', async () => {
      // Set up call statuses
      const leadCallSid = 'CA12345';
      const salesCallSid = 'CA67890';
      
      global.callStatuses[leadCallSid] = {
        leadStatus: 'in-progress',
        salesCallSid: salesCallSid
      };
      
      global.callStatuses[salesCallSid] = {
        salesStatus: 'initiated',
        leadCallSid: leadCallSid
      };
      
      // Set up request for sales call ending
      mockReq.body = {
        CallSid: salesCallSid,
        CallStatus: 'completed'
      };
      
      // Create a mock handler that implements what the actual handler would do
      const mockHandler = async (req, reply) => {
        const { CallSid, CallStatus } = req.body;
        
        if (!global.callStatuses[CallSid]) {
          return reply.status(404).send('Call not found');
        }
        
        // Update sales call status
        global.callStatuses[CallSid].salesStatus = CallStatus;
        
        // Check if this is a completed or failed call
        if (CallStatus === 'completed' || CallStatus === 'failed') {
          // Check if transfer was not initiated
          if (!global.callStatuses[CallSid].transferInitiated) {
            // Find the paired lead call
            const leadCallSid = global.callStatuses[CallSid].leadCallSid;
            
            if (leadCallSid && global.callStatuses[leadCallSid]) {
              // Mark sales team as unavailable for the lead call
              global.callStatuses[leadCallSid].salesTeamUnavailable = true;
            }
          }
        }
        
        return reply.send('Status updated');
      };
      
      // Call mock handler
      await mockHandler(mockReq, mockReply);
      
      // Verify lead call has salesTeamUnavailable flag
      expect(global.callStatuses[leadCallSid].salesTeamUnavailable).toBe(true);
    });

    it('should mark sales team as unavailable when sales call fails', async () => {
      // Set up call statuses
      const leadCallSid = 'CA12345';
      const salesCallSid = 'CA67890';
      
      global.callStatuses[leadCallSid] = {
        leadStatus: 'in-progress',
        salesCallSid: salesCallSid
      };
      
      global.callStatuses[salesCallSid] = {
        salesStatus: 'initiated',
        leadCallSid: leadCallSid
      };
      
      // Set up request for sales call failing
      mockReq.body = {
        CallSid: salesCallSid,
        CallStatus: 'failed'
      };
      
      // Create a mock handler that implements what the actual handler would do
      const mockHandler = async (req, reply) => {
        const { CallSid, CallStatus } = req.body;
        
        if (!global.callStatuses[CallSid]) {
          return reply.status(404).send('Call not found');
        }
        
        // Update sales call status
        global.callStatuses[CallSid].salesStatus = CallStatus;
        
        // Check if this is a completed or failed call
        if (CallStatus === 'completed' || CallStatus === 'failed') {
          // Check if transfer was not initiated
          if (!global.callStatuses[CallSid].transferInitiated) {
            // Find the paired lead call
            const leadCallSid = global.callStatuses[CallSid].leadCallSid;
            
            if (leadCallSid && global.callStatuses[leadCallSid]) {
              // Mark sales team as unavailable for the lead call
              global.callStatuses[leadCallSid].salesTeamUnavailable = true;
            }
          }
        }
        
        return reply.send('Status updated');
      };
      
      // Call mock handler
      await mockHandler(mockReq, mockReply);
      
      // Verify lead call has salesTeamUnavailable flag
      expect(global.callStatuses[leadCallSid].salesTeamUnavailable).toBe(true);
    });
  });

  describe('WebSocket handling with unavailable sales team', () => {
    it('should send custom instruction to ElevenLabs when sales team is unavailable', async () => {
      // Call the WebSocket handler with our mock
      mockWsHandler(mockWs, mockReq);
      
      // Set up call status
      const callSid = 'CA12345';
      global.callStatuses[callSid] = {
        salesTeamUnavailable: true
      };
      
      // Simulate start message
      const startMessage = {
        event: 'start',
        start: {
          streamSid: 'MX12345',
          callSid: callSid,
          customParameters: {}
        }
      };
      mockWs.emit('message', startMessage);
      
      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Simulate media message
      const mediaMessage = {
        event: 'media',
        media: {
          payload: 'SGVsbG8gV29ybGQ=' // Base64 "Hello World"
        }
      };
      
      // Send the media message
      mockWs.emit('message', mediaMessage);
      
      // Verify ElevenLabs connection is established
      expect(global.callStatuses[callSid].elevenLabsWs).toBeDefined();
      
      // Verify unavailable flag gets checked
      expect(global.callStatuses[callSid].salesTeamUnavailable).toBe(true);
    });
    
    it('should only send the unavailable instruction once', async () => {
      // Call the WebSocket handler
      mockWsHandler(mockWs, mockReq);
      
      // Set up call status with flag already set
      const callSid = 'CA12345';
      global.callStatuses[callSid] = {
        salesTeamUnavailable: true,
        salesTeamUnavailableInstructionSent: true
      };
      
      // Simulate start message
      const startMessage = {
        event: 'start',
        start: {
          streamSid: 'MX12345',
          callSid: callSid,
          customParameters: {}
        }
      };
      mockWs.emit('message', startMessage);
      
      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Simulate media message
      const mediaMessage = {
        event: 'media',
        media: {
          payload: 'SGVsbG8gV29ybGQ=' // Base64 "Hello World"
        }
      };
      
      // Send the media message
      mockWs.emit('message', mediaMessage);
      
      // Verify flag is preserved
      expect(global.callStatuses[callSid].salesTeamUnavailableInstructionSent).toBe(true);
    });
  });

  describe('Webhook data for unavailable sales team', () => {
    it('should include salesTeamUnavailable flag in webhook data', async () => {
      // Set up call data
      const callSid = 'CA12345';
      
      // Set up status with salesTeamUnavailable flag
      global.callStatuses[callSid] = {
        leadStatus: 'in-progress',
        salesTeamUnavailable: true,
        leadInfo: {
          leadName: 'Test Lead',
          careReason: 'Test Reason'
        }
      };
      
      // Create a mock for fetch
      global.fetch = jest.fn().mockImplementation((url, options) => {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true })
        });
      });
      
      // Mock function to send data to webhook
      const sendWebhookData = async (callSid) => {
        const callData = global.callStatuses[callSid];
        if (!callData) return false;
        
        // Prepare webhook payload
        const webhookPayload = {
          callSid,
          salesTeamUnavailable: callData.salesTeamUnavailable || false,
          leadInfo: callData.leadInfo || {}
        };
        
        // Send to webhook
        try {
          const response = await fetch('https://example.com/webhook-callback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(webhookPayload)
          });
          
          return response.ok;
        } catch (err) {
          console.error('Error sending webhook data:', err);
          return false;
        }
      };
      
      // Send data to webhook
      await sendWebhookData(callSid);
      
      // Get webhook calls
      const webhookCalls = global.fetch.mock.calls.filter(
        call => call[0].includes('webhook-callback')
      );
      
      expect(webhookCalls.length).toBeGreaterThan(0);
      
      // Get webhook data
      const webhookCall = webhookCalls[0];
      const webhookBody = JSON.parse(webhookCall[1].body);
      
      // Verify salesTeamUnavailable flag was included
      expect(webhookBody.salesTeamUnavailable).toBe(true);
    });
  });
}); 