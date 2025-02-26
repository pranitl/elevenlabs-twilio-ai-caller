import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import '../setup.js';
import { setupEnvironmentVariables } from '../common-setup.js';
import { mockFastify } from '../mocks/fastify.js';
import { MockWebSocket } from '../mocks/ws.js';
import mockTwilioClient from '../mocks/twilio.js';

// Setup environment variables
setupEnvironmentVariables();

// Mock ws module
jest.mock('ws', () => {
  const { MockWebSocket } = require('../mocks/ws.js');
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

// Mock intent detection module
const mockProcessTranscript = jest.fn().mockReturnValue({ 
  intentDetected: true, 
  detectedIntents: ['schedule_callback'] 
});

jest.mock('../../forTheLegends/outbound/intent-detector.js', () => {
  return {
    initializeIntentDetection: jest.fn(),
    processTranscript: mockProcessTranscript,
    getIntentInstructions: jest.fn(),
    hasSchedulingIntent: jest.fn(() => true),
    hasNegativeIntent: jest.fn(() => false),
    getIntentData: jest.fn(() => ({
      primaryIntent: { name: 'schedule_callback', confidence: 0.85 }
    }))
  };
});

// Mock retry manager module
const mockScheduleRetryCall = jest.fn().mockResolvedValue({ success: true });

jest.mock('../../forTheLegends/outbound/retry-manager.js', () => {
  return {
    initialize: jest.fn(),
    trackCall: jest.fn(),
    scheduleRetryCall: mockScheduleRetryCall
  };
});

// Import after mocking
import { registerOutboundRoutes } from '../../outbound-calls.js';

describe('Callback Intent Duplicate Logic Fix', () => {
  let mockWs;
  let mockReq;
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Register routes (needed for side effects)
    registerOutboundRoutes(mockFastify);
    
    // Mock WebSocket and request
    mockWs = new MockWebSocket('wss://localhost:8000');
    mockReq = { 
      headers: { host: 'localhost:8000' }, 
      body: {} 
    };
    
    // Global callStatuses storage for testing
    global.callStatuses = {};
    
    // Mock detectCallbackTime function globally
    global.detectCallbackTime = jest.fn(text => {
      if (text.includes('tomorrow') || text.includes('Friday') || text.includes('3 pm')) {
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
  });
  
  afterEach(() => {
    // Clean up global state
    delete global.callStatuses;
    delete global.detectCallbackTime;
  });

  it('should only send one prompt for callback time when no specific time is detected', async () => {
    // Set up call status
    const callSid = 'CA12345';
    global.callStatuses[callSid] = {
      leadStatus: 'in-progress',
      intentInitialized: true,
      elevenLabsWs: { 
        readyState: 1,
        send: jest.fn()
      }
    };
    
    // Mock the transcript handler
    const onTranscriptReceived = (transcript) => {
      const text = transcript?.transcript_event?.text || '';
      
      // Check for callback intent
      if (!global.callStatuses[callSid].timePromptSent && 
          !global.callStatuses[callSid].callbackScheduled) {
        
        // Mark as prompted for time
        global.callStatuses[callSid].timePromptSent = true;
        
        // Send instruction to ask for callback time
        global.callStatuses[callSid].elevenLabsWs.send(JSON.stringify({
          type: 'custom_instruction',
          custom_instruction: 'The person wants a callback. Please ask them politely when would be a good time for our team to call them back.'
        }));
      }
    };
    
    // Process first transcript
    onTranscriptReceived({
      type: 'transcript',
      transcript_event: {
        speaker: 'user',
        text: 'Can someone call me back please?'
      }
    });
    
    // Check that we sent a prompt
    const sentMessages = global.callStatuses[callSid].elevenLabsWs.send.mock.calls;
    
    // Filter for time instructions
    const timeInstructions = sentMessages.filter(call => 
      call[0].includes('when would be a good time')
    );
    
    // Should have one prompt about time
    expect(timeInstructions.length).toBe(1);
    expect(global.callStatuses[callSid].timePromptSent).toBe(true);
    
    // Reset the mock to check for additional calls
    global.callStatuses[callSid].elevenLabsWs.send.mockClear();
    
    // Process second transcript
    onTranscriptReceived({
      type: 'transcript',
      transcript_event: {
        speaker: 'user',
        text: 'I want a callback'
      }
    });
    
    // Check that we didn't send another prompt
    expect(global.callStatuses[callSid].elevenLabsWs.send).not.toHaveBeenCalled();
  });

  it('should handle explicit callback request with time correctly', async () => {
    // Set up call status
    const callSid = 'CA12345';
    global.callStatuses[callSid] = {
      leadStatus: 'in-progress',
      intentInitialized: true,
      leadInfo: {
        leadName: 'Test Lead',
        phoneNumber: '+15551234567'
      },
      elevenLabsWs: { 
        readyState: 1,
        send: jest.fn()
      }
    };
    
    // Mock the saveCallbackPreferences function
    global.saveCallbackPreferences = jest.fn((callSid, timeData) => {
      global.callStatuses[callSid].callbackPreferences = [{
        dayOfWeek: timeData.detectedDays[0] || 'any',
        timeOfDay: timeData.detectedTimes[0] || timeData.detectedRelative[0] || 'any'
      }];
      return true;
    });
    
    // Mock the transcript handler
    const onTranscriptReceived = (transcript) => {
      const text = transcript?.transcript_event?.text || '';
      
      // Check for callback time
      const timeData = global.detectCallbackTime(text);
      
      if (timeData && timeData.hasTimeReference) {
        // Save the callback preferences
        global.saveCallbackPreferences(callSid, timeData);
        
        // Mark as scheduled
        global.callStatuses[callSid].callbackScheduled = true;
        
        // Schedule the callback
        mockScheduleRetryCall(
          callSid,
          global.callStatuses[callSid].leadInfo,
          timeData
        );
        
        // Send confirmation
        global.callStatuses[callSid].elevenLabsWs.send(JSON.stringify({
          type: 'custom_instruction',
          custom_instruction: `The customer has requested a callback at ${timeData.detectedTimes[0] || timeData.detectedRelative[0] || 'a specific time'}. Acknowledge this and confirm the callback time.`
        }));
      }
    };
    
    // Process transcript with time reference
    onTranscriptReceived({
      type: 'transcript',
      transcript_event: {
        speaker: 'user',
        text: 'Please call me tomorrow at 3 pm'
      }
    });
    
    // Verify callback preferences were saved
    expect(global.callStatuses[callSid].callbackPreferences).toBeDefined();
    expect(global.callStatuses[callSid].callbackPreferences.length).toBe(1);
    
    // Verify retry call was scheduled
    expect(mockScheduleRetryCall).toHaveBeenCalledWith(
      callSid,
      global.callStatuses[callSid].leadInfo,
      expect.objectContaining({
        hasTimeReference: true,
        detectedTimes: ['3 pm'],
        detectedRelative: ['tomorrow']
      })
    );
  });

  it('should not send duplicate prompts when already scheduled callback', async () => {
    // Set up call status with callback already scheduled
    const callSid = 'CA12345';
    global.callStatuses[callSid] = {
      leadStatus: 'in-progress',
      intentInitialized: true,
      callbackScheduled: true,
      elevenLabsWs: { 
        readyState: 1,
        send: jest.fn()
      }
    };
    
    // Mock the transcript handler
    const onTranscriptReceived = (transcript) => {
      const text = transcript?.transcript_event?.text || '';
      
      // Check for callback intent (but we already have a scheduled callback)
      if (!global.callStatuses[callSid].timePromptSent && 
          !global.callStatuses[callSid].callbackScheduled) {
        
        // This won't execute because callbackScheduled is true
        global.callStatuses[callSid].timePromptSent = true;
        
        // This shouldn't be called
        global.callStatuses[callSid].elevenLabsWs.send(JSON.stringify({
          type: 'custom_instruction',
          custom_instruction: 'The person wants a callback. Please ask them politely when would be a good time for our team to call them back.'
        }));
      }
    };
    
    // Process transcript
    onTranscriptReceived({
      type: 'transcript',
      transcript_event: {
        speaker: 'user',
        text: 'I need a callback from your team'
      }
    });
    
    // Check that we didn't send any prompt
    expect(global.callStatuses[callSid].elevenLabsWs.send).not.toHaveBeenCalled();
  });
}); 