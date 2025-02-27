/**
 * Enhanced WebSocket mock implementation for testing
 * Provides simulation of WebSocket connections and events
 */
import { EventEmitter } from 'events';

// Store active connections for later use in tests
const connectionStore = {
  activeConnections: new Map(),
  messageHistory: [], // Store all messages sent during the test
  connectionHistory: [] // Store connection events
};

/**
 * Mock WebSocket class that extends EventEmitter
 * Can be used as a direct replacement for 'ws' in tests
 */
class MockWebSocket extends EventEmitter {
  constructor(url, protocols) {
    super();
    this.url = url;
    this.protocols = protocols;
    this.readyState = 0; // CONNECTING
    this.messagesSent = []; // Track messages sent by this instance
    
    // Store this connection in the global store
    connectionStore.activeConnections.set(url, this);
    connectionStore.connectionHistory.push({
      type: 'connection_created',
      url,
      timestamp: Date.now()
    });
    
    // Simulate connection
    setTimeout(() => {
      if (this.readyState !== 2) { // Not CLOSING
        this.readyState = 1; // OPEN
        this.emit('open');
        
        connectionStore.connectionHistory.push({
          type: 'connection_opened',
          url,
          timestamp: Date.now()
        });
      }
    }, 50);
  }
  
  /**
   * Send a message to the WebSocket
   * @param {string|Object} data - The data to send
   */
  send(data) {
    if (this.readyState !== 1) {
      throw new Error('WebSocket is not open');
    }
    
    // Track messages for the specific connection
    this.messagesSent.push(data);
    
    // Also track globally for test inspection
    connectionStore.messageHistory.push({
      direction: 'outgoing',
      url: this.url,
      data: data,
      timestamp: Date.now()
    });
    
    try {
      const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
      this.emit('_sent', parsedData);
      
      // Log the sent data for debugging
      console.log(`[MockWebSocket] Sent data to ${this.url}:`, typeof parsedData === 'object' ? 
        JSON.stringify(parsedData, null, 2).substring(0, 150) + (JSON.stringify(parsedData).length > 150 ? '...' : '') : 
        parsedData);
    } catch (error) {
      console.error('[MockWebSocket] Error parsing sent data:', error);
      this.emit('_sent', data);
    }
  }
  
  /**
   * Close the WebSocket connection
   * @param {number} code - The close code
   * @param {string} reason - The reason for closing
   */
  close(code = 1000, reason = '') {
    if (this.readyState === 3) return; // Already CLOSED
    
    this.readyState = 2; // CLOSING
    
    connectionStore.connectionHistory.push({
      type: 'connection_closing',
      url: this.url,
      code,
      reason,
      timestamp: Date.now()
    });
    
    setTimeout(() => {
      this.readyState = 3; // CLOSED
      this.emit('close', { code, reason });
      
      connectionStore.connectionHistory.push({
        type: 'connection_closed',
        url: this.url,
        code,
        reason,
        timestamp: Date.now()
      });
      
      // Remove from active connections
      connectionStore.activeConnections.delete(this.url);
    }, 50);
  }
  
  /**
   * Simulate receiving a message from the server
   * @param {string|Object} message - The message content
   * @param {boolean} isString - Whether to send as string (default: auto-detect)
   */
  receiveMessage(message, isString = null) {
    // Convert to string if needed, preserve original object
    const isStringType = isString !== null ? isString : typeof message !== 'string';
    const stringMessage = isStringType ? JSON.stringify(message) : message;
    
    // Track the received message for test inspection
    connectionStore.messageHistory.push({
      direction: 'incoming',
      url: this.url,
      data: message,
      timestamp: Date.now()
    });
    
    // Create a MessageEvent-like object
    const messageEvent = {
      data: stringMessage,
      type: 'message',
      origin: this.url,
      lastEventId: '',
      source: null,
      ports: []
    };
    
    // Emit the message event
    this.emit('message', messageEvent);
  }
}

/**
 * Mock for fastify-websocket route registration
 * @param {Object} fastifyInstance - The fastify instance to mock
 */
function mockFastifyWebsocket(fastifyInstance) {
  fastifyInstance.websocketRoutes = new Map();
  
  // Mock the register method for websocket
  fastifyInstance.register = jest.fn((plugin, options) => {
    // If this is a websocket plugin...
    if (options && options.websocket) {
      // Store the handler
      const path = options.path || (typeof options === 'string' ? options : null);
      
      if (path) {
        fastifyInstance.websocketRoutes.set(path, {
          handler: options.handler || plugin,
          options
        });
      }
    }
    
    // Return the instance for chaining
    return fastifyInstance;
  });
  
  // Add method to simulate a websocket connection to a route
  fastifyInstance.simulateWebsocketConnection = (path, req = {}) => {
    const route = fastifyInstance.websocketRoutes.get(path);
    if (!route) {
      throw new Error(`No websocket route found for path: ${path}`);
    }
    
    // Create mock connection objects
    const socket = new EventEmitter();
    
    // Add WebSocket-like methods
    socket.send = jest.fn((data) => {
      try {
        const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
        socket.emit('_sent', parsedData);
        
        // Track all messages for test inspection
        connectionStore.messageHistory.push({
          direction: 'outgoing',
          path,
          data: data,
          timestamp: Date.now()
        });
      } catch (error) {
        socket.emit('_sent', data);
        
        // Track all messages for test inspection
        connectionStore.messageHistory.push({
          direction: 'outgoing',
          path,
          data: data,
          timestamp: Date.now()
        });
      }
    });
    
    socket.close = jest.fn();
    socket.terminate = jest.fn();
    
    const connection = {
      socket
    };
    
    // Add method to simulate incoming messages
    socket.simulateMessage = (message) => {
      // Convert to string if needed
      const stringMessage = typeof message !== 'string' ? JSON.stringify(message) : message;
      
      // Track the message for test inspection
      connectionStore.messageHistory.push({
        direction: 'incoming',
        path,
        data: message,
        timestamp: Date.now()
      });
      
      // Simulate message event
      socket.emit('message', stringMessage);
    };
    
    // Add method to simulate binary message
    socket.simulateBinaryMessage = (buffer) => {
      // Track the message for test inspection
      connectionStore.messageHistory.push({
        direction: 'incoming',
        path,
        data: buffer,
        isBinary: true,
        timestamp: Date.now()
      });
      
      // Simulate binary message event
      socket.emit('message', buffer, true);
    };
    
    // Call the route handler
    route.handler(connection, req);
    
    return socket;
  };
}

// Function to get an active connection by URL
function getConnection(url) {
  return connectionStore.activeConnections.get(url);
}

// Function to send a message to an active connection
function sendMessageTo(url, message) {
  const connection = connectionStore.activeConnections.get(url);
  if (!connection) {
    throw new Error(`No active connection found for URL: ${url}`);
  }
  
  connection.receiveMessage(message);
}

// Function to clear and reset all connection data
function clearConnectionStore() {
  // Close all active connections
  for (const connection of connectionStore.activeConnections.values()) {
    connection.close();
  }
  
  // Clear connection store
  connectionStore.activeConnections.clear();
  connectionStore.messageHistory = [];
  connectionStore.connectionHistory = [];
}

// Function to get all messages sent to or from a specific URL
function getMessagesForUrl(url) {
  return connectionStore.messageHistory.filter(msg => msg.url === url);
}

export {
  MockWebSocket,
  mockFastifyWebsocket,
  getConnection,
  sendMessageTo,
  clearConnectionStore,
  getMessagesForUrl,
  connectionStore
}; 