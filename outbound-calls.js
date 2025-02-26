import WebSocket from "ws";
import Twilio from "twilio";

// Store call statuses
const callStatuses = {};

// Store the most recent request host for use in callbacks
let mostRecentHost = null;

export function registerOutboundRoutes(fastify) {
  const {
    ELEVENLABS_API_KEY,
    ELEVENLABS_AGENT_ID,
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER,
    SALES_TEAM_PHONE_NUMBER,
  } = process.env;

  if (
    !ELEVENLABS_API_KEY ||
    !ELEVENLABS_AGENT_ID ||
    !TWILIO_ACCOUNT_SID ||
    !TWILIO_AUTH_TOKEN ||
    !TWILIO_PHONE_NUMBER ||
    !SALES_TEAM_PHONE_NUMBER
  ) {
    console.error("Missing required environment variables");
    throw new Error("Missing required environment variables");
  }

  const twilioClient = new Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

  // Middleware to track the most recent host
  fastify.addHook('onRequest', (request, reply, done) => {
    if (request.headers.host) {
      mostRecentHost = request.headers.host;
      console.log(`Updated most recent host: ${mostRecentHost}`);
    }
    done();
  });

  // Add a route to serve the handoff.mp3 file directly
  fastify.get('/audio/handoff.mp3', (request, reply) => {
    reply.sendFile('handoff.mp3');
  });

  async function getSignedUrl() {
    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${ELEVENLABS_AGENT_ID}`,
        {
          method: "GET",
          headers: { "xi-api-key": ELEVENLABS_API_KEY },
        },
      );
      if (!response.ok)
        throw new Error(`Failed to get signed URL: ${response.statusText}`);
      const data = await response.json();
      return data.signed_url;
    } catch (error) {
      console.error("Error getting signed URL:", error);
      throw error;
    }
  }

  // Route to initiate outbound calls with sales team handoff
  fastify.post("/outbound-call-to-sales", async (request, reply) => {
    const { number, prompt, leadinfo } = request.body;

    if (!number)
      return reply.code(400).send({ error: "Phone number is required" });

    try {
      console.log("Initiating lead call to:", number);
      console.log("Lead info:", JSON.stringify(leadinfo));
      
      const leadCall = await twilioClient.calls.create({
        from: TWILIO_PHONE_NUMBER,
        to: number,
        url: `https://${request.headers.host}/outbound-call-twiml?prompt=${encodeURIComponent(prompt || "")}&leadName=${encodeURIComponent(leadinfo?.LeadName || "")}&careReason=${encodeURIComponent(leadinfo?.CareReason || "")}&careNeededFor=${encodeURIComponent(leadinfo?.CareNeededFor || "")}`,
        statusCallback: `https://${request.headers.host}/lead-status`,
        statusCallbackEvent: ["initiated", "answered", "completed"],
      });

      const salesCall = await twilioClient.calls.create({
        from: TWILIO_PHONE_NUMBER,
        to: SALES_TEAM_PHONE_NUMBER,
        url: `https://${request.headers.host}/sales-team-twiml?leadName=${encodeURIComponent(leadinfo?.LeadName || "")}&careReason=${encodeURIComponent(leadinfo?.CareReason || "")}&careNeededFor=${encodeURIComponent(leadinfo?.CareNeededFor || "")}`,
        statusCallback: `https://${request.headers.host}/sales-status`,
        statusCallbackEvent: ["initiated", "answered", "completed"],
      });

      callStatuses[leadCall.sid] = {
        leadStatus: "initiated",
        salesCallSid: salesCall.sid,
      };
      callStatuses[salesCall.sid] = {
        salesStatus: "initiated",
        leadCallSid: leadCall.sid,
      };

      console.log("Initiating sales call to:", SALES_TEAM_PHONE_NUMBER);
      console.log("Lead call SID:", leadCall.sid);
      console.log("Sales call SID:", salesCall.sid);

      reply.send({
        success: true,
        message: "Calls initiated",
        leadCallSid: leadCall.sid,
        salesCallSid: salesCall.sid,
      });
    } catch (error) {
      console.error("Error initiating calls:", error);
      reply
        .code(500)
        .send({ success: false, error: "Failed to initiate calls" });
    }
  });

  // TwiML for lead's call (AI agent)
  fastify.all("/outbound-call-twiml", async (request, reply) => {
    const prompt = request.query.prompt || "";
    const leadName = request.query.leadName || "";
    const careReason = request.query.careReason || "";
    const careNeededFor = request.query.careNeededFor || "";

    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Pause length="1"/>
        <Connect>
          <Stream url="wss://${request.headers.host}/outbound-media-stream">
            <Parameter name="prompt" value="${prompt}" />
            <Parameter name="leadName" value="${leadName}" />
            <Parameter name="careReason" value="${careReason}" />
            <Parameter name="careNeededFor" value="${careNeededFor}" />
          </Stream>
        </Connect>
      </Response>`;
    reply.type("text/xml").send(twimlResponse);
  });

  // TwiML for sales team with lead context
  fastify.all("/sales-team-twiml", async (request, reply) => {
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Pause length="60"/>
      </Response>`;
    reply.type("text/xml").send(twimlResponse);
  });

  // Status callback for lead
  fastify.post("/lead-status", async (request, reply) => {
    const { CallSid, CallStatus } = request.body;
    if (callStatuses[CallSid]) {
      const previousStatus = callStatuses[CallSid].leadStatus;
      callStatuses[CallSid].leadStatus = CallStatus.toLowerCase();
      console.log(`Lead status updated: ${CallSid} - ${CallStatus}`);
      
      // Lead call is now in progress - ElevenLabs should connect
      if (previousStatus !== "in-progress" && CallStatus.toLowerCase() === "in-progress") {
        console.log(`Lead call ${CallSid} is now active. ElevenLabs should connect via /outbound-media-stream.`);
        // Check if we can transfer to sales (if they're already on the line)
        await checkAndTransfer(CallSid);
      }
      
      // If call ended and we haven't completed the transfer, clean up
      if (
        (CallStatus.toLowerCase() === "completed" || 
         CallStatus.toLowerCase() === "busy" || 
         CallStatus.toLowerCase() === "failed" || 
         CallStatus.toLowerCase() === "no-answer") && 
        !callStatuses[CallSid].transferComplete
      ) {
        const salesCallSid = callStatuses[CallSid].salesCallSid;
        console.log(`Lead call ${CallSid} ended before transfer completed. Ending related sales call ${salesCallSid}`);
        
        // End the corresponding sales call if it's still in progress
        if (salesCallSid && callStatuses[salesCallSid]?.salesStatus === "in-progress") {
          try {
            await twilioClient.calls(salesCallSid).update({ status: "completed" });
          } catch (error) {
            console.error(`Failed to end sales call ${salesCallSid}:`, error);
          }
        }
      }
    }
    reply.send();
  });

  // Status callback for sales team
  fastify.post("/sales-status", async (request, reply) => {
    const { CallSid, CallStatus } = request.body;
    if (callStatuses[CallSid]) {
      const previousStatus = callStatuses[CallSid].salesStatus;
      callStatuses[CallSid].salesStatus = CallStatus.toLowerCase();
      console.log(`Sales status updated: ${CallSid} - ${CallStatus}`);
      
      // If call ended and we haven't completed the transfer, clean up
      if (
        (CallStatus.toLowerCase() === "completed" || 
         CallStatus.toLowerCase() === "busy" || 
         CallStatus.toLowerCase() === "failed" || 
         CallStatus.toLowerCase() === "no-answer") && 
        !callStatuses[CallSid].transferComplete
      ) {
        const leadCallSid = callStatuses[CallSid].leadCallSid;
        console.log(`Sales call ${CallSid} ended before transfer completed. Continuing with AI handling lead call ${leadCallSid}`);
        // No need to end the lead call - the AI can continue handling it
      } else if (previousStatus !== "in-progress" && CallStatus.toLowerCase() === "in-progress") {
        // Call just became in-progress, check if we can transfer
        const leadCallSid = callStatuses[CallSid].leadCallSid;
        await checkAndTransfer(leadCallSid);
      }
    }
    reply.send();
  });

  // Check and transfer when both are ready
  async function checkAndTransfer(leadCallSid) {
    const leadStatus = callStatuses[leadCallSid]?.leadStatus;
    const salesCallSid = callStatuses[leadCallSid]?.salesCallSid;
    const salesStatus = callStatuses[salesCallSid]?.salesStatus;

    console.log(`Checking transfer: lead=${leadStatus}, sales=${salesStatus}`);

    // If lead call becomes active and sales call is not, we should make sure ElevenLabs is handling it
    if (leadStatus === "in-progress" && (!salesStatus || salesStatus !== "in-progress")) {
      console.log(`Lead call ${leadCallSid} active but sales not ready. Ensuring ElevenLabs handles the call.`);
      // We don't need to do anything special - the ElevenLabs WebSocket connection 
      // will be established when the call connects in the outbound-media-stream endpoint
    }
    
    if (leadStatus === "in-progress" && salesStatus === "in-progress") {
      console.log(`Bridging calls: lead=${leadCallSid}, sales=${salesCallSid}`);
      try {
        // Use the stored host value or fall back to the Replit domain
        const serverHost = mostRecentHost || "elevenlabs-twilio-ai-caller-spicywalnut.replit.app";
        console.log(`Using server host for transfer: ${serverHost}`);
        
        // Generate a unique conference room name
        const conferenceRoom = `ConferenceRoom_${salesCallSid}`;
        console.log(`Creating conference room: ${conferenceRoom}`);
        
        // Mark calls as being transferred in the status before the API call
        callStatuses[leadCallSid].transferInProgress = true;
        callStatuses[salesCallSid].transferInProgress = true;
        callStatuses[leadCallSid].conferenceRoom = conferenceRoom;
        callStatuses[salesCallSid].conferenceRoom = conferenceRoom;
        
        // First redirect the lead to the conference
        console.log(`Redirecting lead ${leadCallSid} to conference`);
        await twilioClient.calls(leadCallSid).update({
          url: `https://${serverHost}/transfer-twiml?salesCallSid=${salesCallSid}`,
        });
        
        // Then redirect the sales team to the same conference
        console.log(`Redirecting sales ${salesCallSid} to conference`);
        await twilioClient.calls(salesCallSid).update({
          url: `https://${serverHost}/join-conference?conferenceRoom=${conferenceRoom}`,
        });
        
        console.log(`Transfer initiated: ${leadCallSid} and ${salesCallSid} to conference ${conferenceRoom}`);
      } catch (error) {
        // Reset the flags if the transfer failed
        callStatuses[leadCallSid].transferInProgress = false;
        callStatuses[salesCallSid].transferInProgress = false;
        console.error(`Transfer failed:`, error);
      }
    } else {
      console.log(`Transfer conditions not met: lead=${leadStatus}, sales=${salesStatus}`);
    }
  }

  // TwiML for handoff
  fastify.all("/transfer-twiml", async (request, reply) => {
    const salesCallSid = request.query.salesCallSid;
    console.log(`Handling transfer request for sales call: ${salesCallSid}`);
    
    const leadCallSid = Object.keys(callStatuses).find(
      sid => callStatuses[sid].salesCallSid === salesCallSid
    );
    
    console.log(`Found matching lead call: ${leadCallSid}`);

    // Mark the transfer as complete to signal that ElevenLabs connection can be closed
    if (leadCallSid) {
      callStatuses[leadCallSid].transferComplete = true;
      callStatuses[salesCallSid].transferComplete = true;
    } else {
      console.error(`Could not find lead call for sales call ${salesCallSid}`);
    }

    // Get the server host to construct the audio URL
    const serverHost = mostRecentHost || request.headers.host;
    
    // Use the local handoff.mp3 file instead of text-to-speech
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Play>https://${serverHost}/audio/handoff.mp3</Play>
        <Dial>
          <Conference waitUrl="https://twimlets.com/holdmusic?Bucket=com.twilio.music.classical" statusCallbackEvent="join leave" beep="false">
            ConferenceRoom_${salesCallSid}
          </Conference>
        </Dial>
      </Response>`;
    
    console.log(`Sending transfer TwiML response for call ${leadCallSid} with audio URL: https://${serverHost}/audio/handoff.mp3`);
    reply.type("text/xml").send(twimlResponse);
  });

  // TwiML to join sales team to the conference
  fastify.all("/join-conference", async (request, reply) => {
    const conferenceRoomSid = request.query.conferenceRoom;
    console.log(`Joining sales team to conference: ${conferenceRoomSid}`);
    
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Dial>
          <Conference waitUrl="https://twimlets.com/holdmusic?Bucket=com.twilio.music.classical" beep="false">
            ${conferenceRoomSid}
          </Conference>
        </Dial>
      </Response>`;
    
    reply.type("text/xml").send(twimlResponse);
  });

  // WebSocket route for AI agent
  fastify.register(async (fastifyInstance) => {
    fastifyInstance.get(
      "/outbound-media-stream",
      { websocket: true },
      (ws, req) => {
        console.info("[Server] Twilio connected to outbound media stream");

        let streamSid = null;
        let callSid = null;
        let elevenLabsWs = null;
        let customParameters = null;

        ws.on("error", console.error);

        const setupElevenLabs = async () => {
          try {
            const signedUrl = await getSignedUrl();
            elevenLabsWs = new WebSocket(signedUrl);

            elevenLabsWs.on("open", () => {
              console.log("[ElevenLabs] Connected to Conversational AI");

              const leadInfoText = `Lead Name: ${customParameters?.leadName || "Unknown"}
Care Reason: ${customParameters?.careReason || "Unknown"}
Care Needed For: ${customParameters?.careNeededFor || "Unknown"}`;

              const fullPrompt = `${customParameters?.prompt || "You are Heather, a friendly and warm care coordinator for First Light Home Care, a home healthcare company. You're calling to follow up on care service inquiries with a calm and reassuring voice, using natural pauses to make the conversation feel more human-like. Your main goals are: 1. Verify the details submitted in the care request from the Point of Contact below for the 'Care Needed For'. 2. Show empathy for the care situation. 3. Confirm interest in receiving care services for the 'Care Needed For'. 4. Set expectations for next steps, which are to discuss with a care specialist. Use casual, friendly language, avoiding jargon and technical terms, to make the lead feel comfortable and understood. Listen carefully and address concerns with empathy, focusing on building rapport. If asked about pricing, explain that a care specialist will discuss detailed pricing options soon. If the person is not interested, thank them for their time and end the call politely."}\n\nHere are some additional key details from the obtained lead to guide the conversation:\n${leadInfoText}\n\nIMPORTANT: When the call connects, wait for the person to say hello or acknowledge the call before you start speaking. If they don't say anything within 2-3 seconds, then begin with a warm greeting. Always start with a natural greeting like 'Hello' and pause briefly before continuing with your introduction.`;

              // Set up the conversation with wait_for_user_speech set to true
              const initialConfig = {
                type: "conversation_initiation_client_data",
                conversation_config_override: {
                  agent: {
                    prompt: { prompt: fullPrompt },
                    first_message: `Hello, this is Heather from First Light Home Care. I'm calling about the care services inquiry for ${customParameters?.careNeededFor}. Is this ${customParameters?.leadName || "there"}?`,
                    wait_for_user_speech: true,
                  },
                  conversation: {
                    initial_audio_silence_timeout_ms: 3000, // Wait 3 seconds for user to speak before starting
                  }
                },
              };
              elevenLabsWs.send(JSON.stringify(initialConfig));
            });

            elevenLabsWs.on("message", (data) => {
              try {
                const message = JSON.parse(data);
                if (message.type === "audio" && streamSid) {
                  console.log(`[ElevenLabs] Sending AI audio to call ${callSid}`);
                  const audioData = {
                    event: "media",
                    streamSid,
                    media: {
                      payload:
                        message.audio?.chunk ||
                        message.audio_event?.audio_base_64,
                    },
                  };
                  ws.send(JSON.stringify(audioData));
                } else if (message.type === "interruption" && streamSid) {
                  console.log(`[ElevenLabs] Interruption detected, clearing buffer for call ${callSid}`);
                  ws.send(JSON.stringify({ event: "clear", streamSid }));
                } else if (message.type === "speech_started") {
                  console.log(`[ElevenLabs] AI agent started speaking on call ${callSid}`);
                } else if (message.type === "speech_ended") {
                  console.log(`[ElevenLabs] AI agent finished speaking on call ${callSid}`);
                } else if (message.type === "waiting_for_user_speech") {
                  console.log(`[ElevenLabs] AI agent waiting for user to speak on call ${callSid}`);
                }
              } catch (error) {
                console.error("[ElevenLabs] Error processing message:", error);
              }
            });

            elevenLabsWs.on("error", (error) =>
              console.error("[ElevenLabs] WebSocket error:", error),
            );
            elevenLabsWs.on("close", () =>
              console.log("[ElevenLabs] Disconnected"),
            );
          } catch (error) {
            console.error("[ElevenLabs] Setup error:", error);
          }
        };

        setupElevenLabs();

        ws.on("message", (message) => {
          try {
            const msg = JSON.parse(message);
            console.log(`[Twilio] Received event: ${msg.event}`);
            switch (msg.event) {
              case "start":
                streamSid = msg.start.streamSid;
                callSid = msg.start.callSid;
                customParameters = msg.start.customParameters;
                console.log(
                  `[Twilio] Stream started - StreamSid: ${streamSid}, CallSid: ${callSid}`,
                );
                console.log("[Twilio] Custom parameters:", customParameters);
                break;
              case "media":
                // Check if we should close the ElevenLabs connection because the call has been transferred
                if (callSid && callStatuses[callSid]?.transferComplete) {
                  console.log(`[Twilio] Call ${callSid} has been transferred, closing ElevenLabs connection`);
                  if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                    elevenLabsWs.close();
                  }
                  break;
                }
                
                if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                  // Log when we receive user audio to help debug conversation flow
                  if (msg.media.payload && Buffer.from(msg.media.payload, "base64").length > 0) {
                    console.log(`[Twilio] Received user audio from call ${callSid}`);
                  }
                  
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
                console.log(`[Twilio] Stream ${streamSid} ended`);
                if (elevenLabsWs?.readyState === WebSocket.OPEN)
                  elevenLabsWs.close();
                break;
            }
          } catch (error) {
            console.error("[Twilio] Error processing message:", error);
          }
        });

        ws.on("close", () => {
          console.log("[Twilio] Client disconnected");
          if (elevenLabsWs?.readyState === WebSocket.OPEN) elevenLabsWs.close();
        });
      },
    );
  });
}