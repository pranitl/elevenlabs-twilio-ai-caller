/**
 * Enhanced ElevenLabs mock implementation for testing
 * Provides simulation of API responses and WebSocket interactions
 */
import { EventEmitter } from 'events';

// Store conversation data for inspection in tests
const conversationStore = {
  transcripts: {},
  summaries: {},
  sentMessages: []
};

// Mock WebSocket implementation for ElevenLabs
class MockElevenLabsWebSocket extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.readyState = 0; // CONNECTING
    
    // Store sent messages for inspection in tests
    this.sentMessages = [];
    
    // Add this instance to the conversation store for test inspection
    conversationStore.sentMessages.push(this.sentMessages);
    
    // Simulate connection
    setTimeout(() => {
      this.readyState = 1; // OPEN
      this.emit('open');
    }, 50);
  }
  
  send(data) {
    // Store the message for later inspection
    try {
      const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
      this.sentMessages.push(parsedData);
      
      // Handle different message types
      if (parsedData.type === 'conversation_initiation_client_data') {
        // Simulate conversation initialization
        this._handleConversationInit(parsedData);
      } else if (parsedData.user_audio_chunk) {
        // Simulate processing user audio
        this._handleUserAudio(parsedData);
      } else if (parsedData.type === 'custom_instruction' || 
                 parsedData.type === 'instruction') {
        // Simulate receiving custom instructions
        this._handleCustomInstruction(parsedData);
      } else if (parsedData.type === 'pong') {
        // Just acknowledge pong messages
        console.log('[MockElevenLabs] Received pong response');
      }
    } catch (error) {
      console.error('[MockElevenLabs] Error processing message:', error);
      this.sentMessages.push(data);
    }
  }
  
  close() {
    this.readyState = 3; // CLOSED
    this.emit('close');
  }
  
  // Helper method to simulate AI responses
  _handleConversationInit(message) {
    // Generate a conversation ID
    const conversationId = `conv_${Math.random().toString(36).substring(2, 15)}`;
    
    // Send conversation initiation metadata
    this.emit('message', JSON.stringify({
      type: 'conversation_initiation_metadata',
      conversation_id: conversationId
    }));
    
    // Store the conversation ID for this instance
    this.conversationId = conversationId;
    
    // If first message is provided, send it after a delay
    if (message.conversation_config_override?.agent?.first_message) {
      const firstMessage = message.conversation_config_override.agent.first_message;
      
      setTimeout(() => {
        // First emit speech started event
        this.emit('message', JSON.stringify({
          type: 'speech_started'
        }));
        
        // Then emit transcript
        this.emit('message', JSON.stringify({
          type: 'transcript',
          transcript_event: {
            text: firstMessage,
            speaker: 'agent'
          }
        }));
        
        // Then emit audio chunk
        this.emit('message', JSON.stringify({
          type: 'audio',
          audio: {
            chunk: 'dGVzdCBhdWRpbyBjaHVuaw==' // "test audio chunk" in base64
          }
        }));
        
        // Then emit speech ended
        setTimeout(() => {
          this.emit('message', JSON.stringify({
            type: 'speech_ended'
          }));
          
          // Start waiting for user speech
          this.emit('message', JSON.stringify({
            type: 'waiting_for_user_speech'
          }));
        }, 300);
      }, 200);
    }
  }
  
  _handleUserAudio(message) {
    // Skip if the test doesn't want simulated responses
    if (global.testSettings?.skipAiResponses) {
      return;
    }
    
    // Simulate transcript generation
    setTimeout(() => {
      const userText = global.testSettings?.userTranscript || 
                      'Hello, I need help with care services.';
      
      this.emit('message', JSON.stringify({
        type: 'transcript',
        transcript_event: {
          text: userText,
          speaker: 'user'
        }
      }));
      
      // Store transcript in conversation store
      if (this.conversationId) {
        if (!conversationStore.transcripts[this.conversationId]) {
          conversationStore.transcripts[this.conversationId] = [];
        }
        conversationStore.transcripts[this.conversationId].push({
          speaker: 'user',
          text: userText
        });
      }
      
      // Simulate AI response
      setTimeout(() => {
        const aiText = global.testSettings?.aiResponse || 
                      'I understand you need help with care services. Can you tell me more about what you\'re looking for?';
        
        // First emit speech started
        this.emit('message', JSON.stringify({
          type: 'speech_started'
        }));
        
        // Then emit AI transcript
        this.emit('message', JSON.stringify({
          type: 'transcript',
          transcript_event: {
            text: aiText,
            speaker: 'agent'
          }
        }));
        
        // Store transcript in conversation store
        if (this.conversationId) {
          if (!conversationStore.transcripts[this.conversationId]) {
            conversationStore.transcripts[this.conversationId] = [];
          }
          conversationStore.transcripts[this.conversationId].push({
            speaker: 'agent',
            text: aiText
          });
        }
        
        // Then emit audio
        this.emit('message', JSON.stringify({
          type: 'audio',
          audio: {
            chunk: 'dGVzdCBhdWRpbyBjaHVuaw==' // "test audio chunk" in base64
          }
        }));
        
        // Then emit speech ended
        setTimeout(() => {
          this.emit('message', JSON.stringify({
            type: 'speech_ended'
          }));
          
          // Start waiting for user speech again
          this.emit('message', JSON.stringify({
            type: 'waiting_for_user_speech'
          }));
        }, 300);
      }, 200);
    }, 100);
  }
  
  _handleCustomInstruction(message) {
    const instruction = message.instruction || message.custom_instruction;
    console.log(`[MockElevenLabs] Received instruction: ${instruction}`);
    
    // Check if this is a sales team unavailable instruction
    if (instruction.includes('care specialists are not available') || 
        instruction.includes('sales team is unavailable')) {
      // Simulate AI acknowledging and asking for callback time
      setTimeout(() => {
        const response = "I'm sorry, our care specialists aren't available right now. When would be a good time for our team to call you back?";
        
        // Emit AI response about sales team unavailability
        this.emit('message', JSON.stringify({
          type: 'transcript',
          transcript_event: {
            text: response,
            speaker: 'agent'
          }
        }));
        
        // Store in transcript history
        if (this.conversationId) {
          if (!conversationStore.transcripts[this.conversationId]) {
            conversationStore.transcripts[this.conversationId] = [];
          }
          conversationStore.transcripts[this.conversationId].push({
            speaker: 'agent',
            text: response
          });
        }
        
        // Emit audio
        this.emit('message', JSON.stringify({
          type: 'audio',
          audio: {
            chunk: 'dGVzdCBhdWRpbyBjaHVuaw==' // "test audio chunk" in base64
          }
        }));
      }, 200);
    }
    
    // Check if this is a voicemail instruction
    if (instruction.includes('voicemail') || 
        instruction.includes('leave a message')) {
      // Simulate AI leaving a voicemail
      setTimeout(() => {
        const response = "Hello, I'm calling from First Light Home Care regarding your care services inquiry. Please call us back at your earliest convenience to discuss how we can help. Thank you.";
        
        // Emit AI voicemail message
        this.emit('message', JSON.stringify({
          type: 'transcript',
          transcript_event: {
            text: response,
            speaker: 'agent'
          }
        }));
        
        // Store in transcript history
        if (this.conversationId) {
          if (!conversationStore.transcripts[this.conversationId]) {
            conversationStore.transcripts[this.conversationId] = [];
          }
          conversationStore.transcripts[this.conversationId].push({
            speaker: 'agent',
            text: response
          });
        }
        
        // Emit audio
        this.emit('message', JSON.stringify({
          type: 'audio',
          audio: {
            chunk: 'dGVzdCBhdWRpbyBjaHVuaw==' // "test audio chunk" in base64
          }
        }));
      }, 200);
    }
  }
  
  // Helper to simulate a user saying something specific
  simulateUserSpeech(text) {
    // Emit transcript with the provided text
    this.emit('message', JSON.stringify({
      type: 'transcript',
      transcript_event: {
        text: text,
        speaker: 'user'
      }
    }));
    
    // Store in transcript history
    if (this.conversationId) {
      if (!conversationStore.transcripts[this.conversationId]) {
        conversationStore.transcripts[this.conversationId] = [];
      }
      conversationStore.transcripts[this.conversationId].push({
        speaker: 'user',
        text: text
      });
    }
  }
}

// Mock fetch responses for ElevenLabs API
const mockFetchResponses = {
  // Default response for signed URL
  signedUrlResponse: {
    signed_url: 'wss://mock.elevenlabs.io/v1/convai/conversation'
  },
  
  // Function to set a custom signed URL response
  setSignedUrlResponse(response) {
    this.signedUrlResponse = response;
  },
  
  // Default transcript response - will be populated during tests
  getTranscriptResponse(conversationId) {
    return {
      conversation_id: conversationId,
      transcripts: conversationStore.transcripts[conversationId] || [
        { speaker: 'agent', text: 'Hello, how can I help you with care services?' },
        { speaker: 'user', text: 'I need help with care for my mother.' },
        { speaker: 'agent', text: 'I understand. Can you tell me more about what kind of care she needs?' }
      ]
    };
  },
  
  // Default summary response
  getSummaryResponse(conversationId) {
    return conversationStore.summaries[conversationId] || {
      summary: 'The caller is seeking care services for their mother.',
      key_points: [
        'Caller is looking for home care for their mother',
        'Mother has mobility issues',
        'Caller prefers morning visits'
      ]
    };
  },
  
  // Set a custom summary for a conversation
  setConversationSummary(conversationId, summary) {
    conversationStore.summaries[conversationId] = summary;
  }
};

// Setup mock fetch function for ElevenLabs API calls
function setupMockFetch() {
  const originalFetch = global.fetch;
  
  global.fetch = async (url, options) => {
    // Handle signed URL endpoint
    if (url.includes('/convai/conversation/get_signed_url')) {
      return {
        ok: true,
        json: async () => mockFetchResponses.signedUrlResponse
      };
    }
    
    // Handle transcript endpoint
    if (url.includes('/convai/conversation/') && url.includes('/transcript')) {
      // Extract conversation ID from URL
      const conversationId = url.match(/conversation\/([^\/]+)\/transcript/)?.[1] || 'unknown';
      
      return {
        ok: true,
        json: async () => mockFetchResponses.getTranscriptResponse(conversationId)
      };
    }
    
    // Handle summary endpoint
    if (url.includes('/convai/conversation/') && url.includes('/summary')) {
      // Extract conversation ID from URL
      const conversationId = url.match(/conversation\/([^\/]+)\/summary/)?.[1] || 'unknown';
      
      return {
        ok: true,
        json: async () => mockFetchResponses.getSummaryResponse(conversationId)
      };
    }
    
    // Fallback to original fetch for other URLs
    return originalFetch(url, options);
  };
}

// Reset the conversation store
function resetConversationStore() {
  conversationStore.transcripts = {};
  conversationStore.summaries = {};
  conversationStore.sentMessages = [];
}

export { 
  MockElevenLabsWebSocket,
  mockFetchResponses,
  setupMockFetch,
  resetConversationStore,
  conversationStore
}; 