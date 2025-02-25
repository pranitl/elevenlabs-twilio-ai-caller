import WebSocket from "ws";
import Twilio from "twilio";

export function registerOutboundRoutes(fastify) {
  // Check for required environment variables
  const { 
    ELEVENLABS_API_KEY, 
    ELEVENLABS_AGENT_ID,
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER
  } = process.env;

  if (!ELEVENLABS_API_KEY || !ELEVENLABS_AGENT_ID || !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    console.error("Missing required environment variables");
    throw new Error("Missing required environment variables");
  }

  // Initialize Twilio client
  const twilioClient = new Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

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

  // Route to initiate outbound calls
  fastify.post("/outbound-call", async (request, reply) => {
    try {
      // Process the lead data from the request
      const leadData = request.body;

      // Validate the lead data
      if (!Array.isArray(leadData) || leadData.length === 0) {
        return reply.code(400).send({ 
          success: false, 
          error: "Invalid lead data format. Expected a non-empty array." 
        });
      }

      const lead = leadData[0]; // Get the first lead from the array

      // Extract phone number and prompt
      if (!lead.PhoneNumber && !lead.prompt) {
        return reply.code(400).send({ 
          success: false, 
          error: "Lead data must contain either PhoneNumber or a phone number in the prompt" 
        });
      }

      // Extract phone number - either directly from PhoneNumber field or extract from prompt
      let phoneNumber = lead.PhoneNumber;
      if (!phoneNumber && lead.prompt) {
        // Try to find a phone number in the prompt using regex
        const phoneRegex = /\+\d{10,15}/;
        const match = lead.prompt.match(phoneRegex);
        if (match) {
          phoneNumber = match[0];
        }
      }

      if (!phoneNumber) {
        return reply.code(400).send({ 
          success: false, 
          error: "Could not determine phone number from lead data" 
        });
      }

      // Prepare the lead data as JSON string to pass to TwiML
      const leadDataJson = JSON.stringify(lead);

      // Initiate the call
      const call = await twilioClient.calls.create({
        from: TWILIO_PHONE_NUMBER,
        to: phoneNumber,
        url: `https://${request.headers.host}/outbound-call-twiml?leadData=${encodeURIComponent(leadDataJson)}`
      });

      reply.send({ 
        success: true, 
        message: "Call initiated", 
        callSid: call.sid,
        leadData: lead
      });
    } catch (error) {
      console.error("Error initiating outbound call:", error);
      reply.code(500).send({ 
        success: false, 
        error: "Failed to initiate call" 
      });
    }
  });

  // TwiML route for outbound calls
  fastify.all("/outbound-call-twiml", async (request, reply) => {
    const leadData = request.query.leadData || '{}';

    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Connect>
          <Stream url="wss://${request.headers.host}/outbound-media-stream">
            <Parameter name="leadData" value="${leadData}" />
          </Stream>
        </Connect>
      </Response>`;

    reply.type("text/xml").send(twimlResponse);
  });

  // WebSocket route for handling media streams
  fastify.register(async (fastifyInstance) => {
    fastifyInstance.get("/outbound-media-stream", { websocket: true }, (ws, req) => {
      console.info("[Server] Twilio connected to outbound media stream");

      // Variables to track the call
      let streamSid = null;
      let callSid = null;
      let elevenLabsWs = null;
      let leadData = null;

      // Handle WebSocket errors
      ws.on('error', console.error);

      // Set up ElevenLabs connection
      const setupElevenLabs = async () => {
        try {
          const signedUrl = await getSignedUrl();
          elevenLabsWs = new WebSocket(signedUrl);

          elevenLabsWs.on("open", () => {
            console.log("[ElevenLabs] Connected to Conversational AI");

            // Only proceed if we have lead data
            if (leadData) {
              // Format the first message based on lead data
              let firstMessage = "Hello, I'm calling about the care services you inquired about. May I speak with you for a moment?";

              // Create a properly formatted prompt for the ElevenLabs agent
              let promptText = leadData.prompt || "";

              // If no custom prompt exists, create one from the lead data
              if (!promptText && leadData.PoC && leadData.CareNeededFor && leadData.CareReason) {
                promptText = `Your name is Heather and you are a care coordinator calling to follow up about a care request. 
                You are calling ${leadData.PoC} who submitted a request for ${leadData.CareNeededFor}. 
                The care reason provided was: ${leadData.CareReason}
                Your goal is to verify the details they submitted, show empathy, and confirm their interest in care services.
                Be conversational, friendly, and professional. If they ask about next steps, let them know a care specialist will be in touch shortly to discuss care options and pricing.`;
              }

              // Send initial configuration with prompt and first message
              const initialConfig = {
                type: "conversation_initiation_client_data",
                conversation_config_override: {
                  agent: {
                    prompt: { prompt: promptText },
                    first_message: firstMessage,
                  },
                }
              };

              console.log("[ElevenLabs] Sending initial config with prompt for lead:", leadData.PoC || "Unknown");

              // Send the configuration to ElevenLabs
              elevenLabsWs.send(JSON.stringify(initialConfig));
            } else {
              console.error("[ElevenLabs] No lead data available for conversation initialization");
            }
          });

          elevenLabsWs.on("message", (data) => {
            try {
              const message = JSON.parse(data);

              switch (message.type) {
                case "conversation_initiation_metadata":
                  console.log("[ElevenLabs] Received initiation metadata");
                  break;

                case "audio":
                  if (streamSid) {
                    if (message.audio?.chunk) {
                      // Skip audio data that contains "break time" messages
                      const audioBase64 = message.audio.chunk;
                      // Only send audio if it doesn't contain the "break time" markers
                      if (!shouldSkipAudio(audioBase64)) {
                        const audioData = {
                          event: "media",
                          streamSid,
                          media: {
                            payload: audioBase64
                          }
                        };
                        ws.send(JSON.stringify(audioData));
                      }
                    } else if (message.audio_event?.audio_base_64) {
                      // Skip audio data that contains "break time" messages
                      const audioBase64 = message.audio_event.audio_base_64;
                      // Only send audio if it doesn't contain the "break time" markers
                      if (!shouldSkipAudio(audioBase64)) {
                        const audioData = {
                          event: "media",
                          streamSid,
                          media: {
                            payload: audioBase64
                          }
                        };
                        ws.send(JSON.stringify(audioData));
                      }
                    }
                  } else {
                    console.log("[ElevenLabs] Received audio but no StreamSid yet");
                  }
                  break;

                case "interruption":
                  if (streamSid) {
                    ws.send(JSON.stringify({ 
                      event: "clear",
                      streamSid 
                    }));
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

                default:
                  console.log(`[ElevenLabs] Unhandled message type: ${message.type}`);
              }
            } catch (error) {
              console.error("[ElevenLabs] Error processing message:", error);
            }
          });

          elevenLabsWs.on("error", (error) => {
            console.error("[ElevenLabs] WebSocket error:", error);
          });

          elevenLabsWs.on("close", () => {
            console.log("[ElevenLabs] Disconnected");
          });

        } catch (error) {
          console.error("[ElevenLabs] Setup error:", error);
        }
      };

      // Set up ElevenLabs connection
      setupElevenLabs();

      // Handle messages from Twilio
      ws.on("message", (message) => {
        try {
          const msg = JSON.parse(message);
          console.log(`[Twilio] Received event: ${msg.event}`);

          switch (msg.event) {
            case "start":
              streamSid = msg.start.streamSid;
              callSid = msg.start.callSid;

              // Parse the lead data from the custom parameters
              if (msg.start.customParameters && msg.start.customParameters.leadData) {
                try {
                  leadData = JSON.parse(msg.start.customParameters.leadData);
                  console.log('[Twilio] Received lead data:', leadData);
                } catch (e) {
                  console.error('[Twilio] Error parsing lead data:', e);
                }
              }

              console.log(`[Twilio] Stream started - StreamSid: ${streamSid}, CallSid: ${callSid}`);
              break;

            case "media":
              if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                const audioMessage = {
                  user_audio_chunk: Buffer.from(msg.media.payload, "base64").toString("base64")
                };
                elevenLabsWs.send(JSON.stringify(audioMessage));
              }
              break;

            case "stop":
              console.log(`[Twilio] Stream ${streamSid} ended`);
              if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                elevenLabsWs.close();
              }
              break;

            default:
              console.log(`[Twilio] Unhandled event: ${msg.event}`);
          }
        } catch (error) {
          console.error("[Twilio] Error processing message:", error);
        }
      });

      // Handle WebSocket closure
      ws.on("close", () => {
        console.log("[Twilio] Client disconnected");
        if (elevenLabsWs?.readyState === WebSocket.OPEN) {
          elevenLabsWs.close();
        }
      });
    });
  });
}

// Add helper function to detect "break time" markers
const shouldSkipAudio = (audioBase64) => {
  try {
    // Check if this is a system message like "break time"
    // These are often very short audio clips with specific patterns
    // You may need to adjust this logic based on your specific "break time" messages
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
};