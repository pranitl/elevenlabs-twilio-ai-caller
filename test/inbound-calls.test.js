/**
 * Test suite for inbound calls functionality
 */
import { jest } from '@jest/globals';
import { createMockFastify } from './setup.js';
import { registerInboundRoutes } from '../inbound-calls.js';

describe('Inbound Calls Functionality', () => {
  let fastify;
  
  beforeEach(() => {
    // Create a fresh fastify instance for each test
    fastify = createMockFastify();
    
    // Register the inbound routes
    registerInboundRoutes(fastify);
  });
  
  describe('Basic Route Registration', () => {
    test('should register all required inbound routes', () => {
      // Verify basic route registration
      expect(fastify.routes.some(r => r.path === '/incoming-call')).toBe(true);
      expect(fastify.routes.some(r => r.path === '/verify-caller')).toBe(true);
      expect(fastify.routes.some(r => r.path === '/incoming-call-eleven')).toBe(true);
      
      // Verify WebSocket registration
      expect(fastify.websocketRoutes.has('/inbound-ai-stream')).toBe(true);
    });
  });
  
  describe('Initial Call Handling', () => {
    test('should provide TwiML response for incoming calls', async () => {
      // Find the incoming call route handler
      const routeHandler = fastify.routes.find(r => r.path === '/incoming-call').handler;
      
      // Create mock request and reply
      const request = {
        body: {
          CallSid: 'CA123456789',
          From: '+15551234567',
          To: '+15559876543'
        }
      };
      
      const reply = {
        type: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis()
      };
      
      // Call the handler
      await routeHandler(request, reply);
      
      // Verify response
      expect(reply.type).toHaveBeenCalledWith('text/xml');
      expect(reply.send).toHaveBeenCalled();
      
      // Check that the TwiML response contains a Gather verb for caller verification
      const twimlResponse = reply.send.mock.calls[0][0];
      expect(twimlResponse).toContain('<Gather');
      expect(twimlResponse).toContain('action="/verify-caller"');
      expect(twimlResponse).toContain('numDigits="1"');
    });
  });
  
  describe('Caller Verification', () => {
    test('should forward to sales team when caller presses 1', async () => {
      // Find the verify caller route handler
      const routeHandler = fastify.routes.find(r => r.path === '/verify-caller').handler;
      
      // Create mock request and reply for pressing 1 (sales team)
      const request = {
        body: {
          CallSid: 'CA123456789',
          From: '+15551234567',
          Digits: '1'
        }
      };
      
      const reply = {
        type: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis()
      };
      
      // Call the handler
      await routeHandler(request, reply);
      
      // Verify response
      expect(reply.type).toHaveBeenCalledWith('text/xml');
      expect(reply.send).toHaveBeenCalled();
      
      // Check that the TwiML response contains a Dial verb for forwarding to sales team
      const twimlResponse = reply.send.mock.calls[0][0];
      expect(twimlResponse).toContain('<Dial');
      expect(twimlResponse).toContain(process.env.SALES_TEAM_PHONE_NUMBER);
    });
    
    test('should connect to AI assistant when caller presses 2', async () => {
      // Find the verify caller route handler
      const routeHandler = fastify.routes.find(r => r.path === '/verify-caller').handler;
      
      // Create mock request and reply for pressing 2 (leave message with AI)
      const request = {
        body: {
          CallSid: 'CA123456789',
          From: '+15551234567',
          Digits: '2'
        }
      };
      
      const reply = {
        type: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis()
      };
      
      // Call the handler
      await routeHandler(request, reply);
      
      // Verify response
      expect(reply.type).toHaveBeenCalledWith('text/xml');
      expect(reply.send).toHaveBeenCalled();
      
      // Check that the TwiML response contains a Connect verb for AI
      const twimlResponse = reply.send.mock.calls[0][0];
      expect(twimlResponse).toContain('<Connect>');
      expect(twimlResponse).toContain('<Stream url="wss://');
      expect(twimlResponse).toContain('/inbound-ai-stream');
    });
    
    test('should handle invalid digits', async () => {
      // Find the verify caller route handler
      const routeHandler = fastify.routes.find(r => r.path === '/verify-caller').handler;
      
      // Create mock request and reply for pressing an invalid digit
      const request = {
        body: {
          CallSid: 'CA123456789',
          From: '+15551234567',
          Digits: '3' // Invalid option
        }
      };
      
      const reply = {
        type: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis()
      };
      
      // Call the handler
      await routeHandler(request, reply);
      
      // Verify response
      expect(reply.type).toHaveBeenCalledWith('text/xml');
      expect(reply.send).toHaveBeenCalled();
      
      // Check that the TwiML response contains a hangup for invalid option
      const twimlResponse = reply.send.mock.calls[0][0];
      expect(twimlResponse).toContain('Invalid selection');
      expect(twimlResponse).toContain('<Hangup/>');
    });
  });
  
  describe('Legacy Endpoint', () => {
    test('should redirect from legacy endpoint to new verification flow', async () => {
      // Find the legacy route handler
      const routeHandler = fastify.routes.find(r => r.path === '/incoming-call-eleven').handler;
      
      // Create mock request and reply
      const request = {
        body: {
          CallSid: 'CA123456789',
          From: '+15551234567',
          To: '+15559876543'
        }
      };
      
      const reply = {
        type: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis()
      };
      
      // Call the handler
      await routeHandler(request, reply);
      
      // Verify response
      expect(reply.type).toHaveBeenCalledWith('text/xml');
      expect(reply.send).toHaveBeenCalled();
      
      // Check that the TwiML response contains a Redirect to the new endpoint
      const twimlResponse = reply.send.mock.calls[0][0];
      expect(twimlResponse).toContain('<Redirect>');
      expect(twimlResponse).toContain('/incoming-call');
    });
  });
  
  describe('WebSocket Communication', () => {
    test('should handle WebSocket connections for AI stream', async () => {
      // Simulate WebSocket connection for the AI stream
      const wsConnection = fastify.simulateWebsocketConnection('/inbound-ai-stream');
      
      // Simulate start message from Twilio
      wsConnection.simulateMessage(JSON.stringify({
        event: 'start',
        start: {
          callSid: 'CA123456789',
          streamSid: 'MX123456789'
        }
      }));
      
      // Verify connection is stored and setup correctly
      expect(wsConnection).toBeDefined();
      
      // Simulate message event
      wsConnection.simulateMessage(JSON.stringify({
        event: 'media',
        media: {
          payload: 'base64-audio-data' // Simplified for testing
        }
      }));
      
      // Simulate close event
      wsConnection.emit('close');
    });
  });
}); 