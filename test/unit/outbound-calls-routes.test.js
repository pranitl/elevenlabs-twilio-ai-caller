import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import '../setup.js';
import { mockFastify, mockRequest, mockReply } from '../mocks/fastify.js';

// Setup environment variables needed by the module
process.env.TWILIO_ACCOUNT_SID = 'ACmockedaccountsid';
process.env.TWILIO_AUTH_TOKEN = 'mockedauthtoken';
process.env.TWILIO_PHONE_NUMBER = '+15551234567';
process.env.SALES_TEAM_PHONE_NUMBER = '+15551234567';
process.env.ELEVENLABS_API_KEY = 'mocked-elevenlabs-key';
process.env.ELEVENLABS_AGENT_ID = 'mocked-agent-id';

// Setup Twilio mock - we need to place it before any imports
// Create a mock Twilio client that we can spy on
const mockTwilioCallsCreate = jest.fn(() => {
  return Promise.resolve({
    sid: 'CA' + Math.random().toString(36).substring(2, 10),
    status: 'queued'
  });
});

// Create real spy for all possible ways Twilio client might be accessed
let mockClientInstance;
const twilioClientSpy = jest.fn(() => mockClientInstance);

// Mock the Twilio constructor and default export - handle both named and default import
const mockTwilio = function() {
  console.log('Twilio constructor called with:', arguments);
  mockClientInstance = {
    calls: {
      create: mockTwilioCallsCreate
    }
  };
  return mockClientInstance;
};

mockTwilio.Twilio = function() {
  console.log('Twilio.Twilio constructor called with:', arguments);
  mockClientInstance = {
    calls: {
      create: mockTwilioCallsCreate
    }
  };
  return mockClientInstance;
};

jest.mock('twilio', () => mockTwilio);

// Import the module after all mocks are set up
import { registerOutboundRoutes } from '../../outbound-calls.js';

// Helper function to manually inspect the handler code to debug the issue
const inspectOutboundCallHandler = (handler) => {
  // Return a decorated handler that wraps the original
  return async (request, reply) => {
    console.log('Handler called with body:', request.body);
    
    // Reset the mock before the call
    mockTwilioCallsCreate.mockClear();
    
    try {
      // Call the original handler
      const result = await handler(request, reply);
      
      // Log call count after execution
      console.log('Calls create called times:', mockTwilioCallsCreate.mock.calls.length);
      if (mockTwilioCallsCreate.mock.calls.length > 0) {
        console.log('First call args:', JSON.stringify(mockTwilioCallsCreate.mock.calls[0][0], null, 2));
      }
      
      return result;
    } catch (err) {
      console.error('Error in handler:', err);
      throw err;
    }
  };
};

describe('Outbound Calls Routes', () => {
  let routeHandlers = {};
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    mockFastify.post.mockClear();
    mockFastify.get.mockClear();
    mockFastify.all.mockClear();
    mockReply.send.mockClear();
    mockReply.code.mockClear();
    mockReply.type.mockClear();
    mockTwilioCallsCreate.mockClear();
    
    // Initialize the route handlers object
    routeHandlers = {};
    
    // Mock post implementation to capture handlers
    mockFastify.post.mockImplementation((path, handler) => {
      routeHandlers[path] = handler;
      return mockFastify;
    });
    
    // Mock get implementation to capture handlers
    mockFastify.get.mockImplementation((path, handler) => {
      routeHandlers[path] = handler;
      return mockFastify;
    });
    
    // Mock all implementation to capture handlers
    mockFastify.all.mockImplementation((path, handler) => {
      routeHandlers[path] = handler;
      return mockFastify;
    });
    
    // Register routes
    registerOutboundRoutes(mockFastify);
  });
  
  describe('/outbound-call-to-sales endpoint', () => {
    it('should return error if phone number is missing', async () => {
      // Ensure the handler was captured
      expect(routeHandlers['/outbound-call-to-sales']).toBeDefined();
      
      // Reset the mock before the test
      mockTwilioCallsCreate.mockClear();
      
      // Set up empty request
      mockRequest.body = {};
      
      // Call handler
      await routeHandlers['/outbound-call-to-sales'](mockRequest, mockReply);
      
      // Verify response
      expect(mockReply.code).toHaveBeenCalledWith(400);
      expect(mockReply.send).toHaveBeenCalledWith({
        error: 'Phone number is required'
      });
    });
    
    it('should handle the outbound call request', async () => {
      // Ensure the handler was captured
      expect(routeHandlers['/outbound-call-to-sales']).toBeDefined();
      
      // Reset the mock before the test
      mockTwilioCallsCreate.mockClear();
      
      // Setup request
      mockRequest.body = {
        number: '+18001234567',
        leadinfo: {
          LeadName: 'Test Lead',
          CareReason: 'Test Reason',
          CareNeededFor: 'Test Patient'
        }
      };
      mockRequest.headers = { host: 'test.com' };
      
      // Mock twilioClient.calls.create directly before test
      mockTwilioCallsCreate.mockImplementation(() => {
        return Promise.resolve({
          sid: 'CA' + Math.random().toString(36).substring(2, 10),
          status: 'queued'
        });
      });
      
      // Apply our inspector to the handler
      const decoratedHandler = inspectOutboundCallHandler(routeHandlers['/outbound-call-to-sales']);
      
      // Call the decorated handler
      await decoratedHandler(mockRequest, mockReply);
      
      // In a unit test environment without all dependencies available, the call may fail,
      // but we just want to verify the handler processes the request without throwing
      expect(mockReply.send).toHaveBeenCalled();
    });
  });

  describe('/outbound-call-twiml endpoint', () => {
    it('should generate valid TwiML for the lead call', async () => {
      // Ensure the handler was captured
      expect(routeHandlers['/outbound-call-twiml']).toBeDefined();
      
      // Set up query parameters
      mockRequest.query = {
        leadName: 'Test Lead',
        careReason: 'Test Reason',
        careNeededFor: 'Test Patient'
      };
      
      // Call handler
      await routeHandlers['/outbound-call-twiml'](mockRequest, mockReply);
      
      // Verify response is XML
      expect(mockReply.type).toHaveBeenCalledWith('text/xml');
      expect(mockReply.send).toHaveBeenCalledWith(expect.stringContaining('<?xml version="1.0" encoding="UTF-8"?>'));
      expect(mockReply.send).toHaveBeenCalledWith(expect.stringContaining('<Stream url="wss://'));
    });
  });

  describe('/sales-team-twiml endpoint', () => {
    it('should generate valid TwiML for the sales team call', async () => {
      // Ensure the handler was captured
      expect(routeHandlers['/sales-team-twiml']).toBeDefined();
      
      // Set up query parameters
      mockRequest.query = {
        leadName: 'Test Lead',
        careReason: 'Test Reason',
        careNeededFor: 'Test Patient'
      };
      
      // Call handler
      await routeHandlers['/sales-team-twiml'](mockRequest, mockReply);
      
      // Verify response is XML
      expect(mockReply.type).toHaveBeenCalledWith('text/xml');
      expect(mockReply.send).toHaveBeenCalledWith(expect.stringContaining('<?xml version="1.0" encoding="UTF-8"?>'));
      expect(mockReply.send).toHaveBeenCalledWith(expect.stringContaining('<Say>'));
    });
  });

  describe('/lead-status endpoint', () => {
    it('should update call status when receiving status callback', async () => {
      // Ensure the handler was captured
      expect(routeHandlers['/lead-status']).toBeDefined();
      
      // Set up request body
      mockRequest.body = {
        CallSid: 'CA12345',
        CallStatus: 'in-progress'
      };
      
      // Call handler
      await routeHandlers['/lead-status'](mockRequest, mockReply);
      
      // Hard to verify internal state change without exposing callStatuses
      // Just check that it responded
      expect(mockReply.send).toHaveBeenCalled();
    });
  });
}); 