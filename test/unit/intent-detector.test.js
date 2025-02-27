// test/unit/intent-detector.test.js
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import '../setup.js';

import {
  initializeIntentDetection,
  processTranscript,
  getIntentInstructions,
  hasSchedulingIntent,
  hasNegativeIntent,
  getIntentData,
  clearIntentData
} from '../../forTheLegends/outbound/intent-detector.js';

describe('Intent Detector Module', () => {
  // Sample call SID for testing
  const TEST_CALL_SID = 'CALL123456';
  
  // Clear state between tests
  beforeEach(() => {
    clearIntentData(TEST_CALL_SID);
  });
  
  describe('Intent Detection Initialization', () => {
    it('should initialize intent detection state for a call', () => {
      const state = initializeIntentDetection(TEST_CALL_SID);
      
      expect(state).toHaveProperty('detectedIntents');
      expect(state).toHaveProperty('primaryIntent');
      expect(state).toHaveProperty('instructionsSent');
      expect(state).toHaveProperty('intentLog');
      
      expect(state.detectedIntents).toEqual([]);
      expect(state.primaryIntent).toBeNull();
      expect(state.instructionsSent).toBe(false);
      expect(Array.isArray(state.intentLog)).toBe(true);
    });
  });
  
  describe('Transcript Processing', () => {
    it('should detect intents from lead transcripts', () => {
      // Test with a non-lead speaker (should not detect intent)
      let result = processTranscript(TEST_CALL_SID, 'I need more information about your service', 'agent');
      expect(result.intentDetected).toBe(false);
      
      // Test with a lead speaker (should detect intent)
      result = processTranscript(TEST_CALL_SID, 'I need more information about your service', 'lead');
      expect(result.intentDetected).toBe(true);
      expect(result.detectedIntents).toContain('needs_more_info');
    });
    
    it('should detect multiple intents in the same transcript', () => {
      const result = processTranscript(
        TEST_CALL_SID,
        "I need more information but I'm kind of busy right now, can you call back later?",
        'lead'
      );
      
      expect(result.intentDetected).toBe(true);
      expect(result.detectedIntents.length).toBeGreaterThanOrEqual(2);
      // We should check for specific intents that we expect to be detected
      const detectedIntentNames = result.detectedIntents;
      expect(detectedIntentNames).toContain('needs_more_info');
      // At least one of these should be detected
      expect(
        detectedIntentNames.includes('cant_talk_now') || 
        detectedIntentNames.includes('schedule_callback')
      ).toBe(true);
    });
    
    it('should assign a primary intent based on priority and confidence', () => {
      // Process transcript with high priority intent
      const result = processTranscript(
        TEST_CALL_SID,
        "I'm wrong person, you have the wrong number",
        'lead'
      );
      
      expect(result.intentDetected).toBe(true);
      expect(result.primaryIntent).toBe('wrong_person');
      
      // Check that high priority intent takes precedence
      const result2 = processTranscript(
        TEST_CALL_SID,
        "I need urgent help immediately, this is an emergency",
        'lead'
      );
      
      expect(result2.intentDetected).toBe(true);
      expect(result2.primaryIntent).toBe('needs_immediate_care');
    });
    
    it('should accumulate intents across multiple transcripts', () => {
      // First transcript
      processTranscript(TEST_CALL_SID, "I need more information about your service", 'lead');
      
      // Second transcript with a higher priority intent
      processTranscript(TEST_CALL_SID, "Actually, it's kind of urgent, I need help right away", 'lead');
      
      // Get intent data
      const intentData = getIntentData(TEST_CALL_SID);
      
      // Should contain both intents
      const detectedIntentNames = intentData.detectedIntents.map(i => i.name);
      expect(detectedIntentNames).toContain('needs_more_info');
      expect(detectedIntentNames).toContain('needs_immediate_care');
      
      // Primary intent should be set to the highest priority from detected intents
      expect(intentData.primaryIntent.name).toBe('needs_immediate_care');
    });
  });
  
  describe('Intent Instructions', () => {
    it('should provide instructions for detected intents', () => {
      // Detect an intent that we know has specific instruction terms
      processTranscript(TEST_CALL_SID, "I need urgent care immediately", 'lead');
      
      // Get instructions
      const instructions = getIntentInstructions(TEST_CALL_SID);
      
      // Check for terms we expect in the immediate care instructions
      expect(instructions).toContain('immediate care');
      expect(instructions).toContain('urgency');
    });
    
    it('should return null if no primary intent is detected', () => {
      // No intent detected
      const instructions = getIntentInstructions(TEST_CALL_SID);
      
      expect(instructions).toBeNull();
    });
  });
  
  describe('Intent Queries', () => {
    it('should correctly identify scheduling intents', () => {
      // No intent detected initially
      expect(hasSchedulingIntent(TEST_CALL_SID)).toBe(false);
      
      // Detect scheduling intent
      processTranscript(TEST_CALL_SID, "Can you call me back tomorrow?", 'lead');
      
      // Should now return true
      expect(hasSchedulingIntent(TEST_CALL_SID)).toBe(true);
    });
    
    it('should correctly identify negative intents', () => {
      // No intent detected initially
      expect(hasNegativeIntent(TEST_CALL_SID)).toBe(false);
      
      // Detect negative intent
      processTranscript(TEST_CALL_SID, "I'm not interested, thanks", 'lead');
      
      // Should now return true
      expect(hasNegativeIntent(TEST_CALL_SID)).toBe(true);
    });
    
    it('should provide intent data for reporting', () => {
      // Detect an intent that we're sure will be detected (using keyword that triggers immediate care)
      const result = processTranscript(TEST_CALL_SID, "This is an emergency, I need immediate assistance", 'lead');
      
      // Verify the primary intent was correctly set in the process result
      expect(result.intentDetected).toBe(true);
      expect(result.primaryIntent).toBe('needs_immediate_care');
      
      // Get intent data
      const intentData = getIntentData(TEST_CALL_SID);
      
      // Verify the data is returned
      expect(intentData).not.toBeNull();
      expect(intentData).toHaveProperty('primaryIntent');
      expect(intentData).toHaveProperty('detectedIntents');
      expect(intentData).toHaveProperty('intentLog');
      expect(intentData).toHaveProperty('firstDetectionTime');
      expect(intentData).toHaveProperty('lastUpdateTime');
      
      // Verify the primary intent is correctly set
      expect(intentData.primaryIntent.name).toBe('needs_immediate_care');
    });
  });
  
  describe('Intent Data Management', () => {
    it('should clear intent data when requested', () => {
      // Initialize and detect an intent
      initializeIntentDetection(TEST_CALL_SID);
      processTranscript(TEST_CALL_SID, "I need urgent help immediately", 'lead');
      
      // Verify intent was detected
      expect(getIntentData(TEST_CALL_SID)).not.toBeNull();
      
      // Clear data
      clearIntentData(TEST_CALL_SID);
      
      // Verify data was cleared
      expect(getIntentData(TEST_CALL_SID)).toBeNull();
    });
  });
  
  describe('Edge Cases', () => {
    it('should handle empty transcripts', () => {
      const result = processTranscript(TEST_CALL_SID, '', 'lead');
      
      expect(result.intentDetected).toBe(false);
    });
    
    it('should handle undefined call SIDs', () => {
      // Should not throw errors when call SID is missing
      expect(() => {
        processTranscript(undefined, "Hello", 'lead');
        getIntentInstructions(undefined);
        hasSchedulingIntent(undefined);
        hasNegativeIntent(undefined);
        getIntentData(undefined);
        clearIntentData(undefined);
      }).not.toThrow();
    });
  });
}); 