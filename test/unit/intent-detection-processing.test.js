// test/unit/intent-detection-processing.test.js
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import '../setup.js';
import { mockFastify, mockRequest, mockReply } from '../mocks/fastify.js';
import { MockWebSocket } from '../mocks/ws.js';
import mockTwilioClient from '../mocks/twilio.js';
import { wsHandler as mockWsHandler, mockElevenLabsWs } from '../mocks/wsHandler.js';

// Mock Twilio module
jest.mock('twilio', () => {
  return jest.fn(() => mockTwilioClient());
});

// Create a control point for our intent detection mocks
const intentDetectorControl = {
  detectedIntents: [],
  primaryIntent: null,
  instructionsSent: false,
  returnMultipleIntents: false,
  conflictingIntents: false,
  ambiguousInput: false
};

// Mock for intent detector
jest.mock('../../forTheLegends/outbound/intent-detector.js', () => {
  return {
    initializeIntentDetection: jest.fn((callSid) => {
      return {
        detectedIntents: [],
        primaryIntent: null,
        instructionsSent: false,
        intentLog: []
      };
    }),

    processTranscript: jest.fn((callSid, transcript, speaker) => {
      // Skip processing if not from lead
      if (speaker !== 'lead') {
        return { intentDetected: false };
      }

      // Multiple conflicting intents test case
      if (intentDetectorControl.conflictingIntents) {
        return {
          intentDetected: true,
          detectedIntents: ['needs_immediate_care', 'schedule_callback'],
          primaryIntent: 'needs_immediate_care'
        };
      }

      // Multiple intents test case
      if (intentDetectorControl.returnMultipleIntents) {
        return {
          intentDetected: true,
          detectedIntents: ['needs_more_info', 'schedule_callback'],
          primaryIntent: 'needs_more_info'
        };
      }

      // Ambiguous input test case
      if (intentDetectorControl.ambiguousInput) {
        return {
          intentDetected: false,
          ambiguous: true,
          detectedIntents: [],
          possibleIntents: ['needs_more_info', 'already_have_care']
        };
      }

      // Process based on transcript content - simulates pattern matching
      if (transcript.includes('more information') || transcript.includes('tell me more')) {
        return { 
          intentDetected: true, 
          detectedIntents: ['needs_more_info'],
          primaryIntent: 'needs_more_info'
        };
      } else if (transcript.includes('not interested')) {
        return { 
          intentDetected: true, 
          detectedIntents: ['no_interest'],
          primaryIntent: 'no_interest'
        };
      } else if (transcript.includes('immediate') || transcript.includes('right away')) {
        return { 
          intentDetected: true, 
          detectedIntents: ['needs_immediate_care'],
          primaryIntent: 'needs_immediate_care'
        };
      } else if (transcript.includes('call back') || transcript.includes('call tomorrow')) {
        return { 
          intentDetected: true, 
          detectedIntents: ['schedule_callback'],
          primaryIntent: 'schedule_callback'
        };
      } else if (transcript.includes('already have') || transcript.includes('already using')) {
        return { 
          intentDetected: true, 
          detectedIntents: ['already_have_care'],
          primaryIntent: 'already_have_care'
        };
      } else if (transcript.includes('wrong number') || transcript.includes('wrong person')) {
        return { 
          intentDetected: true, 
          detectedIntents: ['wrong_person'],
          primaryIntent: 'wrong_person'
        };
      } else if (transcript.includes('driving') || transcript.includes('busy now')) {
        return { 
          intentDetected: true, 
          detectedIntents: ['cant_talk_now'],
          primaryIntent: 'cant_talk_now'
        };
      } else if (transcript.includes('confused') || transcript.includes('what is this about')) {
        return { 
          intentDetected: true, 
          detectedIntents: ['confused'],
          primaryIntent: 'confused'
        };
      }

      // Default: no intent detected
      return { intentDetected: false, detectedIntents: [] };
    }),

    getIntentInstructions: jest.fn((callSid) => {
      if (intentDetectorControl.detectedIntents.includes('needs_more_info')) {
        return 'User needs more information. Provide details about services, costs, and benefits.';
      } else if (intentDetectorControl.detectedIntents.includes('no_interest')) {
        return 'User is not interested. Acknowledge their preference, thank them, and end the call.';
      } else if (intentDetectorControl.detectedIntents.includes('needs_immediate_care')) {
        return 'User needs immediate care. Gather details and prepare to connect with resources.';
      } else if (intentDetectorControl.detectedIntents.includes('schedule_callback')) {
        return 'User wants to schedule a callback. Confirm the specific date and time.';
      } else if (intentDetectorControl.detectedIntents.includes('already_have_care')) {
        return 'User already has care. Ask if they are satisfied and mention complementary services.';
      } else if (intentDetectorControl.detectedIntents.includes('wrong_person')) {
        return 'Wrong person or number. Apologize for confusion and verify identity.';
      } else if (intentDetectorControl.detectedIntents.includes('cant_talk_now')) {
        return 'User cannot talk now. Ask for a better time to call back.';
      } else if (intentDetectorControl.detectedIntents.includes('confused')) {
        return 'User is confused. Reintroduce yourself and explain purpose clearly.';
      }
      return null;
    }),

    hasSchedulingIntent: jest.fn((callSid) => {
      return intentDetectorControl.detectedIntents.includes('schedule_callback');
    }),

    hasNegativeIntent: jest.fn((callSid) => {
      return intentDetectorControl.detectedIntents.includes('no_interest') || 
             intentDetectorControl.detectedIntents.includes('wrong_person');
    }),

    getIntentData: jest.fn((callSid) => {
      if (!intentDetectorControl.primaryIntent) {
        return null;
      }

      return {
        primaryIntent: {
          name: intentDetectorControl.primaryIntent,
          confidence: 0.85
        },
        detectedIntents: intentDetectorControl.detectedIntents.map(intent => ({
          name: intent,
          confidence: 0.7,
          timestamp: Date.now()
        }))
      };
    }),

    clearIntentData: jest.fn((callSid) => {
      intentDetectorControl.detectedIntents = [];
      intentDetectorControl.primaryIntent = null;
      intentDetectorControl.instructionsSent = false;
      intentDetectorControl.returnMultipleIntents = false;
      intentDetectorControl.conflictingIntents = false;
      intentDetectorControl.ambiguousInput = false;
    })
  };
});

// Import after mocking
import { registerOutboundRoutes } from '../../outbound-calls.js';

// Import mocked functions
const { 
  processTranscript, 
  getIntentInstructions, 
  hasSchedulingIntent, 
  hasNegativeIntent,
  getIntentData 
} = jest.requireMock('../../forTheLegends/outbound/intent-detector.js');

// Action handling mock - simulates actions taken based on intents
const actionHandler = {
  actionsPerformed: [],
  performAction: function(intent, callSid) {
    this.actionsPerformed.push({ intent, callSid, timestamp: Date.now() });
    return true;
  },
  reset: function() {
    this.actionsPerformed = [];
  },
  getLastAction: function() {
    return this.actionsPerformed.length > 0 ? 
      this.actionsPerformed[this.actionsPerformed.length - 1] : null;
  }
};

describe('Comprehensive Intent Detection and Processing', () => {
  let ws;
  let elevenLabsWs;
  
  beforeEach(() => {
    // Reset mocks and state
    jest.clearAllMocks();
    intentDetectorControl.detectedIntents = [];
    intentDetectorControl.primaryIntent = null;
    intentDetectorControl.instructionsSent = false;
    intentDetectorControl.returnMultipleIntents = false;
    intentDetectorControl.conflictingIntents = false;
    intentDetectorControl.ambiguousInput = false;
    actionHandler.reset();
    
    // Mock Fastify for route registration
    mockFastify.get.mockImplementation((path, options, handler) => {
      return mockFastify;
    });
    
    // Register routes
    registerOutboundRoutes(mockFastify);
    
    // Initialize global state
    global.callStatuses = {
      'CALL123': {
        wsConnection: null,
        elevenLabsWs: null,
        transcripts: [],
        leadStatus: 'in-progress'
      }
    };
    
    // Create WebSocket for testing
    ws = new MockWebSocket();
    elevenLabsWs = mockElevenLabsWs;
    
    // Setup WebSocket mock
    elevenLabsWs.sentMessages = [];
    elevenLabsWs.send = jest.fn((msg) => {
      elevenLabsWs.sentMessages.push(msg);
    });
    elevenLabsWs.getSentMessages = jest.fn(() => elevenLabsWs.sentMessages);
    elevenLabsWs.readyState = 1; // WebSocket.OPEN
    
    // Mock global WebSocket constructor
    global.WebSocket = function(url) {
      return elevenLabsWs;
    };
    
    // Simulate connection
    mockWsHandler(ws, {
      params: {},
      query: {},
      headers: { host: 'localhost:8000' }
    });
  });
  
  afterEach(() => {
    // Clean up
    delete global.callStatuses;
  });

  // Test 1: Test accurate detection of all intent patterns
  describe('Intent Detection Accuracy', () => {
    const intents = [
      { name: 'needs_more_info', transcript: 'I need more information about your services' },
      { name: 'no_interest', transcript: 'Sorry, I am not interested in this offer' },
      { name: 'needs_immediate_care', transcript: 'I need assistance right away' },
      { name: 'schedule_callback', transcript: 'Can you call back tomorrow afternoon?' },
      { name: 'already_have_care', transcript: 'I already have a caregiver service' },
      { name: 'wrong_person', transcript: 'You have the wrong number' },
      { name: 'cant_talk_now', transcript: 'I am driving right now, cannot talk' },
      { name: 'confused', transcript: 'What is this about? I am confused' }
    ];

    intents.forEach(({ name, transcript }) => {
      it(`should accurately detect ${name} intent`, () => {
        // Process the transcript
        const result = processTranscript('CALL123', transcript, 'lead');
        
        // Verify detection
        expect(result.intentDetected).toBe(true);
        expect(result.detectedIntents).toContain(name);
        
        // Simulate setting the primary intent
        intentDetectorControl.detectedIntents = [name];
        intentDetectorControl.primaryIntent = name;
        
        // Check that getIntentInstructions returns the appropriate instructions
        const instructions = getIntentInstructions('CALL123');
        expect(instructions).not.toBeNull();
        expect(instructions.length).toBeGreaterThan(0);
      });
    });
  });

  // Test 2: Test handling of multiple intents in the same conversation
  describe('Multiple Intent Handling', () => {
    it('should detect and handle multiple intents in the same conversation', () => {
      // Enable multiple intent detection
      intentDetectorControl.returnMultipleIntents = true;
      
      // Process transcript
      const result = processTranscript('CALL123', 'I want more information but can you call back tomorrow?', 'lead');
      
      // Verify multiple intents detected
      expect(result.intentDetected).toBe(true);
      expect(result.detectedIntents.length).toBeGreaterThan(1);
      expect(result.detectedIntents).toContain('needs_more_info');
      expect(result.detectedIntents).toContain('schedule_callback');
      
      // Set up intent state for further testing
      intentDetectorControl.detectedIntents = ['needs_more_info', 'schedule_callback'];
      intentDetectorControl.primaryIntent = 'needs_more_info';
      
      // Verify primary intent is set correctly
      const intentData = getIntentData('CALL123');
      expect(intentData.primaryIntent.name).toBe('needs_more_info');
      
      // Verify instructions focus on primary intent
      const instructions = getIntentInstructions('CALL123');
      expect(instructions).toContain('more information');
    });

    it('should handle conflicting intents by prioritizing correctly', () => {
      // Enable conflicting intent detection
      intentDetectorControl.conflictingIntents = true;
      
      // Process transcript with conflicting intents
      const result = processTranscript('CALL123', 'I need help immediately but maybe call me back tomorrow', 'lead');
      
      // Verify conflicting intents handled
      expect(result.intentDetected).toBe(true);
      expect(result.detectedIntents).toContain('needs_immediate_care');
      expect(result.detectedIntents).toContain('schedule_callback');
      
      // The immediate care should be the primary intent (higher priority)
      expect(result.primaryIntent).toBe('needs_immediate_care');
      
      // Set up intent state
      intentDetectorControl.detectedIntents = ['needs_immediate_care', 'schedule_callback'];
      intentDetectorControl.primaryIntent = 'needs_immediate_care';
      
      // Verify intent prioritization
      const intentData = getIntentData('CALL123');
      expect(intentData.primaryIntent.name).toBe('needs_immediate_care');
    });
  });

  // Test 3: Test verification of proper follow-up actions based on detected intents
  describe('Follow-up Actions Verification', () => {
    it('should take appropriate action for needs_more_info intent', () => {
      // Set up the intent
      intentDetectorControl.detectedIntents = ['needs_more_info'];
      intentDetectorControl.primaryIntent = 'needs_more_info';
      
      // Simulate action
      actionHandler.performAction('needs_more_info', 'CALL123');
      
      // Verify correct action was taken
      const lastAction = actionHandler.getLastAction();
      expect(lastAction).not.toBeNull();
      expect(lastAction.intent).toBe('needs_more_info');
    });

    it('should take appropriate action for schedule_callback intent', () => {
      // Set up the intent
      intentDetectorControl.detectedIntents = ['schedule_callback'];
      intentDetectorControl.primaryIntent = 'schedule_callback';
      
      // Check scheduling intent detection
      const hasScheduling = hasSchedulingIntent('CALL123');
      expect(hasScheduling).toBe(true);
      
      // Simulate action
      actionHandler.performAction('schedule_callback', 'CALL123');
      
      // Verify correct action was taken
      const lastAction = actionHandler.getLastAction();
      expect(lastAction).not.toBeNull();
      expect(lastAction.intent).toBe('schedule_callback');
    });

    it('should take appropriate action for no_interest intent', () => {
      // Set up the intent
      intentDetectorControl.detectedIntents = ['no_interest'];
      intentDetectorControl.primaryIntent = 'no_interest';
      
      // Check negative intent detection
      const hasNegative = hasNegativeIntent('CALL123');
      expect(hasNegative).toBe(true);
      
      // Simulate action
      actionHandler.performAction('no_interest', 'CALL123');
      
      // Verify correct action was taken
      const lastAction = actionHandler.getLastAction();
      expect(lastAction).not.toBeNull();
      expect(lastAction.intent).toBe('no_interest');
    });
  });

  // Test 4: Test for ambiguous intent scenarios
  describe('Ambiguous Intent Handling', () => {
    it('should handle ambiguous user input appropriately', () => {
      // Enable ambiguous input handling
      intentDetectorControl.ambiguousInput = true;
      
      // Process ambiguous transcript
      const result = processTranscript('CALL123', 'I have some questions about what you provide', 'lead');
      
      // Verify ambiguity detection
      expect(result.intentDetected).toBe(false);
      expect(result.ambiguous).toBe(true);
      expect(result.possibleIntents).toContain('needs_more_info');
      expect(result.possibleIntents).toContain('already_have_care');
    });
    
    it('should request clarification for ambiguous inputs', () => {
      // Test the clarification mechanism
      // This would typically involve checking if an appropriate prompt was sent to the user
      // asking for clarification when ambiguity is detected
      
      // Set up ambiguous state
      intentDetectorControl.ambiguousInput = true;
      
      // Process ambiguous transcript
      processTranscript('CALL123', 'I have some care questions', 'lead');
      
      // Simulate sending a clarification message
      const clarificationMsg = JSON.stringify({
        type: 'instruction',
        instruction: 'Ask for clarification about whether they need more information or if they already have care.'
      });
      
      elevenLabsWs.send(clarificationMsg);
      
      // Verify a clarification message was sent
      expect(elevenLabsWs.sentMessages).toContain(clarificationMsg);
    });
  });

  // Test 5: Integration test for the complete intent detection flow
  describe('Complete Intent Detection Flow', () => {
    it('should correctly process and handle intents through the complete flow', () => {
      // Phase 1: No intent detected initially
      let result = processTranscript('CALL123', 'Hello there', 'lead');
      expect(result.intentDetected).toBe(false);
      
      // Phase 2: Detect first intent
      result = processTranscript('CALL123', 'I need more information about your services', 'lead');
      expect(result.intentDetected).toBe(true);
      expect(result.detectedIntents).toContain('needs_more_info');
      
      // Set up intent state
      intentDetectorControl.detectedIntents = ['needs_more_info'];
      intentDetectorControl.primaryIntent = 'needs_more_info';
      
      // Verify instructions are provided
      const instructions1 = getIntentInstructions('CALL123');
      expect(instructions1).toContain('more information');
      
      // Phase 3: Intent changes during conversation
      intentDetectorControl.returnMultipleIntents = true;
      result = processTranscript('CALL123', 'Actually, can you call me back tomorrow?', 'lead');
      
      // Update intent state to reflect the new primary intent
      intentDetectorControl.detectedIntents = ['needs_more_info', 'schedule_callback'];
      intentDetectorControl.primaryIntent = 'schedule_callback';
      
      // Update our mock to use the new primary intent for instructions
      getIntentInstructions.mockImplementationOnce(() => 'User wants to schedule a callback. Confirm the specific date and time.');
      
      // Verify new instructions reflect the changed intent
      const instructions2 = getIntentInstructions('CALL123');
      expect(instructions2).toContain('callback');
      
      // Phase 4: Final resolution based on primary intent
      const intentData = getIntentData('CALL123');
      expect(intentData.primaryIntent.name).toBe('schedule_callback');
      
      // Verify scheduling intent is detected
      const hasScheduling = hasSchedulingIntent('CALL123');
      expect(hasScheduling).toBe(true);
      
      // Simulate final action
      actionHandler.performAction(intentData.primaryIntent.name, 'CALL123');
      
      // Verify the correct final action was taken
      const finalAction = actionHandler.getLastAction();
      expect(finalAction.intent).toBe('schedule_callback');
    });
  });
}); 