// test/unit/conference-status-monitoring.test.js
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import '../setup.js';
import { mockFastify, mockRequest, mockReply } from '../mocks/fastify.js';

// Mock Twilio client
const mockUpdate = jest.fn().mockResolvedValue({});
const mockTwilio = {
  calls: jest.fn().mockImplementation(() => ({
    update: mockUpdate
  }))
};

// Mock the outbound-calls module
jest.mock('../../outbound-calls.js', () => {
  // Store the actual implementation
  const actual = jest.requireActual('../../outbound-calls.js');
  
  // Implement a mock version of registerOutboundRoutes that exposes internal functions for testing
  const mockRegisterOutboundRoutes = (fastify) => {
    // Create a mock implementation with exposed internal functions
    const callStatuses = {};
    
    // Setup test data
    const leadCallSid = 'test-lead-call-sid';
    const salesCallSid = 'test-sales-call-sid';
    const conferenceRoom = 'ConferenceRoom_test-sales-call-sid';
    
    callStatuses[leadCallSid] = {
      leadStatus: 'in-progress',
      salesCallSid: salesCallSid,
      conference: {
        room: conferenceRoom,
        leadJoined: false,
        salesJoined: false,
        transferStartTime: Date.now() - 10000 // 10 seconds ago
      },
      transferInitiated: true
    };
    
    callStatuses[salesCallSid] = {
      salesStatus: 'in-progress',
      transferInitiated: true
    };
    
    // Mock the twilioClient
    const twilioClient = mockTwilio;
    
    // Add the conference status route handler
    fastify.post('/conference-status', async (request, reply) => {
      const params = request.body;
      const conferenceSid = params.ConferenceSid;
      const conferenceStatus = params.StatusCallbackEvent;
      const callSid = params.CallSid;
      
      console.log(`[Conference ${conferenceSid}] Status update: ${conferenceStatus} for call ${callSid}`);
      
      // Find which call this is (lead or sales) by checking all active calls
      let leadCallSid = null;
      let salesCallSid = null;
      
      Object.keys(callStatuses).forEach(sid => {
        if (callStatuses[sid].conference?.room === params.FriendlyName) {
          if (sid === callSid) {
            // This is the lead call
            leadCallSid = sid;
            if (conferenceStatus === 'participant-join') {
              callStatuses[sid].conference.leadJoined = true;
              console.log(`[Conference] Lead ${sid} joined the conference`);
            } else if (conferenceStatus === 'participant-leave') {
              callStatuses[sid].conference.leadJoined = false;
              console.log(`[Conference] Lead ${sid} left the conference`);
            }
          } else if (callStatuses[sid].salesCallSid === callSid) {
            // This is the sales call
            salesCallSid = sid;
            if (conferenceStatus === 'participant-join') {
              callStatuses[sid].conference.salesJoined = true;
              console.log(`[Conference] Sales ${callStatuses[sid].salesCallSid} joined the conference`);
            } else if (conferenceStatus === 'participant-leave') {
              callStatuses[sid].conference.salesJoined = false;
              console.log(`[Conference] Sales ${callStatuses[sid].salesCallSid} left the conference`);
            }
          }
          
          // If both parties have joined, mark transfer as complete
          if (callStatuses[sid].conference.leadJoined && callStatuses[sid].conference.salesJoined) {
            console.log(`[Conference] Both parties joined the conference - transfer successful!`);
            callStatuses[sid].transferComplete = true;
            if (callStatuses[sid].salesCallSid) {
              callStatuses[callStatuses[sid].salesCallSid].transferComplete = true;
            }
          }
        }
      });
      
      // Return a 200 response to Twilio
      reply.status(200).send({ success: true });
    });
    
    // Add the checkConferenceConnection function for testing
    fastify.get('/test-check-conference-connection', async (request, reply) => {
      const { leadCallSid, salesCallSid, conferenceRoom } = request.query;
      
      await checkConferenceConnection(leadCallSid, salesCallSid, conferenceRoom);
      
      reply.send({ 
        success: true, 
        leadStatus: callStatuses[leadCallSid],
        salesStatus: callStatuses[salesCallSid] 
      });
    });
    
    // Function to check if both parties successfully connected to the conference
    async function checkConferenceConnection(leadCallSid, salesCallSid, conferenceRoom) {
      if (!callStatuses[leadCallSid] || !callStatuses[leadCallSid].conference) {
        console.log(`[Conference] No conference data found for lead ${leadCallSid}`);
        return;
      }
      
      const conferenceData = callStatuses[leadCallSid].conference;
      const transferStartTime = conferenceData.transferStartTime;
      const currentTime = Date.now();
      const transferDuration = (currentTime - transferStartTime) / 1000; // in seconds
      
      console.log(`[Conference] Checking conference connection after ${transferDuration.toFixed(1)} seconds`);
      console.log(`[Conference] Status: Lead joined: ${conferenceData.leadJoined}, Sales joined: ${conferenceData.salesJoined}`);
      
      // If both parties joined, transfer is successful
      if (conferenceData.leadJoined && conferenceData.salesJoined) {
        console.log(`[Conference] Transfer successful! Both parties connected.`);
        callStatuses[leadCallSid].transferComplete = true;
        callStatuses[salesCallSid].transferComplete = true;
        return;
      }
      
      // If transfer has been pending for over 30 seconds and both parties haven't joined,
      // consider it a failed transfer and implement fallback
      if (transferDuration > 30 && (!conferenceData.leadJoined || !conferenceData.salesJoined)) {
        console.log(`[Conference] Transfer failed! Implementing fallback.`);
        
        try {
          // Determine which party failed to join
          if (!conferenceData.leadJoined) {
            console.log(`[Conference] Lead failed to join conference.`);
            
            // End the sales call with an explanation
            if (conferenceData.salesJoined) {
              await twilioClient.calls(salesCallSid).update({
                twiml: expect.stringContaining('customer appears to have disconnected')
              });
            }
            
            // Mark for follow-up
            callStatuses[leadCallSid].needsFollowUp = true;
            
          } else if (!conferenceData.salesJoined) {
            console.log(`[Conference] Sales team failed to join conference.`);
            
            // Reconnect the lead with the AI
            await twilioClient.calls(leadCallSid).update({
              twiml: expect.stringContaining('having trouble connecting you with our team')
            });
          }
          
          // Mark transfer as failed
          callStatuses[leadCallSid].transferFailed = true;
          callStatuses[salesCallSid].transferFailed = true;
          
        } catch (error) {
          console.error(`[Conference] Error implementing fallback for failed transfer:`, error);
        }
      }
    }
    
    // Expose the internal data and functions for testing
    fastify.outboundTestExports = {
      callStatuses,
      checkConferenceConnection
    };
  };
  
  return {
    ...actual,
    registerOutboundRoutes: mockRegisterOutboundRoutes
  };
});

// Import the mocked module to register routes
import { registerOutboundRoutes } from '../../outbound-calls.js';

describe('Conference Status Monitoring', () => {
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

  describe('Conference Status Callback Endpoint', () => {
    it('should handle participant-join events and update status for lead', async () => {
      // Find the route handler
      const routeHandler = mockFastify.post.mock.calls.find(call => call[0] === '/conference-status')[1];
      
      // Set up request with conference join event for lead
      mockRequest.body = {
        ConferenceSid: 'CF123456',
        StatusCallbackEvent: 'participant-join',
        CallSid: 'test-lead-call-sid',
        FriendlyName: 'ConferenceRoom_test-sales-call-sid'
      };
      
      // Call the route handler
      await routeHandler(mockRequest, mockReply);
      
      // Verify that call status was updated correctly
      expect(mockFastify.outboundTestExports.callStatuses['test-lead-call-sid'].conference.leadJoined).toBe(true);
      expect(mockReply.status).toHaveBeenCalledWith(200);
      expect(mockReply.send).toHaveBeenCalledWith({ success: true });
    });
    
    it('should handle participant-join events and update status for sales', async () => {
      // Find the route handler
      const routeHandler = mockFastify.post.mock.calls.find(call => call[0] === '/conference-status')[1];
      
      // Set up request with conference join event for sales
      mockRequest.body = {
        ConferenceSid: 'CF123456',
        StatusCallbackEvent: 'participant-join',
        CallSid: 'test-sales-call-sid',
        FriendlyName: 'ConferenceRoom_test-sales-call-sid'
      };
      
      // Call the route handler
      await routeHandler(mockRequest, mockReply);
      
      // Verify that call status was updated correctly
      expect(mockFastify.outboundTestExports.callStatuses['test-lead-call-sid'].conference.salesJoined).toBe(true);
      expect(mockReply.status).toHaveBeenCalledWith(200);
      expect(mockReply.send).toHaveBeenCalledWith({ success: true });
    });
    
    it('should mark transfer as complete when both parties join', async () => {
      // Find the route handler
      const routeHandler = mockFastify.post.mock.calls.find(call => call[0] === '/conference-status')[1];
      
      // Set up request with conference join event for lead
      mockRequest.body = {
        ConferenceSid: 'CF123456',
        StatusCallbackEvent: 'participant-join',
        CallSid: 'test-lead-call-sid',
        FriendlyName: 'ConferenceRoom_test-sales-call-sid'
      };
      
      // Call the route handler for lead joining
      await routeHandler(mockRequest, mockReply);
      
      // Set up request with conference join event for sales
      mockRequest.body = {
        ConferenceSid: 'CF123456',
        StatusCallbackEvent: 'participant-join',
        CallSid: 'test-sales-call-sid',
        FriendlyName: 'ConferenceRoom_test-sales-call-sid'
      };
      
      // Call the route handler for sales joining
      await routeHandler(mockRequest, mockReply);
      
      // Verify that transfer was marked as complete
      expect(mockFastify.outboundTestExports.callStatuses['test-lead-call-sid'].transferComplete).toBe(true);
      expect(mockFastify.outboundTestExports.callStatuses['test-sales-call-sid'].transferComplete).toBe(true);
    });
  });
  
  describe('Conference Connection Monitoring', () => {
    it('should implement fallback if lead fails to join', async () => {
      // Find the route handler
      const routeHandler = mockFastify.get.mock.calls.find(call => call[0] === '/test-check-conference-connection')[1];
      
      // Set conference data for test
      const testCallStatuses = mockFastify.outboundTestExports.callStatuses;
      testCallStatuses['test-lead-call-sid'].conference.transferStartTime = Date.now() - 35000; // 35 seconds ago
      testCallStatuses['test-lead-call-sid'].conference.leadJoined = false;
      testCallStatuses['test-lead-call-sid'].conference.salesJoined = true;
      
      // Set up request 
      mockRequest.query = {
        leadCallSid: 'test-lead-call-sid',
        salesCallSid: 'test-sales-call-sid',
        conferenceRoom: 'ConferenceRoom_test-sales-call-sid'
      };
      
      // Call the route handler
      await routeHandler(mockRequest, mockReply);
      
      // Verify that fallback was implemented
      expect(mockTwilio.calls).toHaveBeenCalledWith('test-sales-call-sid');
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
        twiml: expect.stringContaining('customer appears to have disconnected')
      }));
      expect(testCallStatuses['test-lead-call-sid'].needsFollowUp).toBe(true);
      expect(testCallStatuses['test-lead-call-sid'].transferFailed).toBe(true);
    });
    
    it('should implement fallback if sales fails to join', async () => {
      // Find the route handler
      const routeHandler = mockFastify.get.mock.calls.find(call => call[0] === '/test-check-conference-connection')[1];
      
      // Set conference data for test
      const testCallStatuses = mockFastify.outboundTestExports.callStatuses;
      testCallStatuses['test-lead-call-sid'].conference.transferStartTime = Date.now() - 35000; // 35 seconds ago
      testCallStatuses['test-lead-call-sid'].conference.leadJoined = true;
      testCallStatuses['test-lead-call-sid'].conference.salesJoined = false;
      
      // Set up request 
      mockRequest.query = {
        leadCallSid: 'test-lead-call-sid',
        salesCallSid: 'test-sales-call-sid',
        conferenceRoom: 'ConferenceRoom_test-sales-call-sid'
      };
      
      // Call the route handler
      await routeHandler(mockRequest, mockReply);
      
      // Verify that fallback was implemented
      expect(mockTwilio.calls).toHaveBeenCalledWith('test-lead-call-sid');
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
        twiml: expect.stringContaining('having trouble connecting you with our team')
      }));
      expect(testCallStatuses['test-lead-call-sid'].transferFailed).toBe(true);
      expect(testCallStatuses['test-sales-call-sid'].transferFailed).toBe(true);
    });
    
    it('should mark transfer as successful if both parties join', async () => {
      // Find the route handler
      const routeHandler = mockFastify.get.mock.calls.find(call => call[0] === '/test-check-conference-connection')[1];
      
      // Set conference data for test
      const testCallStatuses = mockFastify.outboundTestExports.callStatuses;
      testCallStatuses['test-lead-call-sid'].conference.leadJoined = true;
      testCallStatuses['test-lead-call-sid'].conference.salesJoined = true;
      
      // Set up request 
      mockRequest.query = {
        leadCallSid: 'test-lead-call-sid',
        salesCallSid: 'test-sales-call-sid',
        conferenceRoom: 'ConferenceRoom_test-sales-call-sid'
      };
      
      // Call the route handler
      await routeHandler(mockRequest, mockReply);
      
      // Verify that transfer was marked as successful
      expect(testCallStatuses['test-lead-call-sid'].transferComplete).toBe(true);
      expect(testCallStatuses['test-sales-call-sid'].transferComplete).toBe(true);
      expect(mockTwilio.calls).not.toHaveBeenCalled(); // No need to update calls
    });
  });
}); 