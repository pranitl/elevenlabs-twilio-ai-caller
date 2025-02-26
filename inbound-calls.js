import WebSocket from "ws";

export function registerInboundRoutes(fastify) {
  // Check for the required environment variables
  const { 
    ELEVENLABS_API_KEY, 
    ELEVENLABS_AGENT_ID,
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN, 
    TWILIO_PHONE_NUMBER,
    SALES_TEAM_PHONE_NUMBER 
  } = process.env;

  // Track active call data
  const activeInboundCalls = {};

  // Check for the required environment variables
  if (!SALES_TEAM_PHONE_NUMBER) {
    console.error("Missing required environment variable: SALES_TEAM_PHONE_NUMBER");
    throw new Error("Missing SALES_TEAM_PHONE_NUMBER environment variable");
  }

  if (!ELEVENLABS_API_KEY || !ELEVENLABS_AGENT_ID) {
    console.error("Missing required environment variables for ElevenLabs integration");
    throw new Error("Missing ElevenLabs configuration variables");
  }

  // Route to handle initial incoming calls with verification
  fastify.all("/incoming-call", async (request, reply) => {
    const callSid = request.body.CallSid;
    const from = request.body.From;
    const to = request.body.To;
    
    console.log(`[Twilio] Received incoming call from ${from} to ${to} with SID ${callSid}`);
    
    // Store call details
    activeInboundCalls[callSid] = {
      from,
      to,
      startTime: new Date(),
      verified: false
    };
    
    // Generate TwiML for initial caller verification
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Gather numDigits="1" action="/verify-caller" method="POST" timeout="10">
          <Say>Thank you for calling. To speak with our sales team, please press 1. To leave a message, press 2.</Say>
        </Gather>
        <Say>We didn't receive any input. Goodbye.</Say>
        <Hangup/>
      </Response>`;

    reply.type("text/xml").send(twimlResponse);
  });
  
  // Route to handle caller verification responses
  fastify.all("/verify-caller", async (request, reply) => {
    const callSid = request.body.CallSid;
    const digits = request.body.Digits;
    const from = request.body.From;
    
    console.log(`[Twilio] Received verification input: ${digits} for call ${callSid}`);
    
    if (activeInboundCalls[callSid]) {
      activeInboundCalls[callSid].verified = true;
    }
    
    let twimlResponse;
    
    if (digits === "1") {
      // Caller verified - forward to sales team
      console.log(`[Twilio] Caller ${from} verified. Forwarding to sales team.`);
      
      twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Say>Thank you. Connecting you to our sales team now.</Say>
          <Dial callerId="${TWILIO_PHONE_NUMBER}">
            ${SALES_TEAM_PHONE_NUMBER}
          </Dial>
        </Response>`;
    } else if (digits === "2") {
      // Caller wants to leave a message - connect to ElevenLabs AI
      console.log(`[Twilio] Caller ${from} requested to leave a message. Connecting to AI.`);
      
      twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Say>Thank you. Our AI assistant will help you leave a message.</Say>
          <Connect>
            <Stream url="wss://${process.env.REPL_SLUG || 'localhost'}.repl.co/inbound-ai-stream">
              <Parameter name="callSid" value="${callSid}"/>
              <Parameter name="direction" value="inbound"/>
            </Stream>
          </Connect>
        </Response>`;
      
      // Setup the ElevenLabs WebSocket connection for this call
      setupElevenLabsWebSocket(callSid);
    } else {
      // Invalid input
      twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Say>Invalid selection. Goodbye.</Say>
          <Hangup/>
        </Response>`;
    }
    
    reply.type("text/xml").send(twimlResponse);
  });

  // Legacy route - keep this for backward compatibility but redirect to the new verification endpoint
  fastify.all("/incoming-call-eleven", async (request, reply) => {
    console.log("[Twilio] Received incoming call on legacy endpoint, redirecting to verification flow");
    
    // Redirect to the main incoming call endpoint
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Redirect>/incoming-call</Redirect>
      </Response>`;

    reply.type("text/xml").send(twimlResponse);
  });
  
  // WebSocket route for ElevenLabs AI integration
  fastify.register(async function (fastify) {
    fastify.get('/inbound-ai-stream', { websocket: true }, (connection, req) => {
      console.log('[WebSocket] New connection for inbound AI stream');
      
      connection.socket.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());
          
          if (data.event === 'start') {
            const callSid = data.start.callSid;
            console.log(`[WebSocket] Call ${callSid} connected to inbound AI stream`);
            
            // Store WebSocket connection in the active call data
            if (activeInboundCalls[callSid]) {
              activeInboundCalls[callSid].wsConnection = connection;
            }
          }
          
          // Handle other events (media, transcription, etc.)
          
        } catch (error) {
          console.error('[WebSocket] Error processing message:', error);
        }
      });
      
      connection.socket.on('close', () => {
        console.log('[WebSocket] Connection closed for inbound AI stream');
      });
    });
  });
  
  // Function to set up the ElevenLabs WebSocket connection
  async function setupElevenLabsWebSocket(callSid) {
    console.log(`[ElevenLabs] Setting up connection for inbound call ${callSid}`);
    
    try {
      // Create WebSocket connection to ElevenLabs
      const ws = new WebSocket(`wss://api.elevenlabs.io/v1/speech-to-speech/agents/${ELEVENLABS_AGENT_ID}/calls`);
      
      ws.on('open', () => {
        console.log(`[ElevenLabs] WebSocket connection opened for call ${callSid}`);
        
        // Send initialization message
        const initMessage = {
          action: "initialize",
          call_id: callSid,
          api_key: ELEVENLABS_API_KEY,
          conversation_history: [
            {
              "role": "system",
              "content": "You are a helpful AI assistant taking a message for the sales team. Be polite, friendly, and collect the caller's name, contact information, and their reason for calling. Let them know the sales team will get back to them soon."
            }
          ]
        };
        
        ws.send(JSON.stringify(initMessage));
      });
      
      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        console.log(`[ElevenLabs] Received message from AI:`, message.type);
        
        // Forward AI responses to Twilio
        if (activeInboundCalls[callSid]?.wsConnection) {
          activeInboundCalls[callSid].wsConnection.socket.send(data);
        }
      });
      
      ws.on('close', () => {
        console.log(`[ElevenLabs] WebSocket closed for call ${callSid}`);
        
        // Clean up call data
        delete activeInboundCalls[callSid];
      });
      
      ws.on('error', (error) => {
        console.error(`[ElevenLabs] WebSocket error for call ${callSid}:`, error);
      });
      
      // Store the ElevenLabs WebSocket connection
      if (activeInboundCalls[callSid]) {
        activeInboundCalls[callSid].elevenLabsWs = ws;
      }
    } catch (error) {
      console.error(`[ElevenLabs] Error setting up WebSocket for call ${callSid}:`, error);
    }
  }
}