import WebSocket from "ws";
import Twilio from "twilio";
import path from "path";
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function registerOutboundRoutes(fastify) {
  // Check for required environment variables
  const { 
    ELEVENLABS_API_KEY, 
    ELEVENLABS_AGENT_ID,
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER,
    SALES_TEAM_PHONE_NUMBER
  } = process.env;

  if (!ELEVENLABS_API_KEY || !ELEVENLABS_AGENT_ID || !TWILIO_ACCOUNT_SID || 
      !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    console.error("Missing required environment variables");
    throw new Error("Missing required environment variables");
  }

  // Initialize Twilio client
  const twilioClient = new Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  
  // Track active calls for bridging
  const activeCalls = new Map();

  // Helper function to get signed URL for authenticated conversations
  async function getSignedUrl() {
    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${ELEVENLABS_AGENT_ID}`,
        {
          method: 'GET',
          headers: {
            'xi-api-key': ELEVENLABS_API_KEY
          }
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to get signed URL: ${response.statusText}`);
      }

      const data = await response.json();
      return data.signed_url;
    } catch (error) {
      console.error("Error getting signed URL:", error);
      throw error;
    }
  }

  // Route to initiate outbound calls to both lead and sales
  fastify.post("/outbound-call-to-sales", async (request, reply) => {
    try {
      const leadData = request.body;
      
      // Validate input
      if (!leadData.number) {
        return reply.code(400).send({ 
          success: false, 
          error: "Lead phone number is required" 
        });
      }

      const leadPhoneNumber = leadData.number;
      const salesPhoneNumber = SALES_TEAM_PHONE_NUMBER || leadData.salesNumber;
      
      if (!salesPhoneNumber) {
        return reply.code(400).send({ 
          success: false, 
          error: "Sales team phone number is required in env vars or request" 
        });
      }

      // Create a unique ID for this call flow
      const flowId = `flow_${Date.now()}`;
      
      // Store call data
      activeCalls.set(flowId, {
        leadPhoneNumber,
        salesPhoneNumber,
        leadCallSid: null,
        salesCallSid: null,
        leadStatus: 'initiated',
        salesStatus: 'initiated',
        conferenceCreated: false
      });

      // First call the lead
      console.log(`[Outbound] Initiating call to lead: ${leadPhoneNumber}`);
      const leadCall = await twilioClient.calls.create({
        from: TWILIO_PHONE_NUMBER,
        to: leadPhoneNumber,
        url: `https://${request.headers.host}/lead-call-handler?flowId=${flowId}`,
        statusCallback: `https://${request.headers.host}/lead-status-callback?flowId=${flowId}`,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        statusCallbackMethod: 'POST'
      });
      
      // Update lead call SID
      const callData = activeCalls.get(flowId);
      activeCalls.set(flowId, {
        ...callData,
        leadCallSid: leadCall.sid
      });

      // Then call the sales team
      console.log(`[Outbound] Initiating call to sales team: ${salesPhoneNumber}`);
      const salesCall = await twilioClient.calls.create({
        from: TWILIO_PHONE_NUMBER,
        to: salesPhoneNumber,
        url: `https://${request.headers.host}/sales-call-handler?flowId=${flowId}`,
        statusCallback: `https://${request.headers.host}/sales-status-callback?flowId=${flowId}`,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        statusCallbackMethod: 'POST'
      });
      
      // Update sales call SID
      const updatedCallData = activeCalls.get(flowId);
      activeCalls.set(flowId, {
        ...updatedCallData,
        salesCallSid: salesCall.sid
      });

      reply.send({ 
        success: true, 
        message: "Calls initiated", 
        flowId,
        leadCallSid: leadCall.sid,
        salesCallSid: salesCall.sid
      });
    } catch (error) {
      console.error("Error initiating outbound calls:", error);
      reply.code(500).send({ 
        success: false, 
        error: "Failed to initiate calls" 
      });
    }
  });

  // Handle status callbacks for lead call
  fastify.post("/lead-status-callback", async (request, reply) => {
    const { flowId } = request.query;
    const callStatus = request.body.CallStatus;
    console.log(`[Outbound] Lead call status update: ${callStatus}, Flow ID: ${flowId}`);
    
    if (flowId && activeCalls.has(flowId)) {
      const callData = activeCalls.get(flowId);
      activeCalls.set(flowId, {
        ...callData,
        leadStatus: callStatus
      });

      // If lead hangs up, terminate the call flow
      if (callStatus === 'completed' && callData.salesStatus !== 'in-progress') {
        cleanupCallFlow(flowId);
      }
    }
    
    reply.send({ success: true });
  });

  // Handle status callbacks for sales call
  fastify.post("/sales-status-callback", async (request, reply) => {
    const { flowId } = request.query;
    const callStatus = request.body.CallStatus;
    console.log(`[Outbound] Sales call status update: ${callStatus}, Flow ID: ${flowId}`);
    
    if (flowId && activeCalls.has(flowId)) {
      const callData = activeCalls.get(flowId);
      activeCalls.set(flowId, {
        ...callData,
        salesStatus: callStatus
      });
      
      // If both parties are connected, potentially bridge the calls
      if (callStatus === 'in-progress' && callData.leadStatus === 'in-progress' && !callData.conferenceCreated) {
        await bridgeCalls(flowId);
      }

      // If sales team hangs up, terminate the call flow
      if (callStatus === 'completed') {
        cleanupCallFlow(flowId);
      }
    }
    
    reply.send({ success: true });
  });
  
  // Helper function to clean up call flow
  function cleanupCallFlow(flowId) {
    if (activeCalls.has(flowId)) {
      console.log(`[Outbound] Cleaning up call flow: ${flowId}`);
      activeCalls.delete(flowId);
    }
  }

  // Helper function to bridge calls
  async function bridgeCalls(flowId) {
    if (!activeCalls.has(flowId)) return;
    
    const callData = activeCalls.get(flowId);
    if (callData.conferenceCreated) return;
    
    try {
      console.log(`[Outbound] Bridging calls for flow: ${flowId}`);
      
      // Create a conference for both parties
      const conferenceName = `conf_${flowId}`;
      
      // Get the server address for the TwiML URLs
      const serverAddress = fastify.server.address();
      const hostname = serverAddress.address === '::' ? 'localhost' : serverAddress.address;
      const baseUrl = `https://${request.headers.host || `${hostname}:${serverAddress.port}`}`;
      
      // Update lead call to join conference
      await twilioClient.calls(callData.leadCallSid)
        .update({
          twiml: `<Response>
                   <Play>${baseUrl}/handoff.mp3</Play>
                   <Dial>
                     <Conference>${conferenceName}</Conference>
                   </Dial>
                 </Response>`
        });
      
      // Update sales call to join conference
      await twilioClient.calls(callData.salesCallSid)
        .update({
          twiml: `<Response>
                   <Dial>
                     <Conference>${conferenceName}</Conference>
                   </Dial>
                 </Response>`
        });
      
      // Mark as conference created
      activeCalls.set(flowId, {
        ...callData,
        conferenceCreated: true
      });
      
      console.log(`[Outbound] Successfully bridged calls for flow: ${flowId}`);
    } catch (error) {
      console.error(`[Outbound] Error bridging calls for flow ${flowId}:`, error);
    }
  }

  // TwiML for lead call
  fastify.all("/lead-call-handler", async (request, reply) => {
    const { flowId } = request.query;
    console.log(`[Outbound] Handling lead call for flow: ${flowId}`);
    
    // Connect to ElevenLabs for AI conversation while waiting for sales team
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Connect>
          <Stream url="wss://${request.headers.host}/lead-media-stream?flowId=${flowId}" />
        </Connect>
      </Response>`;

    reply.type("text/xml").send(twimlResponse);
  });

  // TwiML for sales call
  fastify.all("/sales-call-handler", async (request, reply) => {
    const { flowId } = request.query;
    console.log(`[Outbound] Handling sales call for flow: ${flowId}`);
    
    // If lead is already connected, bridge the calls
    if (flowId && activeCalls.has(flowId)) {
      const callData = activeCalls.get(flowId);
      
      if (callData.leadStatus === 'in-progress') {
        // Lead is active, bridge the calls
        const conferenceName = `conf_${flowId}`;
        
        const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
          <Response>
            <Say>Connecting you with the lead now.</Say>
            <Dial>
              <Conference>${conferenceName}</Conference>
            </Dial>
          </Response>`;
        
        // Mark as conference created
        activeCalls.set(flowId, {
          ...callData,
          conferenceCreated: true
        });
        
        reply.type("text/xml").send(twimlResponse);
        return;
      }
    }
    
    // Otherwise, have the sales team wait
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Say>Please wait while we connect you with a lead.</Say>
        <Play loop="10">https://${request.headers.host}/handoff.mp3</Play>
      </Response>`;

    reply.type("text/xml").send(twimlResponse);
  });

  // WebSocket for lead call streams
  fastify.register(async (fastifyInstance) => {
    fastifyInstance.get("/lead-media-stream", { websocket: true }, async (connection, req) => {
      console.info("[Server] Twilio connected to lead media stream");
      const { flowId } = req.query;

      let streamSid = null;
      let callSid = null;
      let elevenLabsWs = null;

      try {
        // Get authenticated WebSocket URL
        const signedUrl = await getSignedUrl();

        // Connect to ElevenLabs
        elevenLabsWs = new WebSocket(signedUrl);

        // Handle open event for ElevenLabs WebSocket
        elevenLabsWs.on("open", () => {
          console.log("[ElevenLabs] Connected to Conversational AI");
          
          // Create initial prompt for the AI conversation
          const initialConfig = {
            type: "conversation_initiation_client_data",
            conversation_config_override: {
              agent: {
                prompt: { prompt: "You are Heather, a care coordinator. Be conversational, show empathy, and engage with the caller. Your job is to keep them engaged until our care specialist joins the call. When that happens, you will no longer be needed." },
                first_message: "Hello, this is Heather from care services. Thanks for your interest in our services. I'd like to learn a bit more about your needs while we wait for our care specialist to join us. Could you tell me a little about what kind of care you're looking for?",
              },
            }
          };
          
          elevenLabsWs.send(JSON.stringify(initialConfig));
        });

        // Handle messages from ElevenLabs
        elevenLabsWs.on("message", (data) => {
          try {
            const message = JSON.parse(data);
            
            switch (message.type) {
              case "conversation_initiation_metadata":
                console.log("[ElevenLabs] Received initiation metadata");
                break;
              case "audio":
                if (streamSid) {
                  // Check if this call is still active or has been bridged
                  if (flowId && activeCalls.has(flowId) && !activeCalls.get(flowId).conferenceCreated) {
                    if (message.audio?.chunk) {
                      // Skip "break time" messages
                      const audioBase64 = message.audio.chunk;
                      if (!shouldSkipAudio(audioBase64)) {
                        const audioData = {
                          event: "media",
                          streamSid,
                          media: {
                            payload: audioBase64
                          }
                        };
                        connection.send(JSON.stringify(audioData));
                      }
                    } else if (message.audio_event?.audio_base_64) {
                      // Skip "break time" messages
                      const audioBase64 = message.audio_event.audio_base_64;
                      if (!shouldSkipAudio(audioBase64)) {
                        const audioData = {
                          event: "media",
                          streamSid,
                          media: {
                            payload: audioBase64
                          }
                        };
                        connection.send(JSON.stringify(audioData));
                      }
                    }
                  } else {
                    console.log("[ElevenLabs] Call has been bridged, no longer sending AI audio");
                  }
                }
                break;
              case "interruption":
                if (streamSid) {
                  connection.send(JSON.stringify({ event: "clear", streamSid }));
                }
                break;
              case "ping":
                if (message.ping_event?.event_id) {
                  elevenLabsWs.send(JSON.stringify({
                    type: "pong",
                    event_id: message.ping_event.event_id
                  }));
                }
                break;
            }
          } catch (error) {
            console.error("[ElevenLabs] Error processing message:", error);
          }
        });

        // Handle errors and closure for ElevenLabs WebSocket
        elevenLabsWs.on("error", (error) => {
          console.error("[ElevenLabs] WebSocket error:", error);
        });

        elevenLabsWs.on("close", () => {
          console.log("[ElevenLabs] Disconnected");
        });

        // Handle messages from Twilio
        connection.on("message", async (message) => {
          try {
            const data = JSON.parse(message);
            
            switch (data.event) {
              case "start":
                streamSid = data.start.streamSid;
                callSid = data.start.callSid;
                console.log(`[Twilio] Stream started with ID: ${streamSid}, CallSid: ${callSid}`);
                
                // Update the call status
                if (flowId && activeCalls.has(flowId)) {
                  const callData = activeCalls.get(flowId);
                  activeCalls.set(flowId, {
                    ...callData,
                    leadStatus: 'in-progress'
                  });
                  
                  // If sales team is already connected, bridge the calls
                  if (callData.salesStatus === 'in-progress' && !callData.conferenceCreated) {
                    await bridgeCalls(flowId);
                  }
                }
                break;
              case "media":
                if (elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
                  // Only send if we're not bridged yet
                  if (flowId && activeCalls.has(flowId) && !activeCalls.get(flowId).conferenceCreated) {
                    const audioMessage = {
                      user_audio_chunk: Buffer.from(data.media.payload, "base64").toString("base64")
                    };
                    elevenLabsWs.send(JSON.stringify(audioMessage));
                  }
                }
                break;
              case "stop":
                console.log(`[Twilio] Stream ${streamSid} ended`);
                if (elevenLabsWs) {
                  elevenLabsWs.close();
                }
                // Clean up call flow data
                if (flowId) {
                  cleanupCallFlow(flowId);
                }
                break;
            }
          } catch (error) {
            console.error("[Twilio] Error processing message:", error);
          }
        });

        // Handle connection closure
        connection.on("close", () => {
          console.log("[Twilio] Client disconnected");
          if (elevenLabsWs) {
            elevenLabsWs.close();
          }
        });

        // Handle connection errors
        connection.on("error", (error) => {
          console.error("[Twilio] WebSocket error:", error);
          if (elevenLabsWs) {
            elevenLabsWs.close();
          }
        });

      } catch (error) {
        console.error("[Server] Error initializing lead conversation:", error);
        if (elevenLabsWs) {
          elevenLabsWs.close();
        }
        connection.socket.close();
      }
    });
  });
  
  // Helper function to detect "break time" markers
  function shouldSkipAudio(audioBase64) {
    try {
      // Check if this is a system message like "break time"
      // These are often very short audio clips with specific patterns
      const buffer = Buffer.from(audioBase64, 'base64');
      // Very short audio segments (less than certain size) might be system messages
      if (buffer.length < 1000) {
        console.log("[ElevenLabs] Skipping potential system message audio chunk");
        return true;
      }
      return false;
    } catch (e) {
      console.error("[ElevenLabs] Error checking audio content:", e);
      return false;
    }
  }
}