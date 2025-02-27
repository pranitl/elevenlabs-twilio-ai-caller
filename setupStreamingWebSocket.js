/**
 * ElevenLabs WebSocket streaming handler
 * Handles setup of WebSocket connections for streaming audio between Twilio and ElevenLabs
 * Supports both production and testing environments
 */

// Import webhook functionality
import { sendElevenLabsConversationData } from './forTheLegends/outbound/index.js';
import * as elevenLabsPrompts from './forTheLegends/prompts/elevenlabs-prompts.js';

// Constants for tracking call status
const callStatuses = {};

/**
 * Sets up a WebSocket connection for streaming audio between Twilio and ElevenLabs
 * @param {WebSocket} ws - The WebSocket connection from Twilio
 * @returns {WebSocket} - The configured WebSocket
 */
function setupStreamingWebSocket(ws) {
  console.info("[Server] Setting up streaming WebSocket");

  let streamSid = null;
  let callSid = null;
  let elevenLabsWs = null;
  let customParameters = null;
  let conversationId = null;

  // Handle errors
  ws.on("error", console.error);

  // Set up event handler for messages from Twilio
  ws.on("message", async (message) => {
    try {
      const msg = JSON.parse(message);
      console.log(`[Twilio] Received event: ${msg.event}`);
      
      switch (msg.event) {
        case "start":
          // Handle start event (extract stream and call SIDs)
          streamSid = msg.start.streamSid;
          callSid = msg.start.callSid;
          customParameters = msg.start.customParameters;
          
          console.log(`[Twilio] Stream started - StreamSid: ${streamSid}, CallSid: ${callSid}`);
          
          // Store in call status
          if (callSid) {
            callStatuses[callSid] = callStatuses[callSid] || {};
            callStatuses[callSid].streamSid = streamSid;
            callStatuses[callSid].leadInfo = customParameters;
            callStatuses[callSid].leadStatus = 'in-progress';
          }
          
          // Initialize ElevenLabs connection
          try {
            console.log('[ElevenLabs] Creating WebSocket connection');
            // Create WebSocket connection
            elevenLabsWs = new WebSocket('wss://api.elevenlabs.io/websocket');
            
            console.log('[ElevenLabs] WebSocket created:', elevenLabsWs);
            
            // Set up event handlers for the ElevenLabs WebSocket
            // This part would be implemented in production code
          } catch (error) {
            console.error('[ElevenLabs] Error creating WebSocket:', error);
          }
          break;
          
        case "media":
          // Forward audio chunks to ElevenLabs
          if (elevenLabsWs?.readyState === 1) { // WebSocket.OPEN 
            const audioMessage = {
              user_audio_chunk: Buffer.from(
                msg.media.payload,
                "base64",
              ).toString("base64"),
            };
            elevenLabsWs.send(JSON.stringify(audioMessage));
          }
          break;
          
        case "stop":
          // Close connections
          console.log(`[Twilio] Stream ${streamSid} ended`);
          if (elevenLabsWs?.readyState === 1) {
            elevenLabsWs.close();
          }
          break;
      }
    } catch (error) {
      console.error("[Twilio] Error processing message:", error);
    }
  });

  // Handle WebSocket close
  ws.on("close", () => {
    console.log("[Twilio] Client disconnected");
    
    // Close ElevenLabs connection if open
    if (elevenLabsWs?.readyState === 1) {
      elevenLabsWs.close();
    }
    
    // Send webhook data if we have a conversation
    if (callSid && conversationId) {
      sendElevenLabsConversationData(callSid, conversationId, callStatuses, { 
        sourceModule: 'streaming-websocket' 
      });
    }
  });
  
  return ws;
}

/**
 * Creates an initialization message for ElevenLabs based on lead information
 * @param {Object} customParameters - Custom parameters from the Twilio call
 * @returns {Object} - The formatted initialization message
 */
function getInitializationMessage(customParameters) {
  // Use the centralized prompt management to get a properly formatted configuration
  return elevenLabsPrompts.getInitConfig(customParameters, {
    // Use custom prompt if provided 
    additionalInstructions: customParameters?.prompt ? customParameters.prompt : undefined
  });
}

// Export for ES modules
export { setupStreamingWebSocket, callStatuses, getInitializationMessage };

// Support CommonJS for compatibility with tests
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { setupStreamingWebSocket, callStatuses, getInitializationMessage };
} 