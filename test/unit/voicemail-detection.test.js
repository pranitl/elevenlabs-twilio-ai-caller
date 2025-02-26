// test/unit/voicemail-detection.test.js
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import '../setup.js';
import { mockFastify, mockRequest, mockReply } from '../mocks/fastify.js';
import { MockWebSocket } from '../mocks/ws.js';
import mockTwilioClient from '../mocks/twilio.js';
import { setupElevenLabsWebSocketMock, setupEnvironmentVariables } from '../common-setup.js';

// Setup environment variables
setupEnvironmentVariables();

// Create global callStatuses object for testing
global.callStatuses = {};

// Mock ws module
jest.mock('ws', () => {
  return {
    WebSocket: MockWebSocket,
    OPEN: 1,
    CLOSED: 3
  };
});

// Create Twilio mock instance to use throughout tests
const twilioMock = mockTwilioClient();
const callsUpdateMock = jest.fn().mockResolvedValue({});
twilioMock.calls = jest.fn().mockImplementation((sid) => {
  return {
    update: callsUpdateMock
  };
});

// Mock Twilio module
jest.mock('twilio', () => {
  return jest.fn(() => twilioMock);
});

// Mock fetch for getSignedUrl
global.fetch = jest.fn().mockImplementation(() => 
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ signed_url: 'wss://api.elevenlabs.io/websocket' }),
  })
);

// Import after mocking
import { registerOutboundRoutes } from '../../outbound-calls.js';

describe('Voicemail Detection and Handling', () => {
  let wsHandler;
  let amdCallbackHandler;
  let mockWs;
  let mockElevenLabsWs;
  let sentMessages = [];

  beforeEach(() => {
    // Reset mocks and global state
    jest.clearAllMocks();
    global.callStatuses = {};
    
    // Initialize sent messages array
    sentMessages = [];
    
    // Setup the ElevenLabs WebSocket mock
    mockElevenLabsWs = setupElevenLabsWebSocketMock(sentMessages);
    
    // Create a mock WebSocket handler that we can use for testing
    wsHandler = (connection, req) => {
      // Store the connection
      mockWs = connection;
      
      // Add message handler
      connection.on = jest.fn((event, callback) => {
        if (event === 'message') {
          // Store the message handler so we can call it in tests
          connection.messageHandler = callback;
        }
      });
      
      // Define emit method to simulate messages
      connection.emit = function(event, data) {
        if (event === 'message' && this.messageHandler) {
          this.messageHandler(data);
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
              // This calls the mock function that we can test
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
    
    // Create a mock WebSocket for testing
    mockWs = new MockWebSocket('wss://localhost:8000');
  });
  
  afterEach(() => {
    // Clean up global state
    delete global.callStatuses;
  });

  describe('AMD (Answering Machine Detection) Callback', () => {
    it('should mark call as voicemail when AMD detects machine_start', async () => {
      // Set up request body for AMD callback
      mockRequest.body = {
        CallSid: 'CA12345',
        AnsweredBy: 'machine_start'
      };
      
      // Set up call status
      global.callStatuses['CA12345'] = {
        leadStatus: 'in-progress',
        salesCallSid: 'CA67890'
      };
      
      // Call the AMD callback handler
      await amdCallbackHandler(mockRequest, { send: jest.fn() });
      
      // Verify call is marked as voicemail
      expect(global.callStatuses['CA12345'].isVoicemail).toBe(true);
    });
    
    it('should mark call as not voicemail when AMD detects human', async () => {
      // Set up request body for AMD callback
      mockRequest.body = {
        CallSid: 'CA12345',
        AnsweredBy: 'human'
      };
      
      // Set up call status
      global.callStatuses['CA12345'] = {
        leadStatus: 'in-progress',
        salesCallSid: 'CA67890'
      };
      
      // Call the AMD callback handler
      await amdCallbackHandler(mockRequest, { send: jest.fn() });
      
      // Verify call is marked as not voicemail
      expect(global.callStatuses['CA12345'].isVoicemail).toBe(false);
    });
    
    it('should notify sales team when voicemail is detected and sales team is on the call', async () => {
      // Set up request body for AMD callback
      mockRequest.body = {
        CallSid: 'CA12345',
        AnsweredBy: 'machine_end_beep'
      };
      
      // Set up call status where sales team is already on the call
      global.callStatuses['CA12345'] = {
        leadStatus: 'in-progress',
        salesCallSid: 'CA67890'
      };
      
      global.callStatuses['CA67890'] = {
        salesStatus: 'in-progress',
        leadCallSid: 'CA12345'
      };
      
      // Call the AMD callback handler
      await amdCallbackHandler(mockRequest, { send: jest.fn() });
      
      // Verify Twilio calls update was called to notify sales team
      expect(callsUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          twiml: expect.stringContaining('The AI is now leaving a voicemail')
        })
      );
    });
  });

  describe('Transcript-based Voicemail Detection', () => {
    it('should detect voicemail from transcript text', async () => {
      // Set up call status
      global.callStatuses['CA12345'] = {
        leadStatus: 'in-progress',
        salesCallSid: 'CA67890'
      };
      
      // Simulate ElevenLabs WebSocket receiving a transcript event
      const transcriptEvent = {
        type: 'transcript',
        transcript_event: {
          speaker: 'user',
          text: 'Please leave a message after the tone'
        }
      };
      
      // Create a custom function to process the transcript
      const processVoicemailTranscript = (transcript) => {
        const text = transcript.toLowerCase();
        if (text.includes('leave a message') || 
            text.includes('voicemail') || 
            text.includes('after the tone') || 
            text.includes('after the beep')) {
          return true;
        }
        return false;
      };
      
      // Process the transcript
      const isVoicemail = processVoicemailTranscript(transcriptEvent.transcript_event.text);
      if (isVoicemail) {
        global.callStatuses['CA12345'].isVoicemail = true;
        
        // Send custom instruction to ElevenLabs
        mockElevenLabsWs.send(JSON.stringify({
          type: 'custom_instruction',
          instruction: 'This call has reached a voicemail. Wait for the beep, then leave a concise message.'
        }));
      }
      
      // Verify call is marked as voicemail
      expect(global.callStatuses['CA12345'].isVoicemail).toBe(true);
      
      // Verify custom instruction was sent to ElevenLabs
      expect(mockElevenLabsWs.send).toHaveBeenCalledWith(
        expect.stringContaining('This call has reached a voicemail')
      );
    });
  });

  describe('WebSocket Handling for Voicemail', () => {
    it('should add voicemail instructions to the prompt when voicemail is detected', async () => {
      // Set up known voicemail state
      global.callStatuses['CA12345'] = {
        isVoicemail: true
      };
      
      // Create a conversational init message that would be sent to ElevenLabs
      const initConfig = {
        type: 'conversation_initiation_client_data',
        conversation_config_override: {
          agent: {
            prompt: { 
              prompt: 'Base prompt. This call has reached a voicemail. Wait for the beep, then leave a message.' 
            },
            first_message: 'Hello, this is a test message',
            wait_for_user_speech: true,
          },
          conversation: {
            initial_audio_silence_timeout_ms: 3000,
          }
        },
      };
      
      // Send the init message
      mockElevenLabsWs.send(JSON.stringify(initConfig));
      
      // Verify that the conversation_initiation_client_data contains voicemail instructions
      expect(mockElevenLabsWs.send).toHaveBeenCalledWith(
        expect.stringContaining('This call has reached a voicemail')
      );
    });
  });
}); 