import { jest, describe, it, expect } from '@jest/globals';
import '../setup.js';

// Direct check for ALL_STATUS_EVENTS in the module
import fs from 'fs';
import path from 'path';

describe('Complete Call Status Tracking', () => {
  // Define the expected status events array
  const EXPECTED_STATUS_EVENTS = [
    'initiated', 'ringing', 'answered', 'completed', 
    'busy', 'no-answer', 'canceled', 'failed'
  ];

  describe('Status event constants', () => {
    // Read the source file directly
    const sourceCode = fs.readFileSync(path.resolve('./outbound-calls.js'), 'utf8');
    
    it('should define ALL_STATUS_EVENTS with all required call statuses', () => {
      // Check if ALL_STATUS_EVENTS is defined in the file
      expect(sourceCode).toContain('const ALL_STATUS_EVENTS = [');
      
      // Check that each expected status is included in the source code
      EXPECTED_STATUS_EVENTS.forEach(status => {
        expect(sourceCode).toContain(`'${status}'`);
      });
    });
    
    it('should use ALL_STATUS_EVENTS in the lead call creation', () => {
      // Check that statusCallbackEvent is set to ALL_STATUS_EVENTS in lead call creation
      expect(sourceCode).toContain('statusCallbackEvent: ALL_STATUS_EVENTS');
    });
    
    it('should handle all possible status updates in status callbacks', () => {
      // Check that all important status conditions are handled in status updates
      const statusPattern = /if\s*\(\s*CallStatus\s*===\s*["']completed["']\s*\|\|\s*CallStatus\s*===\s*["']busy["']/;
      expect(sourceCode).toMatch(statusPattern);
      
      // Check for other status values
      expect(sourceCode).toContain('no-answer');
      expect(sourceCode).toContain('failed');
      expect(sourceCode).toContain('canceled');
    });
    
    it('should save timestamp information for call status tracking', () => {
      // Check that timestamps are recorded for call tracking in various formats
      expect(sourceCode).toContain('timestamp: new Date().toISOString()');
      expect(sourceCode).toContain('new Date().toISOString()');
      
      // Check for any timestamp-related call status tracking
      const timestampPattern = /(?:call|status|time|timestamp|update).+new Date\(\)/i;
      expect(sourceCode).toMatch(timestampPattern);
    });
    
    it('should store additional information like leadInfo for better tracking', () => {
      // Check that lead info is stored with call statuses
      expect(sourceCode).toContain('leadInfo:');
    });
  });
}); 