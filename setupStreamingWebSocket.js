/**
 * ElevenLabs WebSocket streaming handler
 * Handles setup of WebSocket connections for streaming audio between Twilio and ElevenLabs
 * Supports both production and testing environments
 */

// Import webhook functionality
import { sendElevenLabsConversationData } from './forTheLegends/outbound/index.js';
import * as elevenLabsPrompts from './forTheLegends/prompts/elevenlabs-prompts.js';
import { getElevenLabsSuccessCriteria, processElevenLabsSuccessCriteria } from './forTheLegends/outbound/intent-detector.js';
import WebSocket from "ws";

// Constants for tracking call status
const callStatuses = {};

// Expose the processElevenLabsSuccessCriteria function globally for testing
if (typeof global !== 'undefined') {
  global.processElevenLabsSuccessCriteria = processElevenLabsSuccessCriteria;
}

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

  // Store call parameters
  const callParams = {
    promptOverride: null
  };

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
            setupElevenLabsConnection(elevenLabsWs, callSid, customParameters);
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
 * Set up event handlers for the ElevenLabs WebSocket
 * @param {WebSocket} elevenLabsWs - The ElevenLabs WebSocket connection
 * @param {string} callSid - The Twilio call SID
 * @param {Object} customParameters - Custom parameters from the Twilio call
 */
function setupElevenLabsConnection(elevenLabsWs, callSid, customParameters) {
  let conversationId = null;
  
  elevenLabsWs.on("open", () => {
    console.log('[ElevenLabs] WebSocket connection opened');
    
    // Get the initialization configuration
    let initConfig = getInitializationMessage(customParameters);
    
    // Add success criteria to the configuration
    if (initConfig && initConfig.conversation_config_override) {
      initConfig.conversation_config_override.successCriteria = getElevenLabsSuccessCriteria();
    }
    
    console.log('[ElevenLabs] Sending initialization with success criteria:', 
      JSON.stringify(initConfig.conversation_config_override.successCriteria));
    
    // Send the configuration to ElevenLabs
    elevenLabsWs.send(JSON.stringify(initConfig));
  });
  
  elevenLabsWs.on("message", (data) => {
    try {
      const message = JSON.parse(data);
      
      // Store conversation ID when available
      if (message.conversation_id && !conversationId) {
        conversationId = message.conversation_id;
        console.log(`[ElevenLabs] Got conversation ID ${conversationId} for call ${callSid}`);
        
        if (callSid) {
          callStatuses[callSid].conversationId = conversationId;
        }
      }
      
      // Handle success criteria results
      if (message.type === "success_criteria_results" && callSid) {
        console.log(`[ElevenLabs] Received success criteria results for call ${callSid}:`, message);
        processElevenLabsSuccessCriteria(callSid, message);
      }
      
      // Forward audio from ElevenLabs to Twilio
      if (message.type === "audio" && callSid && callStatuses[callSid]?.streamSid) {
        const streamSid = callStatuses[callSid].streamSid;
        console.log(`[ElevenLabs] Sending AI audio to call ${callSid}`);
        const audioData = {
          event: "media",
          streamSid,
          media: {
            payload: message.audio?.chunk || message.audio_event?.audio_base_64,
          },
        };
        ws.send(JSON.stringify(audioData));
      }
    } catch (error) {
      console.error("[ElevenLabs] Error processing message:", error);
    }
  });
  
  elevenLabsWs.on("error", (error) => {
    console.error("[ElevenLabs] WebSocket error:", error);
  });
  
  elevenLabsWs.on("close", () => {
    console.log("[ElevenLabs] WebSocket closed");
  });
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
export { setupStreamingWebSocket, callStatuses, getInitializationMessage, setupElevenLabsConnection };

// Support CommonJS for compatibility with tests
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { setupStreamingWebSocket, callStatuses, getInitializationMessage, setupElevenLabsConnection };
} 