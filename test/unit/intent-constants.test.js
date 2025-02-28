// test/unit/intent-constants.test.js
import { jest, describe, it, expect } from '@jest/globals';
import '../setup.js';

import {
  ALL_INTENT_CATEGORIES,
  POSITIVE_INTENTS,
  NEGATIVE_INTENTS,
  NEUTRAL_INTENTS,
  INTENT_BY_NAME,
  INTENT_DETECTION_CONFIG,
  CANT_TALK_NOW,
  NO_INTEREST,
  ALREADY_HAVE_CARE,
  WRONG_PERSON,
  CONFUSED,
  NEEDS_MORE_INFO,
  SCHEDULE_CALLBACK,
  NEEDS_IMMEDIATE_CARE
} from '../../forTheLegends/outbound/intent-constants.js';

describe('Intent Constants Module', () => {
  // Test individual intent categories
  describe('Intent Category Constants', () => {
    it('should export intent category constants with correct properties', () => {
      // Check a few representative intent categories
      expect(CANT_TALK_NOW).toHaveProperty('name', 'cant_talk_now');
      expect(CANT_TALK_NOW).toHaveProperty('priority');
      expect(CANT_TALK_NOW).toHaveProperty('patterns');
      expect(CANT_TALK_NOW).toHaveProperty('instructions');
      
      expect(NO_INTEREST).toHaveProperty('name', 'no_interest');
      expect(NEEDS_IMMEDIATE_CARE).toHaveProperty('name', 'needs_immediate_care');
      expect(SCHEDULE_CALLBACK).toHaveProperty('name', 'schedule_callback');
    });
    
    it('should define intent patterns as regular expressions', () => {
      // Verify patterns are defined as regex objects
      ALL_INTENT_CATEGORIES.forEach(intent => {
        expect(Array.isArray(intent.patterns)).toBe(true);
        intent.patterns.forEach(pattern => {
          expect(pattern).toBeInstanceOf(RegExp);
        });
      });
    });
    
    it('should have meaningful instructions for each intent', () => {
      ALL_INTENT_CATEGORIES.forEach(intent => {
        expect(typeof intent.instructions).toBe('string');
        expect(intent.instructions.length).toBeGreaterThan(10);
      });
    });
  });
  
  // Test collections
  describe('Intent Collections', () => {
    it('should include all intent categories in ALL_INTENT_CATEGORIES', () => {
      expect(ALL_INTENT_CATEGORIES.length).toBe(9);
      expect(ALL_INTENT_CATEGORIES).toContainEqual(CANT_TALK_NOW);
      expect(ALL_INTENT_CATEGORIES).toContainEqual(NO_INTEREST);
      expect(ALL_INTENT_CATEGORIES).toContainEqual(ALREADY_HAVE_CARE);
      expect(ALL_INTENT_CATEGORIES).toContainEqual(WRONG_PERSON);
      expect(ALL_INTENT_CATEGORIES).toContainEqual(CONFUSED);
      expect(ALL_INTENT_CATEGORIES).toContainEqual(NEEDS_MORE_INFO);
      expect(ALL_INTENT_CATEGORIES).toContainEqual(SCHEDULE_CALLBACK);
      expect(ALL_INTENT_CATEGORIES).toContainEqual(NEEDS_IMMEDIATE_CARE);
    });
    
    it('should correctly categorize intents as positive, negative, or neutral', () => {
      // Check positive intents
      expect(POSITIVE_INTENTS).toContain(NEEDS_MORE_INFO.name);
      expect(POSITIVE_INTENTS).toContain(SCHEDULE_CALLBACK.name);
      expect(POSITIVE_INTENTS).toContain(NEEDS_IMMEDIATE_CARE.name);
      
      // Check negative intents
      expect(NEGATIVE_INTENTS).toContain(NO_INTEREST.name);
      expect(NEGATIVE_INTENTS).toContain(WRONG_PERSON.name);
      
      // Check neutral intents
      expect(NEUTRAL_INTENTS).toContain(CANT_TALK_NOW.name);
      expect(NEUTRAL_INTENTS).toContain(ALREADY_HAVE_CARE.name);
      expect(NEUTRAL_INTENTS).toContain(CONFUSED.name);
    });
  });
  
  // Test lookup map
  describe('Intent Lookup by Name', () => {
    it('should provide a lookup map for intents by name', () => {
      expect(INTENT_BY_NAME).toHaveProperty(NEEDS_MORE_INFO.name);
      expect(INTENT_BY_NAME).toHaveProperty(NO_INTEREST.name);
      expect(INTENT_BY_NAME).toHaveProperty(SCHEDULE_CALLBACK.name);
      
      // Verify lookup returns correct intent
      expect(INTENT_BY_NAME[NEEDS_MORE_INFO.name]).toBe(NEEDS_MORE_INFO);
      expect(INTENT_BY_NAME[NO_INTEREST.name]).toBe(NO_INTEREST);
    });
  });
  
  // Test configuration
  describe('Intent Detection Configuration', () => {
    it('should define configuration constants with reasonable values', () => {
      expect(INTENT_DETECTION_CONFIG).toHaveProperty('confidenceThreshold');
      expect(INTENT_DETECTION_CONFIG.confidenceThreshold).toBeGreaterThan(0);
      expect(INTENT_DETECTION_CONFIG.confidenceThreshold).toBeLessThan(1);
      
      expect(INTENT_DETECTION_CONFIG).toHaveProperty('minimumMatchCount');
      expect(INTENT_DETECTION_CONFIG.minimumMatchCount).toBeGreaterThan(0);
      
      expect(INTENT_DETECTION_CONFIG).toHaveProperty('ambiguityThreshold');
      expect(INTENT_DETECTION_CONFIG.ambiguityThreshold).toBeGreaterThan(0);
    });
  });
  
  // Test intent patterns
  describe('Intent Pattern Matching', () => {
    it('should detect CANT_TALK_NOW intent patterns', () => {
      const phrases = [
        "I'm busy right now",
        "Can't talk now, I'm driving",
        "I'm in a meeting",
        "Call me back later"
      ];
      
      phrases.forEach(phrase => {
        let matched = false;
        CANT_TALK_NOW.patterns.forEach(pattern => {
          if (pattern.test(phrase)) {
            matched = true;
          }
        });
        expect(matched).toBe(true);
      });
    });
    
    it('should detect NO_INTEREST intent patterns', () => {
      const phrases = [
        "I'm not interested",
        "Don't want it thanks",
        "Please remove me from your list",
        "Stop calling"
      ];
      
      phrases.forEach(phrase => {
        let matched = false;
        NO_INTEREST.patterns.forEach(pattern => {
          if (pattern.test(phrase)) {
            matched = true;
          }
        });
        expect(matched).toBe(true);
      });
    });
    
    it('should detect NEEDS_MORE_INFO intent patterns', () => {
      const phrases = [
        "Tell me more about your service",
        "I need more information",
        "What exactly do you offer?",
        "How much does it cost?"
      ];
      
      phrases.forEach(phrase => {
        let matched = false;
        NEEDS_MORE_INFO.patterns.forEach(pattern => {
          if (pattern.test(phrase)) {
            matched = true;
          }
        });
        expect(matched).toBe(true);
      });
    });
  });
}); 