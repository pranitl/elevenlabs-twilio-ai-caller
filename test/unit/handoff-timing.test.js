/**
 * Test suite for handoff audio timing with conference events
 */
import { jest, describe, beforeEach, afterEach, test, expect } from '@jest/globals';
import { createMockFastify } from '../setup.js';
import { registerOutboundRoutes } from '../../outbound-calls.js';
import TwilioMock from '../mocks/twilio-mock.js';

// Mock the Twilio client
jest.mock('twilio', () => {
  const mockClient = {
    calls: {
      update: jest.fn().mockResolvedValue({})
    }
  };
  
  return jest.fn().mockImplementation(() => mockClient);
});

describe('Handoff Audio Timing with Conference Events', () => {
  let fastify;
  let twilio;
  
  beforeEach(() => {
    // Create a fresh fastify instance for each test
    fastify = createMockFastify();
    
    // Reset call statuses for each test
    global.resetCallStatuses();
    
    // Register the outbound routes
    registerOutboundRoutes(fastify);
    
    // Get the mocked Twilio client
    twilio = jest.requireMock('twilio')();
  });
  
  afterEach(() => {
    jest.clearAllMocks();
  });
  
  test('should store conference data when creating a conference', async () => {
    // Create mock calls
    const leadCallSid = 'CA12345';
    const salesCallSid = 'CA67890';
    
    // Register mock calls in the call statuses
    global.callStatuses[leadCallSid] = { 
      status: 'in-progress',
      salesCallSid: salesCallSid
    };
    
    global.callStatuses[salesCallSid] = { 
      status: 'in-progress',
      leadCallSid: leadCallSid
    };
    
    // Trigger conference creation by calling checkAndTransfer
    const response = await fastify.post('/check-and-transfer', {
      callSid: leadCallSid
    });
    
    // Verify conference data was created
    expect(global.callStatuses[leadCallSid].conference).toBeDefined();
    expect(global.callStatuses[leadCallSid].conference.room).toBeDefined();
    expect(global.callStatuses[leadCallSid].conference.transferStartTime).toBeDefined();
    expect(global.callStatuses[leadCallSid].conference.handoffAudioPlayed).toBe(false);
  });
  
  test('should play handoff audio when sales team joins conference', async () => {
    // Create mock calls
    const leadCallSid = 'CA12345';
    const salesCallSid = 'CA67890';
    const conferenceSid = 'CF12345';
    const conferenceRoom = `ConferenceRoom_${salesCallSid}`;
    
    // Setup mock call statuses
    global.callStatuses[leadCallSid] = {
      status: 'in-progress',
      salesCallSid: salesCallSid,
      conference: {
        room: conferenceRoom,
        transferStartTime: Date.now(),
        leadJoined: true,
        salesJoined: false,
        handoffAudioPlayed: false
      }
    };
    
    // Trigger conference participant join event for sales team
    const response = await fastify.post('/conference-status', {
      ConferenceSid: conferenceSid,
      FriendlyName: conferenceRoom,
      StatusCallbackEvent: 'participant-join',
      CallSid: salesCallSid
    });
    
    // Verify handoff audio was triggered
    expect(twilio.calls.update).toHaveBeenCalledWith(leadCallSid, {
      twiml: expect.stringContaining('<Play>handoff.mp3</Play>')
    });
    
    // Verify handoff audio status was updated
    expect(global.callStatuses[leadCallSid].conference.handoffAudioPlayed).toBe(true);
  });
  
  test('should not play handoff audio if already played', async () => {
    // Create mock calls
    const leadCallSid = 'CA12345';
    const salesCallSid = 'CA67890';
    const conferenceSid = 'CF12345';
    const conferenceRoom = `ConferenceRoom_${salesCallSid}`;
    
    // Setup mock call statuses with handoff already played
    global.callStatuses[leadCallSid] = {
      status: 'in-progress',
      salesCallSid: salesCallSid,
      conference: {
        room: conferenceRoom,
        transferStartTime: Date.now(),
        leadJoined: true,
        salesJoined: true,
        handoffAudioPlayed: true
      }
    };
    
    // Trigger conference participant join event again
    const response = await fastify.post('/conference-status', {
      ConferenceSid: conferenceSid,
      FriendlyName: conferenceRoom,
      StatusCallbackEvent: 'participant-join',
      CallSid: salesCallSid
    });
    
    // Verify handoff audio was not triggered again
    expect(twilio.calls.update).not.toHaveBeenCalled();
  });
}); 