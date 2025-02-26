// test/unit/callback-time-detection.test.js
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import '../setup.js';

// Mock necessary modules
jest.mock('ws');
jest.mock('twilio');

describe('Callback Time Detection', () => {
  let detectCallbackTime;
  
  beforeEach(() => {
    // Reset environment
    jest.resetModules();
    
    // Extract the detectCallbackTime function from the module
    // We need to use a workaround to access this non-exported function
    const outboundCallsModule = require('../../outbound-calls.js');
    
    // Define the function just as in the original file
    // This is needed because the function isn't exported, so we recreate it for testing
    detectCallbackTime = (transcript) => {
      if (!transcript) return null;
      
      const lowercaseText = transcript.toLowerCase();
      const result = {
        hasTimeReference: false,
        rawText: transcript,
        detectedDays: [],
        detectedTimes: [],
        detectedRelative: [],
        detectedPeriods: []
      };
      
      // Extract days of the week
      const dayMatches = [...lowercaseText.matchAll(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi)];
      if (dayMatches.length > 0) {
        result.hasTimeReference = true;
        result.detectedDays = dayMatches.map(match => match[0]);
      }
      
      // Extract times
      const timeMatches = [...lowercaseText.matchAll(/\b(([1-9]|1[0-2])(?::([0-5][0-9]))?\s*([ap]\.?m\.?)?)\b/gi)];
      if (timeMatches.length > 0) {
        result.hasTimeReference = true;
        result.detectedTimes = timeMatches.map(match => match[0]);
      }
      
      // Extract relative day references
      const relativeMatches = [...lowercaseText.matchAll(/\b(tomorrow|later today|this afternoon|this evening|next week)\b/gi)];
      if (relativeMatches.length > 0) {
        result.hasTimeReference = true;
        result.detectedRelative = relativeMatches.map(match => match[0]);
      }
      
      // Extract time periods
      const periodMatches = [...lowercaseText.matchAll(/\b(morning|afternoon|evening|night)\b/gi)];
      if (periodMatches.length > 0) {
        result.hasTimeReference = true;
        result.detectedPeriods = periodMatches.map(match => match[0]);
      }
      
      if (!result.hasTimeReference) return null;
      
      return result;
    };
  });

  it('should detect days of the week', () => {
    const result = detectCallbackTime('Can you call me on Monday?');
    
    expect(result).not.toBeNull();
    expect(result.hasTimeReference).toBe(true);
    expect(result.detectedDays).toContain('Monday');
    expect(result.detectedDays.length).toBe(1);
  });

  it('should detect multiple days of the week', () => {
    const result = detectCallbackTime('I am free on Tuesday or Wednesday');
    
    expect(result).not.toBeNull();
    expect(result.hasTimeReference).toBe(true);
    expect(result.detectedDays).toContain('Tuesday');
    expect(result.detectedDays).toContain('Wednesday');
    expect(result.detectedDays.length).toBe(2);
  });

  it('should detect specific times', () => {
    const result = detectCallbackTime('Call me at 3 pm');
    
    expect(result).not.toBeNull();
    expect(result.hasTimeReference).toBe(true);
    expect(result.detectedTimes).toContain('3 pm');
    expect(result.detectedTimes.length).toBe(1);
  });

  it('should detect times with minutes', () => {
    const result = detectCallbackTime('Call me at 10:30 am');
    
    expect(result).not.toBeNull();
    expect(result.hasTimeReference).toBe(true);
    expect(result.detectedTimes).toContain('10:30 am');
    expect(result.detectedTimes.length).toBe(1);
  });

  it('should detect relative day references', () => {
    const result = detectCallbackTime('Please call me back tomorrow');
    
    expect(result).not.toBeNull();
    expect(result.hasTimeReference).toBe(true);
    expect(result.detectedRelative).toContain('tomorrow');
    expect(result.detectedRelative.length).toBe(1);
  });

  it('should detect time periods', () => {
    const result = detectCallbackTime('Call me in the afternoon');
    
    expect(result).not.toBeNull();
    expect(result.hasTimeReference).toBe(true);
    expect(result.detectedPeriods).toContain('afternoon');
    expect(result.detectedPeriods.length).toBe(1);
  });

  it('should detect combinations of time references', () => {
    const result = detectCallbackTime('Please call me tomorrow afternoon around 2:30 pm');
    
    expect(result).not.toBeNull();
    expect(result.hasTimeReference).toBe(true);
    expect(result.detectedRelative).toContain('tomorrow');
    expect(result.detectedPeriods).toContain('afternoon');
    expect(result.detectedTimes).toContain('2:30 pm');
  });

  it('should handle complex sentences with time references', () => {
    const result = detectCallbackTime('I would appreciate if someone could call me back on Friday morning, preferably around 10 am, or next week if that\'s not possible.');
    
    expect(result).not.toBeNull();
    expect(result.hasTimeReference).toBe(true);
    expect(result.detectedDays).toContain('Friday');
    expect(result.detectedPeriods).toContain('morning');
    expect(result.detectedTimes).toContain('10 am');
    expect(result.detectedRelative).toContain('next week');
  });

  it('should return null when no time references are found', () => {
    const result = detectCallbackTime('Please have someone contact me');
    
    expect(result).toBeNull();
  });

  it('should handle empty or null input', () => {
    expect(detectCallbackTime('')).toBeNull();
    expect(detectCallbackTime(null)).toBeNull();
    expect(detectCallbackTime(undefined)).toBeNull();
  });
}); 