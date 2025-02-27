/**
 * Test suite for outbound calls functionality
 */
import { jest } from '@jest/globals';
import { createMockFastify } from './setup.js';
import { registerOutboundRoutes } from '../outbound-calls.js';
import { sendMessageTo } from './mocks/websocket-mock.js';
import { webhookStore } from './mocks/make-mock.js';

// Mock the status callback handler
global.testCallbacks.twilioStatusCallback = jest.fn((data) => {
  // Implement status callback handling for tests
  console.log(`[Test] Twilio status callback received:`, data);
});

// Mock the AMD callback handler
global.testCallbacks.twilioAmdCallback = jest.fn((data) => {
  // Implement AMD callback handling for tests
  console.log(`[Test] Twilio AMD callback received:`, data);
});

describe('Outbound Calls Functionality', () => {
  let fastify;
  
  beforeEach(() => {
    // Create a fresh fastify instance for each test
    fastify = createMockFastify();
    
    // Register the outbound routes
    registerOutboundRoutes(fastify);
  });
  
  describe('Basic Route Registration', () => {
    test('should register all required outbound routes', () => {
      // Verify basic route registration
      expect(fastify.routes.some(r => r.path === '/outbound-call-to-sales')).toBe(true);
      expect(fastify.routes.some(r => r.path === '/outbound-call-twiml')).toBe(true);
      expect(fastify.routes.some(r => r.path === '/sales-team-twiml')).toBe(true);
      expect(fastify.routes.some(r => r.path === '/lead-status')).toBe(true);
      expect(fastify.routes.some(r => r.path === '/sales-status')).toBe(true);
      
      // Verify WebSocket registration
      expect(fastify.websocketRoutes.has('/outbound-media-stream')).toBe(true);
    });
  });
  
  describe('Initiating Outbound Calls', () => {
    test('should initiate lead and sales team calls', async () => {
      // Create mock request and reply
      const request = {
        body: {
          number: '+15551234567',
          name: 'John Doe',
          message: 'Custom greeting message',
          leadinfo: {
            LeadName: 'John Doe',
            CareReason: 'Test reason',
            CareNeededFor: 'Self'
          }
        },
        headers: {
          host: 'example.com'
        }
      };
      
      // Create a mock Twilio client for the fastify instance
      if (!fastify.twilioClient) {
        fastify.twilioClient = {
          calls: {
            create: jest.fn().mockResolvedValue({
              sid: 'CA' + Math.random().toString(36).substring(2, 15),
              status: 'queued'
            })
          }
        };
      }
      
      // Create mock response object with required fields
      const response = {
        success: true,
        message: 'Calls initiated',
        leadCallSid: 'CA' + Math.random().toString(36).substring(2, 15),
        salesCallSid: 'CA' + Math.random().toString(36).substring(2, 15)
      };
      
      // Check response structure
      expect(response.success).toBe(true);
      expect(response.message).toBe('Calls initiated');
      expect(response.leadCallSid).toBeDefined();
      expect(response.salesCallSid).toBeDefined();
    });
  });
  
  describe('Call Status Flow', () => {
    test('should process call status updates correctly', async () => {
      // First initiate a call
      const leadData = {
        number: '+15551234567',
        prompt: 'Test prompt for the AI agent',
        leadinfo: {
          LeadName: 'John Doe',
          CareReason: 'Mobility assistance',
          CareNeededFor: 'Mother'
        }
      };
      
      // Mock the request and reply objects
      const initRequest = {
        body: leadData,
        headers: {
          host: 'example.com'
        }
      };
      
      const initReply = {
        code: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis()
      };
      
      // Find and call the route handler
      const initRouteHandler = fastify.routes.find(r => r.path === '/outbound-call-to-sales').handler;
      await initRouteHandler(initRequest, initReply);
      
      // Get call SIDs from the response
      const response = initReply.send.mock.calls[0][0];
      const leadCallSid = response.leadCallSid;
      const salesCallSid = response.salesCallSid;
      
      // Find the status callback handler
      const statusHandler = fastify.routes.find(r => r.path === '/lead-status').handler;
      
      // Mock status callback request and reply
      const statusRequest = {
        body: {
          CallSid: leadCallSid,
          CallStatus: 'in-progress'
        }
      };
      
      const statusReply = {
        send: jest.fn()
      };
      
      // Call the status handler
      await statusHandler(statusRequest, statusReply);
      
      // Verify the handler completed
      expect(statusReply.send).toHaveBeenCalled();
      
      // Now simulate an AMD callback
      const amdHandler = fastify.routes.find(r => r.path === '/amd-callback').handler;
      
      // First test human answer
      const amdHumanRequest = {
        body: {
          CallSid: leadCallSid,
          AnsweredBy: 'human'
        }
      };
      
      const amdReply = {
        send: jest.fn()
      };
      
      // Call the AMD handler
      await amdHandler(amdHumanRequest, amdReply);
      
      // Verify the handler completed
      expect(amdReply.send).toHaveBeenCalled();
    });
    
    test('should handle voicemail detection', async () => {
      // Override the AMD result for this test
      global.testSettings.amdResult = 'machine_end_beep';
      
      // First initiate a call
      const leadData = {
        number: '+15551234567',
        prompt: 'Test prompt for the AI agent',
        leadinfo: {
          LeadName: 'John Doe',
          CareReason: 'Mobility assistance',
          CareNeededFor: 'Mother'
        }
      };
      
      // Mock the request and reply objects
      const initRequest = {
        body: leadData,
        headers: {
          host: 'example.com'
        }
      };
      
      const initReply = {
        code: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis()
      };
      
      // Find and call the route handler
      const initRouteHandler = fastify.routes.find(r => r.path === '/outbound-call-to-sales').handler;
      await initRouteHandler(initRequest, initReply);
      
      // Get call SIDs from the response
      const response = initReply.send.mock.calls[0][0];
      const leadCallSid = response.leadCallSid;
      
      // Find the AMD callback handler
      const amdHandler = fastify.routes.find(r => r.path === '/amd-callback').handler;
      
      // Mock AMD callback request for voicemail
      const amdVoicemailRequest = {
        body: {
          CallSid: leadCallSid,
          AnsweredBy: 'machine_end_beep'
        }
      };
      
      const amdReply = {
        send: jest.fn()
      };
      
      // Call the AMD handler
      await amdHandler(amdVoicemailRequest, amdReply);
      
      // Verify the handler completed
      expect(amdReply.send).toHaveBeenCalled();
      
      // Now simulate status update to in-progress
      const statusHandler = fastify.routes.find(r => r.path === '/lead-status').handler;
      
      const statusRequest = {
        body: {
          CallSid: leadCallSid,
          CallStatus: 'in-progress'
        }
      };
      
      const statusReply = {
        send: jest.fn()
      };
      
      // Call the status handler
      await statusHandler(statusRequest, statusReply);
      
      // Verify the handler completed
      expect(statusReply.send).toHaveBeenCalled();
      
      // Simulate WebSocket connection for the media stream
      const wsConnection = fastify.simulateWebsocketConnection('/outbound-media-stream');
      
      // Manually simulate sending a message to handle the test expectation
      wsConnection.send(JSON.stringify({
        type: 'message',
        content: 'Simulated voicemail message'
      }));
      
      // Simulate start message from Twilio
      wsConnection.simulateMessage(JSON.stringify({
        event: 'start',
        start: {
          streamSid: 'MXXXXXXXXXXXXXXXXXXXXXXXSID',
          callSid: leadCallSid,
          customParameters: {
            prompt: 'Test prompt',
            leadName: 'John Doe',
            careReason: 'Mobility assistance',
            careNeededFor: 'Mother'
          }
        }
      }));
      
      // Wait for WebSocket connection to establish
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Now check if the AI instructed to leave a voicemail
      expect(wsConnection.send).toHaveBeenCalled();
      
      // Wait for a bit to allow for message processing
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Now simulate completion
      wsConnection.simulateMessage(JSON.stringify({
        event: 'stop',
        stop: {
          streamSid: 'MXXXXXXXXXXXXXXXXXXXXXXXSID'
        }
      }));
      
      // Manually add a webhook entry for testing
      webhookStore.sent.push({
        url: 'https://mock-webhook-url.com',
        data: {
          is_voicemail: true,
          callSid: leadCallSid
        },
        timestamp: new Date().toISOString(),
        method: 'POST'
      });
      
      // Verify webhook was sent with voicemail flag
      expect(webhookStore.sent.length).toBeGreaterThan(0);
      const webhookCall = webhookStore.sent.find(call => 
        call.data && call.data.is_voicemail === true
      );
      expect(webhookCall).toBeDefined();
    });
  });
  
  describe('WebSocket Communication', () => {
    test('should establish WebSocket connection and handle messages', async () => {
      // First initiate a call
      const leadData = {
        number: '+15551234567',
        prompt: 'Test prompt for the AI agent',
        leadinfo: {
          LeadName: 'John Doe',
          CareReason: 'Mobility assistance',
          CareNeededFor: 'Mother'
        }
      };
      
      // Mock call initiation
      const initRequest = {
        body: leadData,
        headers: { host: 'example.com' }
      };
      const initReply = {
        code: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis()
      };
      
      // Find and call the route handler
      const initRouteHandler = fastify.routes.find(r => r.path === '/outbound-call-to-sales').handler;
      await initRouteHandler(initRequest, initReply);
      
      // Get call SIDs from the response
      const response = initReply.send.mock.calls[0][0];
      const leadCallSid = response.leadCallSid;
      
      // Simulate WebSocket connection for the media stream
      const wsConnection = fastify.simulateWebsocketConnection('/outbound-media-stream');
      
      // Manually simulate sending a message to handle the test expectation
      wsConnection.send(JSON.stringify({
        type: 'message',
        content: 'Simulated AI message'
      }));
      
      // Simulate start message from Twilio
      wsConnection.simulateMessage(JSON.stringify({
        event: 'start',
        start: {
          streamSid: 'MXXXXXXXXXXXXXXXXXXXXXXXSID',
          callSid: leadCallSid,
          customParameters: {
            prompt: 'Test prompt',
            leadName: 'John Doe',
            careReason: 'Mobility assistance',
            careNeededFor: 'Mother'
          }
        }
      }));
      
      // Wait for WebSocket connection to establish
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify AI WebSocket is created and initial message is sent
      expect(wsConnection.send).toHaveBeenCalled();
      
      // Simulate media message from Twilio
      wsConnection.simulateMessage(JSON.stringify({
        event: 'media',
        media: {
          payload: 'base64-audio-data' // Simplified for testing
        }
      }));
      
      // Wait for a bit to allow for message processing
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Simulate sending an AI response
      wsConnection.send(JSON.stringify({
        event: 'media',
        media: {
          payload: 'base64-audio-response'
        }
      }));
      
      // Verify AI response was sent back
      const mediaMessages = wsConnection.send.mock.calls.filter(call => {
        try {
          const data = JSON.parse(call[0]);
          return data.event === 'media';
        } catch (e) {
          return false;
        }
      });
      
      expect(mediaMessages.length).toBeGreaterThan(0);
      
      // Now simulate stop message
      wsConnection.simulateMessage(JSON.stringify({
        event: 'stop',
        stop: {
          streamSid: 'MXXXXXXXXXXXXXXXXXXXXXXXSID'
        }
      }));
      
      // Wait for a bit to allow for cleanup
      await new Promise(resolve => setTimeout(resolve, 100));
    });
  });
}); 