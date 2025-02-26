import WebSocket from "ws";
import Twilio from "twilio";

// Store call statuses
const callStatuses = {};

// Store the most recent request host for use in callbacks
let mostRecentHost = null;

// Define the base prompt for ElevenLabs
const basePrompt = `You are Heather, a friendly and warm care coordinator for First Light Home Care, a home healthcare company. You're calling to follow up on care service inquiries with a calm and reassuring voice, using natural pauses to make the conversation feel more human-like. Your main goals are:
1. Verify the details submitted in the care request from the Point of Contact for the 'Care Needed For'.
2. Show empathy for the care situation.
3. Confirm interest in receiving care services for the 'Care Needed For'.
4. Set expectations for next steps, which are to discuss with a care specialist.

Use casual, friendly language, avoiding jargon and technical terms, to make the lead feel comfortable and understood. Listen carefully and address concerns with empathy, focusing on building rapport. If asked about pricing, explain that a care specialist will discuss detailed pricing options soon. If the person is not interested, thank them for their time and end the call politely.

If our care team is not available to join the call, kindly explain to the person that our care specialists are currently unavailable but will contact them soon. Verify their contact information (phone number and/or email) to make sure it matches what we have on file, and ask if there's a preferred time for follow-up. Be sure to confirm all their information is correct before ending the call.

IMPORTANT: When the call connects, wait for the person to say hello or acknowledge the call before you start speaking. If they don't say anything within 2-3 seconds, then begin with a warm greeting. Always start with a natural greeting like 'Hello' and pause briefly before continuing with your introduction.`;

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
        machineDetection: "DetectMessageEnd",
        asyncAmd: true,
        asyncAmdStatusCallback: `https://${request.headers.host}/amd-callback`,
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
    const leadName = request.query.leadName || "";
    const careReason = request.query.careReason || "";
    const careNeededFor = request.query.careNeededFor || "";

    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Say>You're being connected to an AI-assisted call with ${leadName || "a potential client"}. 
        The AI will speak with the lead about ${careReason || "home care services"} 
        ${careNeededFor ? `for ${careNeededFor}` : ""}.
        Please wait while we connect you. If the call goes to voicemail, you will be notified.</Say>
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

  // AMD (Answering Machine Detection) callback
  fastify.post("/amd-callback", async (request, reply) => {
    const { CallSid, AnsweredBy } = request.body;
    console.log(`[Twilio] AMD result for call ${CallSid}: ${AnsweredBy}`);
    
    if (callStatuses[CallSid]) {
      // Store the AMD result in our call status
      callStatuses[CallSid].answeredBy = AnsweredBy;
      
      const salesCallSid = callStatuses[CallSid].salesCallSid;

      // Scenario 1: Lead got voicemail and sales team hasn't joined yet
      if (AnsweredBy === "machine_start" || AnsweredBy === "machine_end_beep" || 
          AnsweredBy === "machine_end_silence" || AnsweredBy === "machine_end_other") {
        
        console.log(`[Twilio] Voicemail detected for lead call ${CallSid}`);
        callStatuses[CallSid].isVoicemail = true;
        
        // Check if sales team has joined
        if (salesCallSid && callStatuses[salesCallSid]?.salesStatus === "in-progress") {
          // Sales team already joined, they'll leave the voicemail
          console.log(`[Twilio] Sales team already on call, they will leave voicemail for ${CallSid}`);
          
          // Notify sales team that they're connected to a voicemail
          try {
            await twilioClient.calls(salesCallSid).update({
              twiml: `<?xml version="1.0" encoding="UTF-8"?>
                <Response>
                  <Say>The AI is now leaving a voicemail. Please wait until transfer is complete.</Say>
                  <Pause length="2"/>
                </Response>`
            });
          } catch (error) {
            console.error(`Failed to update sales call ${salesCallSid} with voicemail notification:`, error);
          }
        } else {
          // Sales team hasn't joined, AI should leave voicemail
          console.log(`[Twilio] Sales team not joined, AI will leave voicemail for ${CallSid}`);
          
          // Notify ElevenLabs that we're in voicemail mode through custom instruction
          // This will be handled by the WebSocket connection
        }
      }
      
      // Human answered, proceed normally
      if (AnsweredBy === "human") {
        console.log(`[Twilio] Human answered call ${CallSid}, proceeding normally`);
        callStatuses[CallSid].isVoicemail = false;
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
         CallStatus.toLowerCase() === "no-answer" ||
         CallStatus.toLowerCase() === "canceled") && 
        !callStatuses[CallSid].transferComplete
      ) {
        const leadCallSid = callStatuses[CallSid].leadCallSid;
        console.log(`Sales call ${CallSid} ended before transfer completed. Continuing with AI handling lead call ${leadCallSid}`);
        
        // Sales team didn't answer or disconnected - send custom instruction to ElevenLabs
        if (leadCallSid && callStatuses[leadCallSid]?.leadStatus === "in-progress") {
          callStatuses[leadCallSid].salesTeamUnavailable = true;
          console.log(`[Sales] Team unavailable for call ${leadCallSid}, instructing AI to handle the conversation`);
          
          // Check if ElevenLabs connection is active to send instruction
          // This will be handled when processing the next media event in the WebSocket connection
        }
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
    const isVoicemail = callStatuses[leadCallSid]?.isVoicemail;
    
    console.log(`Checking transfer conditions for lead=${leadStatus}, sales=${salesStatus}, isVoicemail=${isVoicemail}`);
    
    // If we know it's a voicemail and the sales team is ready, notify them
    if (isVoicemail && salesStatus === "in-progress") {
      console.log(`Lead call ${leadCallSid} is a voicemail and sales team is ready`);
      
      try {
        await twilioClient.calls(salesCallSid).update({
          twiml: `<?xml version="1.0" encoding="UTF-8"?>
            <Response>
              <Say>The AI is now leaving a voicemail. Please wait until transfer is complete.</Say>
              <Pause length="2"/>
            </Response>`
        });
      } catch (error) {
        console.error(`Failed to update sales call ${salesCallSid}:`, error);
      }
      
      return;
    }
    
    // Regular transfer logic for human answers
    if (leadStatus === "in-progress" && salesStatus === "in-progress" && !isVoicemail) {
      console.log(`Both parties are ready and it's not a voicemail. Initiating transfer for ${leadCallSid}`);
      
      // Create a unique conference room name based on the call SID
      const conferenceRoom = `ConferenceRoom_${salesCallSid}`;
      
      // Update lead call to join the conference
      try {
        await twilioClient.calls(leadCallSid).update({
          twiml: `<?xml version="1.0" encoding="UTF-8"?>
            <Response>
              <Dial>
                <Conference waitUrl="https://twimlets.com/holdmusic?Bucket=com.twilio.music.classical" beep="false">
                  ${conferenceRoom}
                </Conference>
              </Dial>
            </Response>`
        });
        
        console.log(`Updated lead call ${leadCallSid} to join conference`);
        
        // Update sales call to join the same conference
        await twilioClient.calls(salesCallSid).update({
          twiml: `<?xml version="1.0" encoding="UTF-8"?>
            <Response>
              <Say>Transferring you to the call now.</Say>
              <Dial>
                <Conference waitUrl="https://twimlets.com/holdmusic?Bucket=com.twilio.music.classical" beep="false">
                  ${conferenceRoom}
                </Conference>
              </Dial>
            </Response>`
        });
        
        console.log(`Updated sales call ${salesCallSid} to join conference`);
        
        // Mark the transfer as complete to signal that ElevenLabs connection can be closed
        callStatuses[leadCallSid].transferComplete = true;
        callStatuses[salesCallSid].transferComplete = true;
      } catch (error) {
        console.error(`Failed to update calls for transfer:`, error);
      }
    } else {
      console.log(`Transfer conditions not met: lead=${leadStatus}, sales=${salesStatus}, isVoicemail=${isVoicemail}`);
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
        let conversationId = null;

        ws.on("error", console.error);

        const setupElevenLabs = async () => {
          try {
            const signedUrl = await getSignedUrl();
            console.log(`[ElevenLabs] Got signed URL for call ${callSid}`);
            elevenLabsWs = new WebSocket(signedUrl);

            elevenLabsWs.on("open", () => {
              console.log("[ElevenLabs] Connected to Conversational AI");

              // Prepare the prompt with voicemail instructions if needed
              let fullPrompt = basePrompt;
              
              // If we already know this is a voicemail (detected by AMD earlier), 
              // add voicemail handling instructions
              if (callSid && callStatuses[callSid]?.isVoicemail) {
                fullPrompt += `\n\nIMPORTANT: This call has reached a voicemail. Wait for the beep, then leave a brief message explaining who you are, why you're calling about home care services, and leave a callback number. Be concise as voicemails often have time limits.`;
                console.log(`[ElevenLabs] Adding voicemail instructions for call ${callSid}`);
              }

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
                
                // Store conversation ID when available
                if (message.conversation_id && !conversationId) {
                  conversationId = message.conversation_id;
                  console.log(`[ElevenLabs] Got conversation ID ${conversationId} for call ${callSid}`);
                  
                  if (callSid) {
                    callStatuses[callSid].conversationId = conversationId;
                  }
                }
                
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
                  
                  // If we haven't already detected a voicemail, check for prolonged silence
                  // which might indicate a voicemail system
                  if (callSid && !callStatuses[callSid]?.isVoicemail) {
                    // We could track silence duration and possibly infer voicemail based on the pattern
                    // This is a complex detection that could be implemented if needed
                  }
                } else if (message.type === "transcript" && message.transcript_event?.text) {
                  // Store transcripts for later use
                  if (callSid) {
                    if (!callStatuses[callSid].transcripts) {
                      callStatuses[callSid].transcripts = [];
                    }
                    
                    callStatuses[callSid].transcripts.push({
                      speaker: message.transcript_event.speaker || "unknown",
                      text: message.transcript_event.text
                    });
                  }
                  
                  // Check transcript for voicemail indicators
                  const transcript = message.transcript_event.text.toLowerCase();
                  if ((transcript.includes("leave a message") || 
                       transcript.includes("not available") || 
                       transcript.includes("after the tone") || 
                       transcript.includes("after the beep")) && 
                      callSid && !callStatuses[callSid]?.isVoicemail) {
                    
                    console.log(`[ElevenLabs] Potential voicemail detected from transcript for call ${callSid}: "${transcript}"`);
                    callStatuses[callSid].isVoicemail = true;
                    
                    // Send instruction to ElevenLabs about voicemail detection
                    const voicemailInstruction = {
                      type: "custom_instruction",
                      instruction: "This call has reached a voicemail. Wait for the beep, then leave a brief message explaining who you are and why you're calling. Be concise as voicemails often have time limits."
                    };
                    elevenLabsWs.send(JSON.stringify(voicemailInstruction));
                    
                    // Notify sales team if they're on the call
                    const salesCallSid = callStatuses[callSid]?.salesCallSid;
                    if (salesCallSid && callStatuses[salesCallSid]?.salesStatus === "in-progress") {
                      try {
                        twilioClient.calls(salesCallSid).update({
                          twiml: `<?xml version="1.0" encoding="UTF-8"?>
                            <Response>
                              <Say>The AI is now leaving a voicemail. Please wait until transfer is complete.</Say>
                              <Pause length="2"/>
                            </Response>`
                        });
                      } catch (error) {
                        console.error(`[ElevenLabs] Failed to update sales call ${salesCallSid}:`, error);
                      }
                    }
                  }
                }
              } catch (error) {
                console.error("[ElevenLabs] Error processing message:", error);
              }
            });

            elevenLabsWs.on("error", (error) =>
              console.error("[ElevenLabs] WebSocket error:", error),
            );
            elevenLabsWs.on("close", () => {
              console.log("[ElevenLabs] Disconnected");
              
              // When WebSocket closes, check if we need to send data to make.com webhook
              if (callSid && conversationId) {
                sendCallDataToWebhook(callSid, conversationId);
              }
            });
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
                
                // Store custom parameters in call statuses for later use in webhook
                if (callSid) {
                  callStatuses[callSid].leadInfo = customParameters;
                }
                
                // Check if we already know this is a voicemail from a previous AMD detection
                if (callSid && callStatuses[callSid]?.isVoicemail) {
                  console.log(`[Twilio] Call ${callSid} is known to be a voicemail`);
                  
                  // If the ElevenLabs connection is already established, send a message to inform it that
                  // this is a voicemail and to use the appropriate prompt/behavior
                  if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                    const voicemailInstruction = {
                      type: "custom_instruction",
                      instruction: "This call has reached a voicemail. Wait for the beep, then leave a brief message explaining who you are and why you're calling. Be concise as voicemails often have time limits."
                    };
                    elevenLabsWs.send(JSON.stringify(voicemailInstruction));
                  }
                }
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
                
                // Check if sales team is unavailable and we haven't informed ElevenLabs yet
                if (callSid && 
                    callStatuses[callSid]?.salesTeamUnavailable && 
                    !callStatuses[callSid]?.salesTeamUnavailableInstructionSent && 
                    elevenLabsWs?.readyState === WebSocket.OPEN) {
                  
                  console.log(`[Twilio] Informing AI that sales team is unavailable for call ${callSid}`);
                  
                  // Send instruction to ElevenLabs to verify contact info and handle the call
                  const unavailableInstruction = {
                    type: "custom_instruction",
                    instruction: "I need to inform the caller that right now our care specialists are not available to join this call. Clearly state that no one is available at this moment but our team will contact them soon. Verify their contact information including phone number and email, specifically confirming that it matches what they previously submitted in their inquiry. Ask if there's a preferred time for our team to follow up. Be sure to confirm all their information is correct before ending the call."
                  };
                  elevenLabsWs.send(JSON.stringify(unavailableInstruction));
                  
                  // Mark that we've sent the instruction
                  callStatuses[callSid].salesTeamUnavailableInstructionSent = true;
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
  
  // Function to fetch conversation details from ElevenLabs and send to make.com webhook
  async function sendCallDataToWebhook(callSid, conversationId) {
    try {
      console.log(`[Webhook] Preparing to send data for call ${callSid} with conversation ${conversationId}`);
      
      // Only proceed if this was a call where sales team was unavailable or it was a voicemail
      if (!callStatuses[callSid]?.salesTeamUnavailable && !callStatuses[callSid]?.isVoicemail) {
        console.log(`[Webhook] No need to send data for call ${callSid} - sales team handled the call`);
        return;
      }
      
      // Get conversation transcript and summary from ElevenLabs
      let transcriptData = null;
      let summaryData = null;
      
      // First try to get transcripts from our stored data
      const storedTranscripts = callStatuses[callSid]?.transcripts || [];
      
      // If we have stored transcripts, use them
      if (storedTranscripts.length > 0) {
        transcriptData = {
          conversation_id: conversationId,
          transcripts: storedTranscripts
        };
      }
      
      // Otherwise, try to fetch from ElevenLabs API
      if (!transcriptData) {
        try {
          console.log(`[ElevenLabs] Fetching transcript for conversation ${conversationId}`);
          const transcriptResponse = await fetch(
            `https://api.elevenlabs.io/v1/convai/conversation/${conversationId}/transcript`,
            {
              method: "GET",
              headers: { "xi-api-key": ELEVENLABS_API_KEY },
            }
          );
          
          if (transcriptResponse.ok) {
            transcriptData = await transcriptResponse.json();
            console.log(`[ElevenLabs] Successfully fetched transcript for conversation ${conversationId}`);
          } else {
            console.error(`[ElevenLabs] Failed to fetch transcript: ${transcriptResponse.statusText}`);
          }
        } catch (error) {
          console.error(`[ElevenLabs] Error fetching transcript: ${error.message}`);
        }
      }
      
      // Try to get summary from ElevenLabs API
      try {
        console.log(`[ElevenLabs] Fetching summary for conversation ${conversationId}`);
        const summaryResponse = await fetch(
          `https://api.elevenlabs.io/v1/convai/conversation/${conversationId}/summary`,
          {
            method: "GET",
            headers: { "xi-api-key": ELEVENLABS_API_KEY },
          }
        );
        
        if (summaryResponse.ok) {
          summaryData = await summaryResponse.json();
          console.log(`[ElevenLabs] Successfully fetched summary for conversation ${conversationId}`);
        } else {
          console.error(`[ElevenLabs] Failed to fetch summary: ${summaryResponse.statusText}`);
        }
      } catch (error) {
        console.error(`[ElevenLabs] Error fetching summary: ${error.message}`);
      }
      
      // Prepare data for webhook
      const webhookData = {
        call_sid: callSid,
        conversation_id: conversationId,
        is_voicemail: callStatuses[callSid]?.isVoicemail || false,
        sales_team_unavailable: callStatuses[callSid]?.salesTeamUnavailable || false,
        lead_info: callStatuses[callSid]?.leadInfo || {},
        transcript: transcriptData,
        summary: summaryData,
        timestamp: new Date().toISOString()
      };
      
      // Send data to make.com webhook
      console.log(`[Webhook] Sending data to make.com for call ${callSid}`);
      try {
        const webhookResponse = await fetch(
          "https://hook.us2.make.com/5ir0yfumo72gh0i4ittsrnm3pav0v7bq",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(webhookData),
          }
        );
        
        if (webhookResponse.ok) {
          console.log(`[Webhook] Successfully sent data to make.com for call ${callSid}`);
        } else {
          console.error(`[Webhook] Failed to send data to make.com: ${webhookResponse.statusText}`);
        }
      } catch (error) {
        console.error(`[Webhook] Error sending data to webhook: ${error.message}`);
      }
    } catch (error) {
      console.error(`[Webhook] Unexpected error: ${error.message}`);
    }
  }
}
