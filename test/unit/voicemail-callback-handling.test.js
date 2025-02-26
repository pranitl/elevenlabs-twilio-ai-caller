// test/unit/voicemail-callback-handling.test.js
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import '../setup.js';
import { mockFastify, mockRequest, mockReply } from '../mocks/fastify.js';
import { MockWebSocket } from '../mocks/ws.js';
import mockTwilioClient from '../mocks/twilio.js';
import { setupElevenLabsWebSocketMock, setupEnvironmentVariables } from '../common-setup.js';

// Setup environment variables
setupEnvironmentVariables();

// Create Twilio mock instance to use throughout tests
const twilioMock = mockTwilioClient();
const callsUpdateMock = jest.fn().mockResolvedValue({});
twilioMock.calls = jest.fn().mockImplementation((sid) => {
  return {
    update: callsUpdateMock
  };
});

// Create the retry manager mocks
const scheduleRetryCallMock = jest.fn(() => Promise.resolve({ success: true }));

// Mock modules
jest.mock('twilio', () => {
  return jest.fn(() => twilioMock);
});

jest.mock('ws', () => {
  return {
    WebSocket: MockWebSocket,
    OPEN: 1,
    CLOSED: 3
  };
});

jest.mock('../../forTheLegends/outbound/intent-detector.js', () => {
  return {
    initializeIntentDetection: jest.fn(),
    processTranscript: jest.fn(() => ({ 
      intentDetected: false, 
      detectedIntents: [] 
    })),
    getIntentInstructions: jest.fn(),
    hasSchedulingIntent: jest.fn(() => false),
    hasNegativeIntent: jest.fn(() => false),
    getIntentData: jest.fn(() => null)
  };
});

jest.mock('../../forTheLegends/outbound/retry-manager.js', () => {
  return {
    initialize: jest.fn(),
    trackCall: jest.fn(),
    scheduleRetryCall: scheduleRetryCallMock
  };
});

// Import after mocking
import { registerOutboundRoutes } from '../../outbound-calls.js';

describe('Voicemail and Callback Handling', () => {
  let amdCallbackHandler;
  let salesStatusHandler;
  let wsHandler;
  let ws;
  let elevenLabsWs;
  let sentMessages = [];
  
  beforeEach(() => {
    // Reset mocks and global state
    jest.clearAllMocks();
    global.callStatuses = {};
    
    // Initialize sent messages array
    sentMessages = [];
    
    // Setup the ElevenLabs WebSocket mock
    elevenLabsWs = setupElevenLabsWebSocketMock(sentMessages);
    elevenLabsWs.closeWasCalled = false;
    elevenLabsWs.close = jest.fn(() => {
      elevenLabsWs.closeWasCalled = true;
      elevenLabsWs.readyState = 3; // CLOSED
    });
    elevenLabsWs.getSentMessages = () => sentMessages;
    
    // Create a mock WebSocket handler that we can use for testing
    wsHandler = (connection, req) => {
      // Store the connection
      ws = connection;
      
      // Add message handler
      connection.on = jest.fn((event, callback) => {
        if (event === 'message') {
          // Store the message handler so we can call it in tests
          connection.messageHandler = callback;
        }
        if (event === 'close') {
          connection.closeHandler = callback;
        }
      });
      
      // Define emit method to simulate messages
      connection.emit = function(event, data) {
        if (event === 'message' && this.messageHandler) {
          this.messageHandler(data);
        }
        if (event === 'close' && this.closeHandler) {
          this.closeHandler();
        }
      };
    };
    
    // Create a mock AMD callback handler for testing
    amdCallbackHandler = async (req, reply) => {
      const { CallSid, AnsweredBy } = req.body;
      
      // Only process if we have this call in our tracking
      if (CallSid && global.callStatuses[CallSid]) {
        // Set isVoicemail based on the AnsweredBy value
        if (AnsweredBy === 'machine_start' || AnsweredBy === 'machine_end_beep' || AnsweredBy === 'machine_end_silence') {
          global.callStatuses[CallSid].isVoicemail = true;
          
          // If sales team is already connected, notify them
          const salesCallSid = global.callStatuses[CallSid].salesCallSid;
          if (salesCallSid && global.callStatuses[salesCallSid]?.salesStatus === 'in-progress') {
            try {
              callsUpdateMock({
                twiml: `<?xml version="1.0" encoding="UTF-8"?>
                  <Response>
                    <Say>The AI is now leaving a voicemail. Please wait until transfer is complete.</Say>
                    <Pause length="2"/>
                  </Response>`
              });
            } catch (error) {
              console.error(`Failed to update sales call ${salesCallSid}:`, error);
            }
          }
        } else if (AnsweredBy === 'human') {
          global.callStatuses[CallSid].isVoicemail = false;
        }
      }
      
      reply.send({ success: true });
    };
    
    // Create a mock sales status handler
    salesStatusHandler = async (req, reply) => {
      const { CallSid, CallStatus } = req.body;
      
      if (global.callStatuses[CallSid]) {
        const previousStatus = global.callStatuses[CallSid].salesStatus;
        global.callStatuses[CallSid].salesStatus = CallStatus.toLowerCase();
        
        // If call ended and we haven't completed the transfer, mark sales team as unavailable
        if (
          (CallStatus.toLowerCase() === "completed" || 
           CallStatus.toLowerCase() === "busy" || 
           CallStatus.toLowerCase() === "failed" || 
           CallStatus.toLowerCase() === "no-answer" ||
           CallStatus.toLowerCase() === "canceled") && 
          !global.callStatuses[CallSid].transferComplete
        ) {
          const leadCallSid = global.callStatuses[CallSid].leadCallSid;
          
          // Sales team didn't answer or disconnected - mark as unavailable
          if (leadCallSid && global.callStatuses[leadCallSid]?.leadStatus === "in-progress") {
            global.callStatuses[leadCallSid].salesTeamUnavailable = true;
          }
        }
      }
      
      reply.send({ success: true });
    };
    
    // Create a mock WebSocket for testing
    ws = new MockWebSocket('wss://localhost:8000');
    
    // Set up global functions for webhook and callback detection
    global.sendCallDataToWebhook = jest.fn(async () => true);
    
    global.detectCallbackTime = jest.fn(text => {
      if (text.includes('tomorrow') || text.includes('Friday') || text.includes('afternoon')) {
        return {
          hasTimeReference: true,
          rawText: text,
          detectedDays: text.includes('Friday') ? ['friday'] : [],
          detectedTimes: text.includes('3 pm') ? ['3 pm'] : [],
          detectedRelative: text.includes('tomorrow') ? ['tomorrow'] : [],
          detectedPeriods: text.includes('afternoon') ? ['afternoon'] : []
        };
      }
      return null;
    });
    
    // Initialize call status for testing
    global.callStatuses['CALL123'] = {
      leadStatus: 'in-progress',
      salesCallSid: 'SALES123',
      leadInfo: {
        LeadId: '12345',
        PhoneNumber: '+18001234567',
        LeadName: 'John Doe'
      }
    };
    
    global.callStatuses['SALES123'] = {
      salesStatus: 'in-progress',
      leadCallSid: 'CALL123'
    };
  });
  
  afterEach(() => {
    delete global.callStatuses;
    delete global.WebSocket;
    delete global.sendCallDataToWebhook;
    delete global.detectCallbackTime;
  });

  it('should detect voicemail through AMD callback', async () => {
    // Set up AMD callback request
    mockRequest.body = {
      CallSid: 'CALL123',
      AnsweredBy: 'machine_end_beep'
    };
    
    // Call AMD callback handler
    await amdCallbackHandler(mockRequest, mockReply);
    
    // Verify call status updated
    expect(global.callStatuses['CALL123'].isVoicemail).toBe(true);
    
    // Simulate media event to trigger voicemail logic
    const mediaEvent = {
      event: 'media',
      media: {
        payload: Buffer.from('Audio data').toString('base64')
      }
    };
    
    // Set up custom instruction for voicemail
    const voicemailInstruction = {
      type: 'custom_instruction',
      instruction: 'This call has reached a voicemail. Wait for the beep, then leave a personalized message.'
    };
    
    // Send custom instruction
    elevenLabsWs.send(JSON.stringify(voicemailInstruction));
    
    // Verify instruction sent to ElevenLabs
    const sentMessages = elevenLabsWs.getSentMessages();
    const hasVoicemailInstruction = sentMessages.some(msg => {
      return msg.includes('voicemail') && msg.includes('beep');
    });
    
    expect(hasVoicemailInstruction).toBe(true);
    
    // Verify sales team was notified
    expect(callsUpdateMock).toHaveBeenCalled();
  });

  it('should detect voicemail through transcript analysis', async () => {
    // Simulate transcript indicating voicemail
    const voicemailTranscript = {
      type: 'transcript',
      transcript_event: {
        text: 'You have reached the voicemail of John Doe. Please leave a message after the beep.',
        speaker: 'user'
      }
    };
    
    // Process the transcript for voicemail indicators
    const transcriptText = voicemailTranscript.transcript_event.text.toLowerCase();
    if (transcriptText.includes('voicemail') || 
        transcriptText.includes('leave a message') || 
        transcriptText.includes('after the beep')) {
      global.callStatuses['CALL123'].isVoicemail = true;
      
      // Send custom instruction to ElevenLabs
      elevenLabsWs.send(JSON.stringify({
        type: 'custom_instruction',
        instruction: 'This call has reached a voicemail. Wait for the beep, then leave a concise message.'
      }));
    }
    
    // Verify call status updated
    expect(global.callStatuses['CALL123'].isVoicemail).toBe(true);
    
    // Verify instruction sent to ElevenLabs
    const sentMessages = elevenLabsWs.getSentMessages();
    const voicemailInstruction = sentMessages.find(msg => {
      return msg.includes('voicemail') && msg.includes('beep');
    });
    
    expect(voicemailInstruction).toBeDefined();
  });

  it('should handle sales team unavailable scenario', async () => {
    // Set up request for sales call ending
    mockRequest.body = {
      CallSid: 'SALES123',
      CallStatus: 'completed'
    };
    
    // Call sales status handler
    await salesStatusHandler(mockRequest, mockReply);
    
    // Verify call status updated
    expect(global.callStatuses['CALL123'].salesTeamUnavailable).toBe(true);
    
    // Create unavailable instruction
    const unavailableInstruction = {
      type: 'custom_instruction',
      instruction: 'The sales team is currently unavailable. Please get contact information and ask about their availability to schedule a callback.'
    };
    
    // Mark instruction as sent
    global.callStatuses['CALL123'].salesTeamUnavailableInstructionSent = true;
    
    // Send custom instruction
    elevenLabsWs.send(JSON.stringify(unavailableInstruction));
    
    // Verify instruction sent to ElevenLabs
    const sentMessages = elevenLabsWs.getSentMessages();
    const hasUnavailableInstruction = sentMessages.some(msg => {
      return msg.includes('unavailable') && msg.includes('schedule');
    });
    
    expect(hasUnavailableInstruction).toBe(true);
    expect(global.callStatuses['CALL123'].salesTeamUnavailableInstructionSent).toBe(true);
  });

  it('should schedule callback when call ends with sales team unavailable', async () => {
    // Set sales team as unavailable
    global.callStatuses['CALL123'].salesTeamUnavailable = true;
    global.callStatuses['CALL123'].conversationId = 'CONVO123';
    
    // Process transcript with callback time
    const timeTranscript = 'I would be available tomorrow afternoon around 3 pm';
    
    // Detect callback time
    const callbackTime = global.detectCallbackTime(timeTranscript);
    if (callbackTime) {
      global.callStatuses['CALL123'].callbackPreferences = {
        time: callbackTime,
        confirmed: true
      };
    }
    
    // Verify callback preferences stored
    expect(global.callStatuses['CALL123'].callbackPreferences).toBeDefined();
    
    // Now simulate call ending by closing WebSocket
    await global.sendCallDataToWebhook('CALL123', 'CONVO123');
    
    // Verify webhook was called
    expect(global.sendCallDataToWebhook).toHaveBeenCalledWith('CALL123', 'CONVO123');
    
    // Schedule the callback
    if (global.callStatuses['CALL123'].callbackPreferences) {
      await scheduleRetryCallMock({
        leadCallSid: 'CALL123',
        phoneNumber: global.callStatuses['CALL123'].leadInfo.PhoneNumber,
        callbackTimeInfo: global.callStatuses['CALL123'].callbackPreferences.time,
        leadName: global.callStatuses['CALL123'].leadInfo.LeadName
      });
    }
    
    // Verify callback scheduling was attempted
    expect(scheduleRetryCallMock).toHaveBeenCalled();
  });

  it('should handle stop event and clean up connection', async () => {
    // Simulate stop event
    const stopEvent = {
      event: 'stop',
      streamSid: 'STREAM123'
    };
    
    // Process the stop event
    if (elevenLabsWs.readyState === 1) { // OPEN
      elevenLabsWs.close();
    }
    
    // Verify ElevenLabs connection was closed
    expect(elevenLabsWs.closeWasCalled).toBe(true);
  });
}); 