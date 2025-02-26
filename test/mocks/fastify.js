import { jest } from '@jest/globals';

// Mock reply object
const mockReply = {
  send: jest.fn().mockReturnThis(),
  code: jest.fn().mockReturnThis(),
  type: jest.fn().mockReturnThis(),
  sendFile: jest.fn().mockReturnThis(),
};

// Mock request object
const mockRequest = {
  body: {},
  query: {},
  params: {},
  headers: {
    host: 'localhost:8000',
  },
};

// Mock Fastify instance
const mockFastify = {
  register: jest.fn().mockImplementation((plugin, options) => {
    if (typeof plugin === 'function') {
      // Automatically call the plugin function with the mock fastify instance
      plugin(mockFastify, options || {});
    }
    return mockFastify;
  }),
  get: jest.fn().mockReturnThis(),
  post: jest.fn().mockReturnThis(),
  all: jest.fn().mockReturnThis(),
  addHook: jest.fn().mockReturnThis(),
  listen: jest.fn().mockResolvedValue(),
  log: {
    info: jest.fn(),
    error: jest.fn(),
  },
  close: jest.fn().mockResolvedValue(),
  websocketServer: {
    on: jest.fn(),
    clients: new Set(),
  },
};

// Factory function to create a Fastify mock
const mockFastifyFactory = jest.fn().mockImplementation(() => mockFastify);

export default mockFastifyFactory;
export { mockFastify, mockRequest, mockReply }; 