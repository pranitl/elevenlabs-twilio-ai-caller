// test/mocks/express.js
import { jest } from '@jest/globals';

// Create simple mock for express
const express = jest.fn(() => {
  const app = {
    use: jest.fn().mockReturnThis(),
    get: jest.fn().mockReturnThis(),
    post: jest.fn().mockReturnThis(),
    all: jest.fn().mockReturnThis(),
    listen: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    engine: jest.fn().mockReturnThis()
  };
  return app;
});

// Mock the express router
express.Router = jest.fn(() => ({
  use: jest.fn().mockReturnThis(),
  get: jest.fn().mockReturnThis(),
  post: jest.fn().mockReturnThis(),
  all: jest.fn().mockReturnThis()
}));

// Mock express middleware
express.json = jest.fn(() => jest.fn());
express.urlencoded = jest.fn(() => jest.fn());
express.static = jest.fn(() => jest.fn());

export default express; 