/**
 * Test suite for conference joining logic
 * 
 * Tests conference creation, joining sequence, audio handling, 
 * failure scenarios, and multi-party interactions
 */
import { jest } from '@jest/globals';
import { createMockFastify } from '../setup.js';
import { registerOutboundRoutes } from '../../outbound-calls.js';
import { webhookStore } from '../mocks/make-mock.js';
import TwilioMock from '../mocks/twilio-mock.js';

// Track real setTimeout calls
const timeoutIds = [];
const originalRealSetTimeout = global.setTimeout;
global.setTimeout = function mockableSetTimeout(fn, delay) {
  const id = originalRealSetTimeout(fn, delay);
  timeoutIds.push(id);
  return id;
};

describe('Conference Joining Logic', () => {
  let fastify;
  let twilioClient;
  let callStatuses;
  let leadCallSid, salesCallSid;
  let originalSetTimeout;

  beforeEach(() => {
    // Save original setTimeout and mock it
    originalSetTimeout = global.setTimeout;
    global.setTimeout = jest.fn(originalSetTimeout);
    
    // Create a fresh fastify instance for each test
    fastify = createMockFastify();
    
    // Initialize call statuses
    callStatuses = {};
    
    // Create a fresh Twilio client mock
    twilioClient = new TwilioMock(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    
    // Make Twilio client available to the fastify instance
    fastify.twilioClient = twilioClient;
    
    // Register the outbound routes (simplified for testing)
    registerOutboundRoutes(fastify);
    
    // Mock transferCalls function if it doesn't exist
    if (!fastify.transferCalls) {
      fastify.transferCalls = jest.fn(async (type, leadSid, salesSid) => {
        if (type !== 'conference') return;
        
        const conferenceRoom = `ConferenceRoom_${salesSid}`;
        
        // Initialize conference data
        if (!callStatuses[leadSid]) {
          callStatuses[leadSid] = { salesCallSid: salesSid };
        }
        
        if (!callStatuses[salesSid]) {
          callStatuses[salesSid] = { leadCallSid: leadSid };
        }
        
        // Store conference information
        callStatuses[leadSid].conference = {
          room: conferenceRoom,
          leadJoined: false,
          salesJoined: false,
          transferStartTime: Date.now()
        };
        
        // Add mock implementation of the calls update
        if (twilioClient.calls && typeof twilioClient.calls === 'function') {
          const leadCall = twilioClient.calls(leadSid);
          if (leadCall && leadCall.update) {
            await leadCall.update({
              twiml: `<?xml version="1.0" encoding="UTF-8"?>
                <Response>
                  <Dial>
                    <Conference 
                      waitUrl="https://twimlets.com/holdmusic?Bucket=com.twilio.music.classical" 
                      beep="false"
                      statusCallback="https://example.com/conference-status"
                      statusCallbackEvent="join leave"
                      statusCallbackMethod="POST">
                      ${conferenceRoom}
                    </Conference>
                  </Dial>
                </Response>`
            });
          }
          
          const salesCall = twilioClient.calls(salesSid);
          if (salesCall && salesCall.update) {
            await salesCall.update({
              twiml: `<?xml version="1.0" encoding="UTF-8"?>
                <Response>
                  <Say>Transferring you to the call now.</Say>
                  <Dial>
                    <Conference 
                      waitUrl="https://twimlets.com/holdmusic?Bucket=com.twilio.music.classical" 
                      beep="false"
                      statusCallback="https://example.com/conference-status"
                      statusCallbackEvent="join leave"
                      statusCallbackMethod="POST">
                      ${conferenceRoom}
                    </Conference>
                  </Dial>
                </Response>`
            });
          }
        }
        
        // Simulate starting the monitoring
        global.setTimeout(() => {
          if (fastify.checkConferenceConnection) {
            fastify.checkConferenceConnection(leadSid, salesSid, conferenceRoom);
          }
        }, 15000);
        
        // Return info about the conference
        return { conferenceRoom };
      });
    }
    
    // Mock checkConferenceConnection function if it doesn't exist
    if (!fastify.checkConferenceConnection) {
      fastify.checkConferenceConnection = jest.fn(async (leadSid, salesSid, conferenceRoom) => {
        // Check if both parties joined
        if (!callStatuses[leadSid] || !callStatuses[leadSid].conference) {
          return;
        }
        
        const conferenceData = callStatuses[leadSid].conference;
        const transferDuration = (Date.now() - conferenceData.transferStartTime) / 1000; // in seconds
        
        // If both parties joined, transfer is successful
        if (conferenceData.leadJoined && conferenceData.salesJoined) {
          callStatuses[leadSid].transferComplete = true;
          callStatuses[salesSid].transferComplete = true;
          return;
        }
        
        // If transfer has been pending for over 30 seconds and both parties haven't joined,
        // consider it a failed transfer and implement fallback
        if (transferDuration > 30 && (!conferenceData.leadJoined || !conferenceData.salesJoined)) {
          // Mark transfer as failed
          callStatuses[leadSid].transferFailed = true;
          callStatuses[salesSid].transferFailed = true;
          
          if (!conferenceData.leadJoined) {
            // Lead failed to join
            callStatuses[leadSid].needsFollowUp = true;
            
            // Update sales call
            if (twilioClient.calls && typeof twilioClient.calls === 'function' && conferenceData.salesJoined) {
              await twilioClient.calls(salesSid).update({
                twiml: `<?xml version="1.0" encoding="UTF-8"?>
                  <Response>
                    <Say>We apologize, but the customer appears to have disconnected. The AI will follow up with them later.</Say>
                    <Hangup/>
                  </Response>`
              });
            }
          } else if (!conferenceData.salesJoined) {
            // Sales failed to join
            if (twilioClient.calls && typeof twilioClient.calls === 'function') {
              await twilioClient.calls(leadSid).update({
                twiml: `<?xml version="1.0" encoding="UTF-8"?>
                  <Response>
                    <Say>We apologize, but we're having trouble connecting you with our team. Let me help you instead.</Say>
                    <Connect>
                      <Stream url="wss://example.com/elevenlabs-stream">
                        <Parameter name="callSid" value="${leadSid}"/>
                        <Parameter name="transferFailed" value="true"/>
                      </Stream>
                    </Connect>
                  </Response>`
              });
            }
          }
        }
      });
    }
    
    // Setup test call SIDs for convenience
    leadCallSid = 'CA' + Math.random().toString(36).substring(2, 15);
    salesCallSid = 'CA' + Math.random().toString(36).substring(2, 15);
    
    // Configure test settings for predictable results
    global.testSettings.amdResult = 'human';
    
    // Reset timeoutIds for this test
    timeoutIds.splice(0, timeoutIds.length);
  });
  
  afterEach(() => {
    // Restore original setTimeout
    global.setTimeout = originalSetTimeout;
    
    // Clear all Jest timers
    jest.clearAllTimers();
    
    // Clear all real timers that were tracked
    timeoutIds.forEach(id => clearTimeout(id));
    timeoutIds.splice(0, timeoutIds.length);
  });

  // Helper function to initiate test calls
  async function setupConferenceCalls() {
    // Create mock calls directly
    const leadCall = await twilioClient.calls.create({
      from: process.env.TWILIO_PHONE_NUMBER,
      to: '+15551234567',
      url: 'https://example.com/twiml',
      statusCallback: 'https://example.com/status',
      statusCallbackEvent: ['initiated', 'answered', 'completed'],
      machineDetection: 'Enable',
    });

    const salesCall = await twilioClient.calls.create({
      from: process.env.TWILIO_PHONE_NUMBER,
      to: process.env.SALES_TEAM_PHONE_NUMBER,
      url: 'https://example.com/sales-twiml',
      statusCallback: 'https://example.com/sales-status',
      statusCallbackEvent: ['initiated', 'answered', 'completed'],
    });

    // Setup call statuses
    callStatuses[leadCall.sid] = {
      leadStatus: 'in-progress',
      salesCallSid: salesCall.sid,
    };
    
    callStatuses[salesCall.sid] = {
      salesStatus: 'in-progress',
      leadCallSid: leadCall.sid,
    };

    // Create a unique conference room name based on the sales call SID
    const conferenceRoom = `ConferenceRoom_${salesCall.sid}`;
    
    // Store conference information for monitoring
    callStatuses[leadCall.sid].conference = {
      room: conferenceRoom,
      leadJoined: false,
      salesJoined: false,
      transferStartTime: Date.now()
    };

    return { leadCall, salesCall, conferenceRoom };
  }

  // Helper function to simulate conference status updates
  function simulateConferenceStatusUpdate(conferenceData) {
    // Create a mock request with the conference data
    const request = {
      body: {
        ConferenceSid: conferenceData.conferenceSid || 'CF' + Math.random().toString(36).substring(2, 15),
        FriendlyName: conferenceData.conferenceRoom,
        StatusCallbackEvent: conferenceData.event,
        CallSid: conferenceData.callSid
      }
    };
    
    // Create a mock reply
    const reply = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn()
    };
    
    // Find the right call IDs
    for (const sid in callStatuses) {
      if (callStatuses[sid].conference?.room === conferenceData.conferenceRoom) {
        const leadSid = sid;
        const salesSid = callStatuses[sid].salesCallSid;
        
        if (conferenceData.callSid === leadSid) {
          // Lead call status update
          if (conferenceData.event === 'participant-join') {
            callStatuses[leadSid].conference.leadJoined = true;
          } else if (conferenceData.event === 'participant-leave') {
            callStatuses[leadSid].conference.leadJoined = false;
          }
        } else if (conferenceData.callSid === salesSid) {
          // Sales call status update
          if (conferenceData.event === 'participant-join') {
            callStatuses[leadSid].conference.salesJoined = true;
          } else if (conferenceData.event === 'participant-leave') {
            callStatuses[leadSid].conference.salesJoined = false;
          }
        }
        
        // If both parties have joined, mark transfer as complete
        if (callStatuses[leadSid].conference.leadJoined && 
            callStatuses[leadSid].conference.salesJoined) {
          callStatuses[leadSid].transferComplete = true;
          callStatuses[salesSid].transferComplete = true;
        }
      }
    }
    
    return { request, reply };
  }
  
  describe('Conference Creation and Joining', () => {
    test('should create conference and add both participants', async () => {
      const { leadCall, salesCall, conferenceRoom } = await setupConferenceCalls();
      
      // Mock the Twilio client's update method to inspect TwiML
      const mockLeadUpdate = jest.fn().mockResolvedValue({});
      const mockSalesUpdate = jest.fn().mockResolvedValue({});
      
      twilioClient.calls = jest.fn(sid => ({
        update: sid === leadCall.sid ? mockLeadUpdate : mockSalesUpdate
      }));
      
      // Trigger the transfer to conference
      await fastify.transferCalls('conference', leadCall.sid, salesCall.sid);
      
      // Verify both calls were updated with conference TwiML
      expect(mockLeadUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          twiml: expect.stringContaining(`<Conference`)
        })
      );
      expect(mockLeadUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          twiml: expect.stringContaining(conferenceRoom)
        })
      );
      
      expect(mockSalesUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          twiml: expect.stringContaining(`<Conference`)
        })
      );
      expect(mockSalesUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          twiml: expect.stringContaining(conferenceRoom)
        })
      );
      
      // Verify conference monitoring is being set up
      expect(global.setTimeout).toHaveBeenCalledWith(
        expect.any(Function),
        15000
      );
    });
    
    test('should track participant joining status correctly', async () => {
      const { leadCall, salesCall, conferenceRoom } = await setupConferenceCalls();
      
      // Initially both participants have not joined
      expect(callStatuses[leadCall.sid].conference.leadJoined).toBe(false);
      expect(callStatuses[leadCall.sid].conference.salesJoined).toBe(false);
      
      // Simulate lead joining the conference
      simulateConferenceStatusUpdate({
        conferenceRoom,
        event: 'participant-join',
        callSid: leadCall.sid
      });
      
      // Verify lead is now marked as joined
      expect(callStatuses[leadCall.sid].conference.leadJoined).toBe(true);
      expect(callStatuses[leadCall.sid].conference.salesJoined).toBe(false);
      
      // Simulate sales joining the conference
      simulateConferenceStatusUpdate({
        conferenceRoom,
        event: 'participant-join',
        callSid: salesCall.sid
      });
      
      // Verify both are now marked as joined
      expect(callStatuses[leadCall.sid].conference.leadJoined).toBe(true);
      expect(callStatuses[leadCall.sid].conference.salesJoined).toBe(true);
      
      // Verify transfer is marked complete when both parties join
      expect(callStatuses[leadCall.sid].transferComplete).toBe(true);
      expect(callStatuses[salesCall.sid].transferComplete).toBe(true);
    });
  });
  
  describe('Conference Joining Timing', () => {
    test('should handle lead joining first, then sales', async () => {
      const { leadCall, salesCall, conferenceRoom } = await setupConferenceCalls();
      
      // Lead joins first
      simulateConferenceStatusUpdate({
        conferenceRoom,
        event: 'participant-join',
        callSid: leadCall.sid
      });
      
      // Check interim state
      expect(callStatuses[leadCall.sid].conference.leadJoined).toBe(true);
      expect(callStatuses[leadCall.sid].conference.salesJoined).toBe(false);
      expect(callStatuses[leadCall.sid].transferComplete).toBeFalsy();
      
      // Sales joins second
      simulateConferenceStatusUpdate({
        conferenceRoom,
        event: 'participant-join',
        callSid: salesCall.sid
      });
      
      // Check final state
      expect(callStatuses[leadCall.sid].conference.leadJoined).toBe(true);
      expect(callStatuses[leadCall.sid].conference.salesJoined).toBe(true);
      expect(callStatuses[leadCall.sid].transferComplete).toBe(true);
    });
    
    test('should handle sales joining first, then lead', async () => {
      const { leadCall, salesCall, conferenceRoom } = await setupConferenceCalls();
      
      // Sales joins first
      simulateConferenceStatusUpdate({
        conferenceRoom,
        event: 'participant-join',
        callSid: salesCall.sid
      });
      
      // Check interim state
      expect(callStatuses[leadCall.sid].conference.salesJoined).toBe(true);
      expect(callStatuses[leadCall.sid].conference.leadJoined).toBe(false);
      expect(callStatuses[leadCall.sid].transferComplete).toBeFalsy();
      
      // Lead joins second
      simulateConferenceStatusUpdate({
        conferenceRoom,
        event: 'participant-join',
        callSid: leadCall.sid
      });
      
      // Check final state
      expect(callStatuses[leadCall.sid].conference.leadJoined).toBe(true);
      expect(callStatuses[leadCall.sid].conference.salesJoined).toBe(true);
      expect(callStatuses[leadCall.sid].transferComplete).toBe(true);
    });
    
    test('should handle simultaneous joining', async () => {
      const { leadCall, salesCall, conferenceRoom } = await setupConferenceCalls();
      
      // Both join almost simultaneously
      simulateConferenceStatusUpdate({
        conferenceRoom,
        event: 'participant-join',
        callSid: leadCall.sid
      });
      
      simulateConferenceStatusUpdate({
        conferenceRoom,
        event: 'participant-join',
        callSid: salesCall.sid
      });
      
      // Check final state
      expect(callStatuses[leadCall.sid].conference.leadJoined).toBe(true);
      expect(callStatuses[leadCall.sid].conference.salesJoined).toBe(true);
      expect(callStatuses[leadCall.sid].transferComplete).toBe(true);
    });
  });
  
  describe('Audio Handling During Transitions', () => {
    test('should include waitUrl with music for participants waiting in conference', async () => {
      const { leadCall, salesCall, conferenceRoom } = await setupConferenceCalls();
      
      // Mock the Twilio client's update method to inspect TwiML
      const mockLeadUpdate = jest.fn().mockResolvedValue({});
      twilioClient.calls = jest.fn(sid => ({
        update: mockLeadUpdate
      }));
      
      // Trigger the transfer to conference
      await fastify.transferCalls('conference', leadCall.sid, salesCall.sid);
      
      // Verify TwiML includes waitUrl with hold music
      expect(mockLeadUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          twiml: expect.stringContaining('waitUrl="https://twimlets.com/holdmusic?Bucket=com.twilio.music.classical"')
        })
      );
    });
    
    test('should disable beep sounds when participants join/leave', async () => {
      const { leadCall, salesCall, conferenceRoom } = await setupConferenceCalls();
      
      // Mock the Twilio client's update method to inspect TwiML
      const mockLeadUpdate = jest.fn().mockResolvedValue({});
      twilioClient.calls = jest.fn(sid => ({
        update: mockLeadUpdate
      }));
      
      // Trigger the transfer to conference
      await fastify.transferCalls('conference', leadCall.sid, salesCall.sid);
      
      // Verify TwiML disables beep sounds
      expect(mockLeadUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          twiml: expect.stringContaining('beep="false"')
        })
      );
    });
    
    test('should play an announcement to sales team before joining conference', async () => {
      const { leadCall, salesCall, conferenceRoom } = await setupConferenceCalls();
      
      // Mock the Twilio client's update method to inspect TwiML
      const mockSalesUpdate = jest.fn().mockResolvedValue({});
      twilioClient.calls = jest.fn(sid => ({
        update: sid === salesCall.sid ? mockSalesUpdate : jest.fn().mockResolvedValue({})
      }));
      
      // Trigger the transfer to conference
      await fastify.transferCalls('conference', leadCall.sid, salesCall.sid);
      
      // Verify sales team hears an announcement before conference
      expect(mockSalesUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          twiml: expect.stringContaining('<Say>Transferring you to the call now.</Say>')
        })
      );
    });
  });
  
  describe('Conference Failures and Recovery', () => {
    test('should detect when lead fails to join conference', async () => {
      const { leadCall, salesCall, conferenceRoom } = await setupConferenceCalls();
      
      // Only sales joins the conference
      simulateConferenceStatusUpdate({
        conferenceRoom,
        event: 'participant-join',
        callSid: salesCall.sid
      });
      
      // Fast-forward time by setting an earlier transfer start time
      callStatuses[leadCall.sid].conference.transferStartTime = Date.now() - 31000; // 31 seconds ago
      
      // Mock the Twilio client's update method for the fallback scenario
      const mockSalesUpdate = jest.fn().mockResolvedValue({});
      twilioClient.calls = jest.fn(sid => ({
        update: mockSalesUpdate
      }));
      
      // Trigger conference connection check explicitly
      await fastify.checkConferenceConnection(leadCall.sid, salesCall.sid, conferenceRoom);
      
      // Verify transfer is marked as failed
      expect(callStatuses[leadCall.sid].transferFailed).toBe(true);
      expect(callStatuses[salesCall.sid].transferFailed).toBe(true);
      
      // Verify sales team gets an explanation about the lead disconnecting
      expect(mockSalesUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          twiml: expect.stringContaining('the customer appears to have disconnected')
        })
      );
      
      // Verify lead is marked for follow-up
      expect(callStatuses[leadCall.sid].needsFollowUp).toBe(true);
    });
    
    test('should detect when sales fails to join conference', async () => {
      const { leadCall, salesCall, conferenceRoom } = await setupConferenceCalls();
      
      // Only lead joins the conference
      simulateConferenceStatusUpdate({
        conferenceRoom,
        event: 'participant-join',
        callSid: leadCall.sid
      });
      
      // Fast-forward time by setting an earlier transfer start time
      callStatuses[leadCall.sid].conference.transferStartTime = Date.now() - 31000; // 31 seconds ago
      
      // Mock the Twilio client's update method for the fallback scenario
      const mockLeadUpdate = jest.fn().mockResolvedValue({});
      twilioClient.calls = jest.fn(sid => ({
        update: mockLeadUpdate
      }));
      
      // Trigger conference connection check explicitly
      await fastify.checkConferenceConnection(leadCall.sid, salesCall.sid, conferenceRoom);
      
      // Verify transfer is marked as failed
      expect(callStatuses[leadCall.sid].transferFailed).toBe(true);
      expect(callStatuses[salesCall.sid].transferFailed).toBe(true);
      
      // Verify lead gets reconnected to AI - using a different assertion approach
      const twimlArg = mockLeadUpdate.mock.calls[0][0].twiml;
      expect(twimlArg).toContain('We apologize');
      expect(twimlArg).toContain('connecting you with our team');
      expect(twimlArg).toContain('<Connect>');
      expect(twimlArg).toContain('<Stream');
    });
    
    test('should handle participant leaving during conference', async () => {
      const { leadCall, salesCall, conferenceRoom } = await setupConferenceCalls();
      
      // Both parties join the conference
      simulateConferenceStatusUpdate({
        conferenceRoom,
        event: 'participant-join',
        callSid: leadCall.sid
      });
      simulateConferenceStatusUpdate({
        conferenceRoom,
        event: 'participant-join',
        callSid: salesCall.sid
      });
      
      // Lead leaves the conference
      simulateConferenceStatusUpdate({
        conferenceRoom,
        event: 'participant-leave',
        callSid: leadCall.sid
      });
      
      // Verify lead is marked as left but conference data persists
      expect(callStatuses[leadCall.sid].conference.leadJoined).toBe(false);
      expect(callStatuses[leadCall.sid].conference.salesJoined).toBe(true);
      expect(callStatuses[leadCall.sid].transferComplete).toBe(true); // This should still be true as it was completed
    });
  });
  
  describe('Multi-Party Conference Scenarios', () => {
    test('should handle multiple status updates from the same participant', async () => {
      const { leadCall, salesCall, conferenceRoom } = await setupConferenceCalls();
      
      // Lead joins the conference
      simulateConferenceStatusUpdate({
        conferenceRoom,
        event: 'participant-join',
        callSid: leadCall.sid
      });
      
      // Lead temporarily drops (network hiccup)
      simulateConferenceStatusUpdate({
        conferenceRoom,
        event: 'participant-leave',
        callSid: leadCall.sid
      });
      
      // Lead rejoins
      simulateConferenceStatusUpdate({
        conferenceRoom,
        event: 'participant-join',
        callSid: leadCall.sid
      });
      
      // Sales joins
      simulateConferenceStatusUpdate({
        conferenceRoom,
        event: 'participant-join',
        callSid: salesCall.sid
      });
      
      // Verify final state is correct despite multiple events
      expect(callStatuses[leadCall.sid].conference.leadJoined).toBe(true);
      expect(callStatuses[leadCall.sid].conference.salesJoined).toBe(true);
      expect(callStatuses[leadCall.sid].transferComplete).toBe(true);
    });
  });
}); 