/**
 * Tests for the ElevenLabs message handler integration with call state
 * 
 * This suite tests the proper handling of ElevenLabs messages and 
 * their integration with the call state management system.
 */
import { jest } from '@jest/globals';
import { getCallData, updateCallData, clearAllCallData } from '../../forTheLegends/outbound/call-state.js';
import { handleElevenLabsMessage } from '../../outbound-calls.js';

describe('ElevenLabs Message Handler', () => {
  let mockWebSocket;
  let callSid;
  
  beforeEach(() => {
    // Clear call data before each test
    clearAllCallData();
    
    // Generate random call SID for testing
    callSid = 'CA' + Math.random().toString(36).substring(2, 15);
    
    // Initialize call data
    updateCallData(callSid, {
      leadStatus: 'in-progress',
      transcripts: []
    });
    
    // Mock WebSocket
    mockWebSocket = {
      send: jest.fn(),
      readyState: 1 // OPEN
    };
  });
  
  test('should handle audio message correctly', () => {
    // Create a mock audio message
    const audioMessage = JSON.stringify({
      type: 'audio',
      audio: 'base64_encoded_audio_data',
      isFinal: false
    });
    
    // Call the handler
    handleElevenLabsMessage(mockWebSocket, audioMessage, callSid);
    
    // Verify WebSocket message was sent
    expect(mockWebSocket.send).toHaveBeenCalledWith(audioMessage);
  });
  
  test('should handle speech message correctly', () => {
    // Create a mock speech message
    const speechMessage = JSON.stringify({
      type: 'speech',
      text: 'Hello, this is a test',
      timestamp: Date.now()
    });
    
    // Call the handler
    handleElevenLabsMessage(mockWebSocket, speechMessage, callSid);
    
    // Verify transcripts are updated
    expect(getCallData(callSid).transcripts.length).toBe(1);
    expect(getCallData(callSid).transcripts[0]).toContain('Hello, this is a test');
  });
  
  test('should handle interrupt message correctly', () => {
    // Create a mock interrupt message
    const interruptMessage = JSON.stringify({
      type: 'interrupt'
    });
    
    // Call the handler
    handleElevenLabsMessage(mockWebSocket, interruptMessage, callSid);
    
    // Verify WebSocket message was sent
    expect(mockWebSocket.send).toHaveBeenCalledWith(interruptMessage);
  });
  
  test('should handle transcript message correctly', () => {
    // Create a mock transcript message
    const transcriptMessage = JSON.stringify({
      type: 'transcript',
      text: 'User said: I want to speak to a sales representative',
      timestamp: Date.now()
    });
    
    // Call the handler
    handleElevenLabsMessage(mockWebSocket, transcriptMessage, callSid);
    
    // Verify user transcripts are updated
    expect(getCallData(callSid).userTranscripts).toBeTruthy();
    expect(getCallData(callSid).userTranscripts.length).toBe(1);
    expect(getCallData(callSid).userTranscripts[0]).toContain('I want to speak to a sales representative');
  });
  
  test('should handle transfer request correctly', () => {
    // Create a mock transcript message with transfer request
    const transferMessage = JSON.stringify({
      type: 'transcript',
      text: 'User said: I want to speak to a sales person now',
      timestamp: Date.now()
    });
    
    // Mock the global fetch function for this test
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true })
    });
    
    // Call the handler
    handleElevenLabsMessage(mockWebSocket, transferMessage, callSid);
    
    // Update mock to simulate transfer requested
    updateCallData(callSid, { transferRequested: true });
    
    // Create a follow-up transcript to see if it triggers transfer
    const followUpMessage = JSON.stringify({
      type: 'transcript',
      text: 'User said: Yes, transfer me please',
      timestamp: Date.now() + 1000
    });
    
    // Call the handler again
    handleElevenLabsMessage(mockWebSocket, followUpMessage, callSid);
    
    // Check if fetch was called to initiate transfer
    expect(global.fetch).toHaveBeenCalled();
    
    // Clean up
    global.fetch.mockRestore();
  });
  
  test('should handle message without affecting other call data', () => {
    // Initialize call with additional data
    updateCallData(callSid, {
      leadInfo: {
        name: 'Test Lead',
        company: 'Test Company',
        leadSource: 'Website'
      }
    });
    
    // Create a mock message
    const message = JSON.stringify({
      type: 'speech',
      text: 'Hello, how can I help you?',
      timestamp: Date.now()
    });
    
    // Call the handler
    handleElevenLabsMessage(mockWebSocket, message, callSid);
    
    // Verify original data is preserved
    expect(getCallData(callSid).leadInfo).toBeTruthy();
    expect(getCallData(callSid).leadInfo.name).toBe('Test Lead');
    expect(getCallData(callSid).leadInfo.company).toBe('Test Company');
    
    // Verify transcripts are updated
    expect(getCallData(callSid).transcripts.length).toBe(1);
  });
}); 