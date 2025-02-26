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

  // Check for the required environment variables
  if (!SALES_TEAM_PHONE_NUMBER) {
    console.error("Missing required environment variable: SALES_TEAM_PHONE_NUMBER");
    throw new Error("Missing SALES_TEAM_PHONE_NUMBER environment variable");
  }

  // Route to handle incoming calls from Twilio
  fastify.all("/incoming-call", async (request, reply) => {
    console.log("[Twilio] Received incoming call, forwarding to sales team");
    
    // Simple TwiML to forward the call to the sales team number
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Dial callerId="${TWILIO_PHONE_NUMBER}">
          ${SALES_TEAM_PHONE_NUMBER}
        </Dial>
      </Response>`;

    reply.type("text/xml").send(twimlResponse);
  });

  // Legacy route - keep this for backward compatibility but redirect to the new forwarding endpoint
  fastify.all("/incoming-call-eleven", async (request, reply) => {
    console.log("[Twilio] Received incoming call on legacy endpoint, forwarding to sales team");
    
    // Simple TwiML to forward the call to the sales team number
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Dial callerId="${TWILIO_PHONE_NUMBER}">
          ${SALES_TEAM_PHONE_NUMBER}
        </Dial>
      </Response>`;

    reply.type("text/xml").send(twimlResponse);
  });
}