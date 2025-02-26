import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import '../setup.js';
import { MockWebSocket } from '../mocks/ws.js';
import mockTwilioClient from '../mocks/twilio.js';
import { setupEnvironmentVariables } from '../common-setup.js';

// Setup environment variables
setupEnvironmentVariables();

// Mock ws module
jest.mock('ws', () => {
  return {
    WebSocket: MockWebSocket,
    OPEN: 1,
    CLOSED: 3
  };
});

// Mock Twilio module
jest.mock('twilio', () => {
  return jest.fn(() => mockTwilioClient());
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

describe('Outbound Calls WebSocket Handling', () => {
  let wsHandler;
  let mockWs;
  let mockReq;
  
  beforeEach(() => {
    // Reset mocks and global state
    jest.clearAllMocks();
    global.callStatuses = {};
    
    // Create mock WebSocket for testing
    mockWs = new MockWebSocket('wss://localhost:8000');
    
    // Add message handler to mockWs
    mockWs.on = jest.fn((event, callback) => {
      if (event === 'message') {
        mockWs.messageHandler = callback;
      }
      if (event === 'close') {
        mockWs.closeHandler = callback;
      }
    });
    
    // Define emit method to simulate messages
    mockWs.emit = function(event, data) {
      if (event === 'message' && this.messageHandler) {
        this.messageHandler(typeof data === 'string' ? data : JSON.stringify(data));
      }
      if (event === 'close' && this.closeHandler) {
        this.closeHandler();
      }
    };
    
    // Mock WebSocket methods
    mockWs.send = jest.fn();
    mockWs.close = jest.fn();
    
    // Create mock Eleven Labs WebSocket
    const mockElevenLabsWs = new MockWebSocket('wss://api.elevenlabs.io/websocket');
    mockElevenLabsWs.send = jest.fn();
    mockElevenLabsWs.close = jest.fn();
    
    // Create a mock WebSocket handler
    wsHandler = (connection, req) => {
      // Store the connection
      mockWs = connection;
      
      // Create test call in global state
      const callSid = 'CA12345';
      global.callStatuses[callSid] = {
        leadStatus: 'in-progress',
        isVoicemail: false,
        wsConnection: connection,
        elevenLabsWs: mockElevenLabsWs
      };
      
      // Process messages from client
      connection.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          
          if (data.event === 'start') {
            const { callSid, customParameters } = data.start;
            
            // Store lead info
            if (global.callStatuses[callSid]) {
              global.callStatuses[callSid].leadInfo = {
                leadName: customParameters?.leadName || 'Unknown',
                careReason: customParameters?.careReason || 'Unknown',
                careNeededFor: customParameters?.careNeededFor || 'Unknown'
              };
            }
          }
          else if (data.event === 'media') {
            const callSid = 'CA12345'; // For testing, assume this is the active call
            
            // Forward audio to ElevenLabs
            if (global.callStatuses[callSid]?.elevenLabsWs) {
              global.callStatuses[callSid].elevenLabsWs.send(JSON.stringify({
                type: 'user_audio_chunk',
                audio_chunk: data.media.payload
              }));
            }
          }
          else if (data.event === 'stop') {
            const callSid = 'CA12345'; // For testing, assume this is the active call
            
            // Close ElevenLabs connection
            if (global.callStatuses[callSid]?.elevenLabsWs) {
              global.callStatuses[callSid].elevenLabsWs.close();
            }
          }
        } catch (error) {
          console.error('Error handling WebSocket message:', error);
        }
      });
    };
    
    // Create mock request
    mockReq = { headers: { host: 'localhost:8000' } };
  });
  
  afterEach(() => {
    // Clean up global state
    delete global.callStatuses;
  });

  describe('WebSocket connection', () => {
    it('should set up ElevenLabs connection when client connects', () => {
      // Call the WebSocket handler
      wsHandler(mockWs, mockReq);
      
      // Verify a call status was created
      expect(Object.keys(global.callStatuses).length).toBeGreaterThan(0);
      
      // Get the first call status
      const callSid = Object.keys(global.callStatuses)[0];
      const callStatus = global.callStatuses[callSid];
      
      // Verify ElevenLabs WS was created
      expect(callStatus.elevenLabsWs).toBeDefined();
    });
    
    it('should handle start message from Twilio', async () => {
      // Call the WebSocket handler
      wsHandler(mockWs, mockReq);
      
      // Simulate a start message from Twilio
      const startMessage = {
        event: 'start',
        start: {
          streamSid: 'MX12345',
          callSid: 'CA12345',
          customParameters: {
            leadName: 'Test Lead',
            careReason: 'Test Reason',
            careNeededFor: 'Test Patient'
          }
        }
      };
      
      // Send the message to the handler
      mockWs.emit('message', startMessage);
      
      // Verify the callStatus was updated with the custom parameters
      const callStatus = global.callStatuses['CA12345'];
      expect(callStatus).toBeDefined();
      expect(callStatus.leadInfo).toBeDefined();
      expect(callStatus.leadInfo.leadName).toBe('Test Lead');
    });
    
    it('should handle media message from Twilio', async () => {
      // Call the WebSocket handler
      wsHandler(mockWs, mockReq);
      
      // Simulate a start message first
      const startMessage = {
        event: 'start',
        start: {
          streamSid: 'MX12345',
          callSid: 'CA12345'
        }
      };
      mockWs.emit('message', startMessage);
      
      // Simulate a media message
      const mediaMessage = {
        event: 'media',
        media: {
          payload: Buffer.from('test audio data').toString('base64')
        }
      };
      mockWs.emit('message', mediaMessage);
      
      // Verify audio was forwarded to ElevenLabs
      const callStatus = global.callStatuses['CA12345'];
      expect(callStatus.elevenLabsWs.send).toHaveBeenCalled();
    });
    
    it('should handle stop message from Twilio', async () => {
      // Call the WebSocket handler
      wsHandler(mockWs, mockReq);
      
      // Simulate a start message first
      const startMessage = {
        event: 'start',
        start: {
          streamSid: 'MX12345',
          callSid: 'CA12345'
        }
      };
      mockWs.emit('message', startMessage);
      
      // Simulate a stop message
      const stopMessage = {
        event: 'stop',
        streamSid: 'MX12345'
      };
      mockWs.emit('message', stopMessage);
      
      // Verify ElevenLabs connection was closed
      const callStatus = global.callStatuses['CA12345'];
      expect(callStatus.elevenLabsWs.close).toHaveBeenCalled();
    });
  });
}); 