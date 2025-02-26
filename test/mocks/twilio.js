import { jest } from '@jest/globals';

// Mock Call object with common methods
const mockCall = {
  sid: 'CA12345',
  to: '+18001234567',
  from: '+17001234567',
  status: 'in-progress',
  update: jest.fn(() => Promise.resolve(mockCall)),
};

// Mock Calls collection
const mockCalls = {
  create: jest.fn(() => Promise.resolve(mockCall)),
};

// Mock Twilio client constructor
const mockTwilioClient = jest.fn(() => ({
  calls: jest.fn((sid) => {
    if (sid) {
      return {
        update: jest.fn(() => Promise.resolve(mockCall)),
      };
    }
    return mockCalls;
  }),
}));

export default mockTwilioClient; 