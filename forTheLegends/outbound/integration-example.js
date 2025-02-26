// forTheLegends/outbound/integration-example.js
// Example showing how to integrate the enhanced features with outbound-calls.js

/**
 * This file demonstrates how to integrate the enhanced modules with your
 * existing outbound-calls.js implementation. You can use this as a reference
 * for where and how to add the integration code to your main file.
 * 
 * Key integration points:
 * 1. Initialize the enhanced features when the server starts
 * 2. Enhance lead call creation to track calls for potential retries
 * 3. Enhance ElevenLabs setup to handle intent detection and interruptions
 * 4. Process audio for quality monitoring
 * 5. Enhance webhook data before sending it
 * 6. Process call status updates for retry logic
 */

// Import integration module
import {
  initIntegration,
  enhanceLeadCall,
  enhanceElevenLabsSetup,
  processAudio,
  enhanceWebhook,
  processCallStatus
} from './forTheLegends/outbound/index.js';

// Initialize the enhanced features
// Add this near the top of your main application code
initIntegration({
  maxRetries: 2,
  retryDelayMs: 60000 // 1 minute
});

/**
 * INTEGRATION POINT 1: Enhance lead call creation
 * 
 * In your outbound-calls.js file, find where you create the lead call,
 * and add the enhanceLeadCall function after it.
 * 
 * Example:
 */
export function registerOutboundRoutes(fastify) {
  // ... existing code ...

  // Route to initiate outbound calls with sales team handoff
  fastify.post("/outbound-call-to-sales", async (request, reply) => {
    // ... existing code ...
    
    try {
      console.log("Initiating lead call to:", number);
      console.log("Lead info:", JSON.stringify(leadinfo));
      
      // Create the lead call using Twilio
      const leadCall = await twilioClient.calls.create({
        // ... existing call creation params ...
      });

      // INTEGRATION: Enhance the lead call for retry and advanced features
      const leadId = enhanceLeadCall(leadCall, leadinfo);
      
      // ... rest of the existing code ...
    } catch (error) {
      // ... existing error handling ...
    }
  });
  
  // ... rest of the existing code ...
}

/**
 * INTEGRATION POINT 2: Enhance ElevenLabs setup
 * 
 * In your outbound-calls.js file, find the setupElevenLabs function and
 * modify it to use the enhanced version.
 * 
 * Example:
 */
// Original function
async function setupElevenLabs() {
  try {
    // ... existing code ...
    
    return elevenLabsWs;
  } catch (error) {
    console.error("[ElevenLabs] Setup error:", error);
    return null;
  }
}

// Enhanced function - add this after the original
// Then modify where setupElevenLabs is called to use enhancedSetupElevenLabs
function enhancedSetupElevenLabs(callSid, leadId) {
  return enhanceElevenLabsSetup(setupElevenLabs, callSid, leadId);
}

/**
 * INTEGRATION POINT 3: Process audio for quality monitoring
 * 
 * In your WebSocket handler for processing audio from Twilio, 
 * add the processAudio function.
 * 
 * Example:
 */
fastify.register(async (fastifyInstance) => {
  fastifyInstance.get("/outbound-media-stream", { websocket: true }, (ws, req) => {
    // ... existing code ...
    
    ws.on("message", (msg) => {
      try {
        const message = JSON.parse(msg);
        
        switch (message.event) {
          case "media":
            // ... existing code ...
            
            // INTEGRATION: Process audio for quality monitoring
            processAudio(callSid, message.media.payload);
            
            // ... rest of the existing code ...
            break;
          
          // ... other case handlers ...
        }
      } catch (error) {
        // ... existing error handling ...
      }
    });
    
    // ... rest of the existing code ...
  });
});

/**
 * INTEGRATION POINT 4: Enhance webhook data
 * 
 * In your function for sending webhook data, enhance the payload
 * before sending it.
 * 
 * Example:
 */
async function sendCallDataToWebhook(callSid, conversationId) {
  try {
    // ... existing code to prepare webhookData ...
    
    // INTEGRATION: Enhance the webhook payload
    const enhancedData = enhanceWebhook(webhookData, callSid);
    
    try {
      const webhookResponse = await fetch(
        "https://hook.us2.make.com/your-webhook-url",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(enhancedData), // Use enhanced data instead
        }
      );
      
      // ... rest of the existing code ...
    } catch (error) {
      // ... existing error handling ...
    }
  } catch (error) {
    // ... existing error handling ...
  }
}

/**
 * INTEGRATION POINT 5: Process call status updates
 * 
 * In your status callback routes, process call status for retry logic.
 * 
 * Example:
 */
fastify.post("/lead-status", (request, reply) => {
  const callSid = request.body.CallSid;
  const callStatus = request.body.CallStatus;
  const answeredBy = request.body.AnsweredBy;
  
  // ... existing code ...
  
  // INTEGRATION: Process call status for retry logic
  processCallStatus(callSid, callStatus, answeredBy);
  
  // ... rest of the existing code ...
  
  reply.send('OK');
});

/**
 * INTEGRATION POINT 6: Process AMD callback
 * 
 * In your AMD callback route, process the answering machine detection result.
 * 
 * Example:
 */
fastify.post("/amd-callback", (request, reply) => {
  const callSid = request.body.CallSid;
  const answeredBy = request.body.AnsweredBy;
  
  // ... existing code ...
  
  // INTEGRATION: Process AMD result for retry logic
  processCallStatus(callSid, 'in-progress', answeredBy);
  
  reply.send('OK');
}); 