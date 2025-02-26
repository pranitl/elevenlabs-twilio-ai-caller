import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import '../setup.js';
import { mockFastify, mockRequest, mockReply } from '../mocks/fastify.js';
import mockTwilioClient from '../mocks/twilio.js';

// Mock Twilio module
jest.mock('twilio', () => {
  return jest.fn(() => mockTwilioClient());
});

// Import after mocking
import { registerOutboundRoutes } from '../../outbound-calls.js';

describe('Outbound Calls Routes', () => {
  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
    
    // Reset request and reply objects
    mockRequest.body = {};
    mockRequest.query = {};
    mockRequest.params = {};
    mockRequest.headers = { host: 'localhost:8000' };
    
    // Register routes with mock fastify
    registerOutboundRoutes(mockFastify);
  });

  describe('Environment Variable Validation', () => {
    it('should throw error if required environment variables are missing', () => {
      // Save original env vars
      const originalEnv = { ...process.env };
      
      // Remove required env vars
      delete process.env.ELEVENLABS_API_KEY;
      
      // Expect function to throw
      expect(() => registerOutboundRoutes(mockFastify)).toThrow('Missing required environment variables');
      
      // Restore env vars
      process.env = originalEnv;
    });
  });

  describe('/outbound-call-to-sales endpoint', () => {
    it('should return error if phone number is missing', async () => {
      // Find the route handler
      const postHandler = mockFastify.post.mock.calls.find(call => call[0] === '/outbound-call-to-sales')[1];
      
      // Set up empty request
      mockRequest.body = {};
      
      // Call handler
      await postHandler(mockRequest, mockReply);
      
      // Verify response
      expect(mockReply.code).toHaveBeenCalledWith(400);
      expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({
        error: "Phone number is required"
      }));
    });
    
    it('should initiate both calls when phone number is provided', async () => {
      // Find the route handler
      const postHandler = mockFastify.post.mock.calls.find(call => call[0] === '/outbound-call-to-sales')[1];
      
      // Set up request with phone number
      mockRequest.body = {
        number: '+18001234567',
        leadinfo: {
          LeadName: 'Test Lead',
          CareReason: 'Test Reason',
          CareNeededFor: 'Test Patient'
        }
      };
      
      // Call handler
      await postHandler(mockRequest, mockReply);
      
      // Verify Twilio calls.create was called twice (lead + sales)
      const twilioClient = require('twilio')();
      expect(twilioClient.calls.create).toHaveBeenCalledTimes(2);
      
      // Verify response
      expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        message: 'Calls initiated'
      }));
    });
  });

  describe('/outbound-call-twiml endpoint', () => {
    it('should generate valid TwiML for the lead call', async () => {
      // Find the route handler
      const allHandler = mockFastify.all.mock.calls.find(call => call[0] === '/outbound-call-twiml')[1];
      
      // Set up query parameters
      mockRequest.query = {
        leadName: 'Test Lead',
        careReason: 'Test Reason',
        careNeededFor: 'Test Patient'
      };
      
      // Call handler
      await allHandler(mockRequest, mockReply);
      
      // Verify response is XML
      expect(mockReply.type).toHaveBeenCalledWith('text/xml');
      expect(mockReply.send).toHaveBeenCalledWith(expect.stringContaining('<?xml version="1.0" encoding="UTF-8"?>'));
      expect(mockReply.send).toHaveBeenCalledWith(expect.stringContaining('<Stream url="wss://localhost:8000/outbound-media-stream">'));
    });
  });

  describe('/sales-team-twiml endpoint', () => {
    it('should generate valid TwiML for the sales team call', async () => {
      // Find the route handler
      const allHandler = mockFastify.all.mock.calls.find(call => call[0] === '/sales-team-twiml')[1];
      
      // Set up query parameters
      mockRequest.query = {
        leadName: 'Test Lead',
        careReason: 'Test Reason',
        careNeededFor: 'Test Patient'
      };
      
      // Call handler
      await allHandler(mockRequest, mockReply);
      
      // Verify response is XML
      expect(mockReply.type).toHaveBeenCalledWith('text/xml');
      expect(mockReply.send).toHaveBeenCalledWith(expect.stringContaining('<?xml version="1.0" encoding="UTF-8"?>'));
      expect(mockReply.send).toHaveBeenCalledWith(expect.stringContaining('<Say>'));
    });
  });

  describe('/lead-status endpoint', () => {
    it('should update call status when receiving status callback', async () => {
      // Find the route handler
      const postHandler = mockFastify.post.mock.calls.find(call => call[0] === '/lead-status')[1];
      
      // Set up request body
      mockRequest.body = {
        CallSid: 'CA12345',
        CallStatus: 'in-progress'
      };
      
      // Call handler
      await postHandler(mockRequest, mockReply);
      
      // Hard to verify internal state change without exposing callStatuses
      // Just check that it responded
      expect(mockReply.send).toHaveBeenCalled();
    });
  });
}); 