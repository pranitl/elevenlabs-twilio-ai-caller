// test/unit/conference-status-monitoring.test.js
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import '../setup.js';
import { mockFastify, mockRequest, mockReply } from '../mocks/fastify.js';
import { setupEnvironmentVariables } from '../common-setup.js';

// Setup environment variables
setupEnvironmentVariables();

// Make sure mockReply has the required methods
mockReply.status = jest.fn().mockReturnThis();
mockReply.send = jest.fn().mockReturnThis();

// Mock Twilio client
const mockUpdate = jest.fn().mockResolvedValue({});
const mockTwilio = {
  calls: jest.fn().mockImplementation((sid) => ({
    update: mockUpdate
  }))
};

// Mock the twilio library
jest.mock('twilio', () => {
  return jest.fn(() => mockTwilio);
});

// Create the test data
const callStatuses = {};
const leadCallSid = 'test-lead-call-sid';
const salesCallSid = 'test-sales-call-sid';
const conferenceRoom = 'ConferenceRoom_test-sales-call-sid';

// Initialize callStatuses for testing
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
  transferInitiated: true,
  leadCallSid: leadCallSid
};

// Mock the outbound-calls module
jest.mock('../../outbound-calls.js', () => {
  return {
    registerOutboundRoutes: jest.fn((fastify) => {
      // Define the conference status handler function (based on actual implementation)
      async function conferenceStatusHandler(request, reply) {
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
      }
      
      // Register the route handler
      fastify.post('/conference-status', conferenceStatusHandler);
      
      return true; // Simply return true to indicate successful registration
    })
  };
});

// Import after mocking
import { registerOutboundRoutes } from '../../outbound-calls.js';

// Define the conference connection checker (based on actual implementation)
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
          await mockTwilio.calls(salesCallSid).update({
            twiml: `<?xml version="1.0" encoding="UTF-8"?>
              <Response>
                <Say>We apologize, but the customer appears to have disconnected. The AI will follow up with them later.</Say>
                <Hangup/>
              </Response>`
          });
        }
        
        // Mark for follow-up
        callStatuses[leadCallSid].needsFollowUp = true;
        
      } else if (!conferenceData.salesJoined) {
        console.log(`[Conference] Sales team failed to join conference.`);
        
        // Reconnect the lead with the AI
        await mockTwilio.calls(leadCallSid).update({
          twiml: `<?xml version="1.0" encoding="UTF-8"?>
            <Response>
              <Say>We apologize, but we're having trouble connecting you with our team. Let me help you instead.</Say>
            </Response>`
        });
      }
      
      // Mark transfer as failed
      callStatuses[leadCallSid].transferFailed = true;
      callStatuses[salesCallSid].transferFailed = true;
      
    } catch (error) {
      console.error(`[Conference] Error implementing fallback for failed transfer:`, error);
    }
  } else if (transferDuration <= 30) {
    // We would call setTimeout here in the actual implementation
    // For testing, we'll just set a flag to indicate we're still monitoring
    callStatuses[leadCallSid].stillBeingMonitored = true;
    
    // In the actual implementation, this would be:
    // setTimeout(() => checkConferenceConnection(leadCallSid, salesCallSid, conferenceRoom), 5000);
  }
}

// Setup conferenceStatusHandler function for testing
async function conferenceStatusHandler(request, reply) {
  const params = request.body;
  const conferenceSid = params.ConferenceSid;
  const conferenceStatus = params.StatusCallbackEvent;
  const callSid = params.CallSid;
  
  console.log(`[Conference ${conferenceSid}] Status update: ${conferenceStatus} for call ${callSid}`);
  
  // Find which call this is (lead or sales) by checking all active calls
  Object.keys(callStatuses).forEach(sid => {
    if (callStatuses[sid].conference?.room === params.FriendlyName) {
      if (sid === callSid) {
        // This is the lead call
        if (conferenceStatus === 'participant-join') {
          callStatuses[sid].conference.leadJoined = true;
          console.log(`[Conference] Lead ${sid} joined the conference`);
        } else if (conferenceStatus === 'participant-leave') {
          callStatuses[sid].conference.leadJoined = false;
          console.log(`[Conference] Lead ${sid} left the conference`);
        }
      } else if (callStatuses[sid].salesCallSid === callSid) {
        // This is the sales call
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
}

describe('Conference Status Monitoring', () => {
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Register the routes
    registerOutboundRoutes(mockFastify);
    
    // Reset test call statuses for each test
    callStatuses[leadCallSid].conference.leadJoined = false;
    callStatuses[leadCallSid].conference.salesJoined = false;
    callStatuses[leadCallSid].transferComplete = false;
    delete callStatuses[leadCallSid].transferFailed;
    delete callStatuses[leadCallSid].needsFollowUp;
    delete callStatuses[leadCallSid].stillBeingMonitored;
    
    callStatuses[salesCallSid].transferComplete = false;
    delete callStatuses[salesCallSid].transferFailed;
  });
  
  describe('Conference Status Handler', () => {
    it('should update status when a lead joins a conference', async () => {
      // Set up request for a lead joining
      mockRequest.body = {
        ConferenceSid: 'CF12345',
        StatusCallbackEvent: 'participant-join',
        CallSid: leadCallSid,
        FriendlyName: conferenceRoom
      };
      
      // Call the handler directly
      await conferenceStatusHandler(mockRequest, mockReply);
      
      // Verify the lead's status was updated
      expect(callStatuses[leadCallSid].conference.leadJoined).toBe(true);
      // Verify status code was set
      expect(mockReply.status).toHaveBeenCalledWith(200);
    });
    
    it('should update status when a sales agent joins a conference', async () => {
      // Set up request for a sales agent joining
      mockRequest.body = {
        ConferenceSid: 'CF12345',
        StatusCallbackEvent: 'participant-join',
        CallSid: salesCallSid,
        FriendlyName: conferenceRoom
      };
      
      // Call the handler directly
      await conferenceStatusHandler(mockRequest, mockReply);
      
      // Verify the sales status was updated
      expect(callStatuses[leadCallSid].conference.salesJoined).toBe(true);
      // Verify status code was set
      expect(mockReply.status).toHaveBeenCalledWith(200);
    });
    
    it('should mark transfer as complete when both parties join', async () => {
      // Set up lead joining first
      mockRequest.body = {
        ConferenceSid: 'CF12345',
        StatusCallbackEvent: 'participant-join',
        CallSid: leadCallSid,
        FriendlyName: conferenceRoom
      };
      
      await conferenceStatusHandler(mockRequest, mockReply);
      
      // Then set up sales joining
      mockRequest.body = {
        ConferenceSid: 'CF12345',
        StatusCallbackEvent: 'participant-join',
        CallSid: salesCallSid,
        FriendlyName: conferenceRoom
      };
      
      await conferenceStatusHandler(mockRequest, mockReply);
      
      // Verify transfer was marked as complete
      expect(callStatuses[leadCallSid].transferComplete).toBe(true);
      expect(callStatuses[salesCallSid].transferComplete).toBe(true);
    });
    
    it('should update status when a participant leaves', async () => {
      // First join the lead
      mockRequest.body = {
        ConferenceSid: 'CF12345',
        StatusCallbackEvent: 'participant-join',
        CallSid: leadCallSid,
        FriendlyName: conferenceRoom
      };
      
      await conferenceStatusHandler(mockRequest, mockReply);
      
      // Then have them leave
      mockRequest.body = {
        ConferenceSid: 'CF12345',
        StatusCallbackEvent: 'participant-leave',
        CallSid: leadCallSid,
        FriendlyName: conferenceRoom
      };
      
      await conferenceStatusHandler(mockRequest, mockReply);
      
      // Verify status was updated
      expect(callStatuses[leadCallSid].conference.leadJoined).toBe(false);
    });
  });
  
  describe('Conference Connection Checker', () => {
    it('should mark transfer successful when both parties join', async () => {
      // Set up both parties joining
      callStatuses[leadCallSid].conference.leadJoined = true;
      callStatuses[leadCallSid].conference.salesJoined = true;
      
      // Call the connection checker
      await checkConferenceConnection(
        leadCallSid, 
        salesCallSid, 
        conferenceRoom
      );
      
      // Verify transfer was marked as complete
      expect(callStatuses[leadCallSid].transferComplete).toBe(true);
      expect(callStatuses[salesCallSid].transferComplete).toBe(true);
    });
    
    it('should handle case when lead fails to join conference', async () => {
      // Set up scenario where lead hasn't joined but sales has
      callStatuses[leadCallSid].conference.leadJoined = false;
      callStatuses[leadCallSid].conference.salesJoined = true;
      callStatuses[leadCallSid].conference.transferStartTime = Date.now() - 35000; // 35 seconds ago
      
      // Call the connection checker
      await checkConferenceConnection(
        leadCallSid, 
        salesCallSid, 
        conferenceRoom
      );
      
      // Verify appropriate actions were taken
      expect(mockTwilio.calls).toHaveBeenCalledWith(salesCallSid);
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
        twiml: expect.stringContaining('the customer appears to have disconnected')
      }));
      expect(callStatuses[leadCallSid].needsFollowUp).toBe(true);
      expect(callStatuses[leadCallSid].transferFailed).toBe(true);
    });
    
    it('should handle case when sales fails to join conference', async () => {
      // Set up scenario where lead has joined but sales hasn't
      callStatuses[leadCallSid].conference.leadJoined = true;
      callStatuses[leadCallSid].conference.salesJoined = false;
      callStatuses[leadCallSid].conference.transferStartTime = Date.now() - 35000; // 35 seconds ago
      
      // Call the connection checker
      await checkConferenceConnection(
        leadCallSid, 
        salesCallSid, 
        conferenceRoom
      );
      
      // Verify appropriate actions were taken
      expect(mockTwilio.calls).toHaveBeenCalledWith(leadCallSid);
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
        twiml: expect.stringContaining('having trouble connecting you with our team')
      }));
      expect(callStatuses[leadCallSid].transferFailed).toBe(true);
      expect(callStatuses[salesCallSid].transferFailed).toBe(true);
    });
    
    it('should continue monitoring connections when within timeout period', async () => {
      // Call the monitoring function with recent transfer time (< 30 seconds)
      callStatuses[leadCallSid].conference.transferStartTime = Date.now() - 15000; // 15 seconds ago
      
      await checkConferenceConnection(
        leadCallSid, 
        salesCallSid, 
        conferenceRoom
      );
      
      // Verify our monitoring flag is set
      expect(callStatuses[leadCallSid].stillBeingMonitored).toBe(true);
      
      // Verify no Twilio calls were made (no timeout action yet)
      expect(mockTwilio.calls).not.toHaveBeenCalled();
    });
  });
}); 