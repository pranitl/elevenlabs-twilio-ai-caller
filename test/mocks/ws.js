// test/mocks/ws.js
import { jest } from '@jest/globals';
import { EventEmitter } from 'events';

// Create a mock WebSocket class that extends EventEmitter
class MockWebSocket extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.readyState = 1; // WebSocket.OPEN
    this.sentMessages = [];
    this.closeWasCalled = false;
  }

  send(data) {
    this.sentMessages.push(data);
    this.emit('send', data);
    return true;
  }

  close() {
    this.closeWasCalled = true;
    this.readyState = 3; // WebSocket.CLOSED
    this.emit('close');
  }
  
  getSentMessages() {
    return this.sentMessages;
  }
}

// Add WebSocket constants
MockWebSocket.CONNECTING = 0;
MockWebSocket.OPEN = 1;
MockWebSocket.CLOSING = 2;
MockWebSocket.CLOSED = 3;

// Create a mock Server class
class MockServer extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.clients = new Set();
  }

  handleUpgrade(request, socket, head, callback) {
    const ws = new MockWebSocket(request.url);
    this.clients.add(ws);
    callback(ws, request);
  }

  on(event, listener) {
    super.on(event, listener);
    return this;
  }

  close(callback) {
    this.clients.forEach(client => client.close());
    this.clients.clear();
    if (callback) callback();
  }
}

export { MockWebSocket, MockServer }; 