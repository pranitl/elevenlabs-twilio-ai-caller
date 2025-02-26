import { jest } from '@jest/globals';
import { MockWebSocket } from './ws.js';

/**
 * Creates a reusable mock for the WebSocket handler used in outbound calls
 * This mock simulates the behavior of the WebSocket handler in outbound-calls.js
 */
export function createMockWsHandler() {
  // Create a mock WebSocket for ElevenLabs
  const mockElevenLabsWs = new MockWebSocket('wss://api.elevenlabs.io/websocket');
  mockElevenLabsWs.send = jest.fn();
  mockElevenLabsWs.close = jest.fn();
  
  // Create a mock WebSocket handler function
  const wsHandler = jest.fn((connection, req) => {
    // Store connections in callStatuses for the appropriate call
    if (!global.callStatuses) {
      global.callStatuses = {};
    }
    
    // Process messages from client
    connection.on('message', (message) => {
      try {
        const data = typeof message === 'string' ? JSON.parse(message) : message;
        
        if (data.event === 'start') {
          const { callSid, customParameters } = data.start;
          
          // Initialize call status if needed
          if (!global.callStatuses[callSid]) {
            global.callStatuses[callSid] = {};
          }
          
          // Store connection and ElevenLabs WebSocket
          global.callStatuses[callSid].wsConnection = connection;
          global.callStatuses[callSid].elevenLabsWs = mockElevenLabsWs;
          
          // Add transcript handler function
          global.callStatuses[callSid].onTranscriptReceived = (transcript) => {
            const { processTranscript } = require('../../forTheLegends/outbound/intent-detector.js');
            
            try {
              // Mark as initialized if not already
              if (!global.callStatuses[callSid].intentInitialized) {
                global.callStatuses[callSid].intentInitialized = true;
              }
              
              // Get the transcript text
              const text = transcript?.transcript_event?.text || '';
              
              // Process the transcript for intent detection
              const intentResult = processTranscript(text, callSid);
              global.callStatuses[callSid].lastIntentResult = intentResult;
              
              // Check if callback intent was detected
              const hasSchedulingIntent = intentResult?.detectedIntents?.includes('schedule_callback');
              
              if (hasSchedulingIntent) {
                // Check if time was specified
                const timeData = global.detectCallbackTime ? global.detectCallbackTime(text) : null;
                
                // Store time data if detected
                if (timeData?.hasTimeReference) {
                  global.callStatuses[callSid].callbackTimeData = timeData;
                  global.callStatuses[callSid].callbackScheduled = true;
                  
                  // Send confirmation to ElevenLabs
                  if (global.callStatuses[callSid].elevenLabsWs?.readyState === 1) {
                    global.callStatuses[callSid].elevenLabsWs.send(JSON.stringify({
                      type: 'custom_instruction',
                      custom_instruction: `The customer has requested a callback at ${timeData.detectedTimes[0] || timeData.detectedRelative[0] || 'a specific time'}. Acknowledge this and confirm the callback time.`
                    }));
                  }
                } 
                // Ask for time if not already prompted and not scheduled
                else if (!global.callStatuses[callSid].timePromptSent && !global.callStatuses[callSid].callbackScheduled) {
                  // Mark as prompted for time to avoid duplicates
                  global.callStatuses[callSid].timePromptSent = true;
                  
                  // Send prompt to ElevenLabs
                  if (global.callStatuses[callSid].elevenLabsWs?.readyState === 1) {
                    global.callStatuses[callSid].elevenLabsWs.send(JSON.stringify({
                      type: 'custom_instruction',
                      custom_instruction: 'The person wants a callback. Please ask them politely when would be a good time for our team to call them back.'
                    }));
                  }
                }
              }
            } catch (error) {
              console.error('Error processing transcript:', error);
            }
          };
          
          // Store lead info if available
          if (customParameters) {
            global.callStatuses[callSid].leadInfo = {
              leadName: customParameters.leadName || 'Unknown',
              careReason: customParameters.careReason || 'Unknown',
              careNeededFor: customParameters.careNeededFor || 'Unknown'
            };
          }
        }
        else if (data.event === 'media') {
          // Handle media - forward to ElevenLabs if a callSid is known
          const callSid = Object.keys(global.callStatuses).find(
            sid => global.callStatuses[sid].wsConnection === connection
          );
          
          if (callSid && global.callStatuses[callSid]?.elevenLabsWs) {
            global.callStatuses[callSid].elevenLabsWs.send(JSON.stringify({
              type: 'user_audio_chunk',
              audio_chunk: data.media.payload
            }));
          }
        }
        else if (data.event === 'stop') {
          // Handle stop - close ElevenLabs connection
          const callSid = Object.keys(global.callStatuses).find(
            sid => global.callStatuses[sid].wsConnection === connection
          );
          
          if (callSid && global.callStatuses[callSid]?.elevenLabsWs) {
            global.callStatuses[callSid].elevenLabsWs.close();
          }
        }
      } catch (error) {
        console.error('Error handling WebSocket message:', error);
      }
    });
    
    // Handle connection close
    connection.on('close', () => {
      // Find the callSid associated with this connection
      const callSid = Object.keys(global.callStatuses || {}).find(
        sid => global.callStatuses[sid]?.wsConnection === connection
      );
      
      if (callSid && global.callStatuses[callSid]?.elevenLabsWs) {
        global.callStatuses[callSid].elevenLabsWs.close();
      }
    });
  });
  
  return { wsHandler, mockElevenLabsWs };
}

// Convenience export for direct use
export const { wsHandler, mockElevenLabsWs } = createMockWsHandler(); 