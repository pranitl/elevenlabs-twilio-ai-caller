import WebSocket from "ws";
import Twilio from "twilio";
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import twilio from "twilio";
import dotenv from "dotenv";

// Import intent detection functionality from existing file
import {
  initializeIntentDetection,
  processTranscript,
  getIntentInstructions,
  hasSchedulingIntent,
  hasNegativeIntent,
  getIntentData
} from './forTheLegends/outbound/intent-detector.js';

// Import retry manager for callback scheduling
import {
  initialize as initRetryManager,
  trackCall,
  scheduleRetryCall
} from './forTheLegends/outbound/retry-manager.js';

dotenv.config();

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

  // Initialize retry manager
  initRetryManager({
    makeWebhookUrl: process.env.MAKE_WEBHOOK_URL
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
    
    // Enhanced transfer logic that considers lead intent
    if (leadStatus === "in-progress" && salesStatus === "in-progress" && !isVoicemail) {
      // Get intent data if it exists
      const intentData = callStatuses[leadCallSid]?.intentData;
      const transferReady = evaluateTransferReadiness(leadCallSid);
      
      console.log(`Evaluating transfer readiness for ${leadCallSid}: ${transferReady ? 'READY' : 'NOT READY'}`);
      
      if (transferReady) {
        console.log(`Intent-based transfer conditions met for ${leadCallSid}. Initiating transfer.`);
        
        // Create a unique conference room name based on the call SID
        const conferenceRoom = `ConferenceRoom_${salesCallSid}`;
        
        // Store conference information for monitoring
        if (!callStatuses[leadCallSid].conference) {
          callStatuses[leadCallSid].conference = {
            room: conferenceRoom,
            leadJoined: false,
            salesJoined: false,
            transferStartTime: Date.now()
          };
        }
        
        // Build the callback URL for conference status events
        const statusCallbackUrl = `${process.env.BASE_URL || `http://${process.env.REPL_SLUG}.repl.co`}/conference-status`;
        
        // Update lead call to join the conference with status callbacks
        try {
          await twilioClient.calls(leadCallSid).update({
            twiml: `<?xml version="1.0" encoding="UTF-8"?>
              <Response>
                <Dial>
                  <Conference 
                    waitUrl="https://twimlets.com/holdmusic?Bucket=com.twilio.music.classical" 
                    beep="false"
                    statusCallback="${statusCallbackUrl}"
                    statusCallbackEvent="join leave"
                    statusCallbackMethod="POST">
                    ${conferenceRoom}
                  </Conference>
                </Dial>
              </Response>`
          });
          
          console.log(`Updated lead call ${leadCallSid} to join conference with status monitoring`);
          
          // Update sales call to join the same conference with status callbacks
          await twilioClient.calls(salesCallSid).update({
            twiml: `<?xml version="1.0" encoding="UTF-8"?>
              <Response>
                <Say>Transferring you to the call now.</Say>
                <Dial>
                  <Conference 
                    waitUrl="https://twimlets.com/holdmusic?Bucket=com.twilio.music.classical" 
                    beep="false"
                    statusCallback="${statusCallbackUrl}"
                    statusCallbackEvent="join leave"
                    statusCallbackMethod="POST">
                    ${conferenceRoom}
                  </Conference>
                </Dial>
              </Response>`
          });
          
          console.log(`Updated sales call ${salesCallSid} to join conference with status monitoring`);
          
          // Start monitoring the conference for successful connection
          setTimeout(() => checkConferenceConnection(leadCallSid, salesCallSid, conferenceRoom), 15000);
          
          // Mark the transfer as initiated
          callStatuses[leadCallSid].transferInitiated = true;
          callStatuses[salesCallSid].transferInitiated = true;
        } catch (error) {
          console.error(`Failed to update calls for transfer:`, error);
        }
      } else {
        console.log(`Transfer not initiated: intent-based conditions not met for ${leadCallSid}`);
      }
    } else {
      console.log(`Transfer conditions not met: lead=${leadStatus}, sales=${salesStatus}, isVoicemail=${isVoicemail}`);
    }
  }

  // Evaluate if lead is ready for transfer based on intent and conversation
  function evaluateTransferReadiness(leadCallSid) {
    if (!callStatuses[leadCallSid]) {
      return false;
    }
    
    // Get transcripts and intent data
    const transcripts = callStatuses[leadCallSid].transcripts || [];
    const intentData = callStatuses[leadCallSid].intentData;
    
    // Default: not ready for transfer
    let transferReady = false;
    
    // Check for positive intent indicators in intent data
    if (intentData?.primaryIntent) {
      const positiveIntents = [
        'needs_more_info',
        'needs_immediate_care'
      ];
      
      if (positiveIntents.includes(intentData.primaryIntent.name)) {
        console.log(`Positive intent detected: ${intentData.primaryIntent.name}`);
        transferReady = true;
      }
    }
    
    // Check for keywords in transcripts
    const positiveKeywords = [
      'interested', 'want to know more', 'tell me more', 
      'speak to someone', 'speak to a person', 'talk to a representative',
      'sounds good', 'that would be helpful', 'need help', 'right away',
      'looking for assistance', 'need care'
    ];
    
    // Check last 3 transcripts from lead for positive keywords
    const leadTranscripts = transcripts
      .filter(t => t.speaker === 'user')
      .slice(-3)
      .map(t => t.text.toLowerCase());
    
    for (const transcript of leadTranscripts) {
      for (const keyword of positiveKeywords) {
        if (transcript.includes(keyword.toLowerCase())) {
          console.log(`Positive keyword detected: "${keyword}" in "${transcript}"`);
          transferReady = true;
          break;
        }
      }
    }
    
    return transferReady;
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
                // Personalize voicemail message using any available lead data
                const leadName = customParameters?.leadName || callStatuses[callSid]?.leadInfo?.LeadName || "";
                const careNeededFor = customParameters?.careNeededFor || callStatuses[callSid]?.leadInfo?.CareNeededFor || "a loved one";
                const careReason = customParameters?.careReason || callStatuses[callSid]?.leadInfo?.CareReason || "home care services";
                
                // Create personalized voicemail instruction
                fullPrompt += `\n\nIMPORTANT: This call has reached a voicemail. Wait for the beep, then leave a personalized message like: "Hello ${leadName ? leadName + ", " : ""}I'm calling from First Light Home Care regarding the care services inquiry ${careNeededFor ? "for " + careNeededFor : ""} ${careReason ? "who needs " + careReason : ""}. Please call us back at (555) 123-4567 at your earliest convenience to discuss how we can help. Thank you."`;
                
                if (!leadName && !careNeededFor && !careReason) {
                  // Fallback to more generic message if no personalization data is available
                  fullPrompt += "\n\nKeep the message concise but warm and professional. Focus on urgency without being pushy.";
                } else {
                  fullPrompt += "\n\nEnsure the message sounds natural and conversational, not like a template. Be concise as voicemails often have time limits.";
                }
                
                console.log(`[ElevenLabs] Adding personalized voicemail instructions for call ${callSid}`);
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
                    
                    const speaker = message.transcript_event.speaker === "agent" ? "ai" : "user";
                    const transcriptText = message.transcript_event.text;
                    
                    callStatuses[callSid].transcripts.push({
                      speaker: speaker,
                      text: transcriptText
                    });
                    
                    // Process transcript for intent detection
                    if (speaker === "user" && transcriptText) {
                      try {
                        // Initialize intent detection if not already done
                        if (!callStatuses[callSid].intentInitialized) {
                          initializeIntentDetection(callSid);
                          callStatuses[callSid].intentInitialized = true;
                        }
                        
                        // Analyze the transcript for intent
                        const intentResult = processTranscript(callSid, transcriptText, 'lead');
                        
                        // Store the updated intent data
                        callStatuses[callSid].intentData = getIntentData(callSid);
                        
                        console.log(`Intent analysis for ${callSid}: ${JSON.stringify(intentResult)}`);
                        
                        // Check if we have a schedule callback intent
                        const hasCallbackIntent = intentResult.intentDetected && 
                                                 intentResult.detectedIntents.includes('schedule_callback');
                        
                        // Check for callback scheduling for either:
                        // 1. When sales team is unavailable 
                        // 2. When the user explicitly requests a callback (schedule_callback intent)
                        if (callStatuses[callSid]?.salesTeamUnavailable || hasCallbackIntent) {
                          // Detect if the transcript contains time references for callbacks
                          const callbackTimeInfo = detectCallbackTime(transcriptText);
                          
                          if (callbackTimeInfo) {
                            console.log(`Detected callback time references in transcript for call ${callSid}:`, callbackTimeInfo);
                            
                            // Store in call status for webhook processing
                            if (!callStatuses[callSid].callbackPreferences) {
                              callStatuses[callSid].callbackPreferences = [];
                            }
                            
                            callStatuses[callSid].callbackPreferences.push({
                              ...callbackTimeInfo,
                              fromIntent: hasCallbackIntent,
                              salesUnavailable: !!callStatuses[callSid]?.salesTeamUnavailable,
                              detectedAt: new Date().toISOString()
                            });
                            
                            // Track this as a potential callback in the retry manager
                            if (!callStatuses[callSid].callbackScheduled) {
                              const leadId = callStatuses[callSid].leadInfo?.LeadId || callSid;
                              const phoneNumber = callStatuses[callSid].leadInfo?.PhoneNumber;
                              
                              // Initialize tracking in retry manager
                              trackCall(leadId, callSid, {
                                phoneNumber,
                                ...callStatuses[callSid].leadInfo,
                                callbackTimeInfo,
                                fromIntent: hasCallbackIntent
                              });
                              
                              callStatuses[callSid].callbackScheduled = true;
                              
                              // If the user explicitly requested a callback but sales team is available,
                              // send an instruction to the AI to confirm the callback schedule
                              if (hasCallbackIntent && !callStatuses[callSid]?.salesTeamUnavailable && 
                                  elevenLabsWs?.readyState === WebSocket.OPEN) {
                                
                                const confirmCallbackInstruction = {
                                  type: "custom_instruction",
                                  instruction: "The caller has requested to schedule a callback instead of speaking now. Confirm the specific day and time they prefer for the callback. Also verify their phone number and ask if there's any additional information our team should know before calling them back. Before ending the call, summarize the callback time and their contact information."
                                };
                                
                                elevenLabsWs.send(JSON.stringify(confirmCallbackInstruction));
                              }
                            }
                          } else if (hasCallbackIntent) {
                            // If we detected a callback intent but no specific time, prompt for a time
                            if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                              const askForTimeInstruction = {
                                type: "custom_instruction",
                                instruction: "The caller seems to want a callback, but hasn't specified a time. Ask them specifically when would be a good time to call them back, asking for a day and time that works best for them."
                              };
                              
                              elevenLabsWs.send(JSON.stringify(askForTimeInstruction));
                            }
                          }
                        }
                        
                        // Get intent-based instructions for the AI
                        const instructions = getIntentInstructions(callSid);
                        if (instructions) {
                          console.log(`Sending intent-based instructions to ElevenLabs: ${instructions}`);
                          const instructionMessage = {
                            type: "custom_instruction",
                            instruction: instructions
                          };
                          if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                            elevenLabsWs.send(JSON.stringify(instructionMessage));
                          }
                        }
                        
                        // Check if we should transfer based on updated intent
                        if (callSid && callStatuses[callSid].salesCallSid) {
                          checkTransferAfterIntent(callSid);
                        }
                      } catch (error) {
                        console.error(`Error processing transcript for intent: ${error}`);
                      }
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
                      
                      // Personalize voicemail message using any available lead data
                      let leadName = "";
                      let careNeededFor = "";
                      let careReason = "";
                      
                      // Try to get data from customParameters first, then from callStatuses
                      if (customParameters) {
                        leadName = customParameters.leadName || "";
                        careNeededFor = customParameters.careNeededFor || "";
                        careReason = customParameters.careReason || "";
                      } else if (callStatuses[callSid]?.leadInfo) {
                        leadName = callStatuses[callSid].leadInfo.LeadName || "";
                        careNeededFor = callStatuses[callSid].leadInfo.CareNeededFor || "a loved one";
                        careReason = callStatuses[callSid].leadInfo.CareReason || "";
                      }
                      
                      // Create personalized voicemail instruction
                      let voicemailInstructionText = "This call has reached a voicemail.";
                      
                      if (leadName || careNeededFor || careReason) {
                        voicemailInstructionText += ` Leave a personalized message like: "Hello ${leadName ? leadName + ", " : ""}I'm calling from First Light Home Care regarding the care services inquiry ${careNeededFor ? "for " + careNeededFor : ""} ${careReason ? "who needs " + careReason : ""}. Please call us back at (555) 123-4567 at your earliest convenience to discuss how we can help. Thank you."`;
                        voicemailInstructionText += " Ensure the message sounds natural and conversational, not like a template.";
                      } else {
                        voicemailInstructionText += " Wait for the beep, then leave a brief message explaining who you are and why you're calling about home care services. Be concise as voicemails often have time limits.";
                      }
                                        
                      // Send instruction to ElevenLabs about voicemail detection
                      const voicemailInstruction = {
                        type: "custom_instruction",
                        instruction: voicemailInstructionText
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
                  
                  // Enhanced instruction explicitly prompting for callback scheduling
                  const unavailableInstruction = {
                    type: "custom_instruction",
                    instruction: "I need to inform the caller that our care specialists are not available right now. Tell them: 'I'm sorry, but our care specialists are currently unavailable to join our call. However, I can schedule a callback for you at a time that works best for you.' Then ask specifically: 'When would be a good time for our team to call you back?' Wait for their response and confirm the specific day and time they prefer. Also verify their contact information (phone number and email) to ensure we have the correct details. Before ending the call, summarize the callback time and their contact information to confirm everything is correct."
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
  
  // Date/time pattern matchers for callback scheduling
  const dateTimePatterns = {
    // Days of the week
    daysOfWeek: /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
    // Times
    times: /\b(([1-9]|1[0-2])(?::([0-5][0-9]))?\s*([ap]\.?m\.?)?)\b/gi,
    // Relative terms
    relativeDays: /\b(tomorrow|later today|this afternoon|this evening|next week)\b/gi,
    // Generic time periods
    timePeriods: /\b(morning|afternoon|evening|night)\b/gi
  };

  /**
   * Detect potential callback time from transcript
   * @param {string} transcript - The transcript text
   * @returns {Object|null} Detected callback time information
   */
  function detectCallbackTime(transcript) {
    if (!transcript) return null;
    
    const lowercaseText = transcript.toLowerCase();
    const result = {
      hasTimeReference: false,
      rawText: transcript,
      detectedDays: [],
      detectedTimes: [],
      detectedRelative: [],
      detectedPeriods: []
    };
    
    // Extract days of the week
    const dayMatches = [...lowercaseText.matchAll(dateTimePatterns.daysOfWeek)];
    if (dayMatches.length > 0) {
      result.hasTimeReference = true;
      result.detectedDays = dayMatches.map(match => match[0]);
    }
    
    // Extract times
    const timeMatches = [...lowercaseText.matchAll(dateTimePatterns.times)];
    if (timeMatches.length > 0) {
      result.hasTimeReference = true;
      result.detectedTimes = timeMatches.map(match => match[0]);
    }
    
    // Extract relative day references
    const relativeMatches = [...lowercaseText.matchAll(dateTimePatterns.relativeDays)];
    if (relativeMatches.length > 0) {
      result.hasTimeReference = true;
      result.detectedRelative = relativeMatches.map(match => match[0]);
    }
    
    // Extract time periods
    const periodMatches = [...lowercaseText.matchAll(dateTimePatterns.timePeriods)];
    if (periodMatches.length > 0) {
      result.hasTimeReference = true;
      result.detectedPeriods = periodMatches.map(match => match[0]);
    }
    
    if (!result.hasTimeReference) return null;
    
    return result;
  }

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
        // Add callback preferences if they exist
        callbackPreferences: callStatuses[callSid]?.callbackPreferences || [],
        timestamp: new Date().toISOString()
      };
      
      // Schedule callback if we have preferences and sales team was unavailable
      if (callStatuses[callSid]?.salesTeamUnavailable && 
          callStatuses[callSid]?.callbackPreferences?.length > 0 &&
          !callStatuses[callSid]?.callbackSchedulingAttempted) {
        
        callStatuses[callSid].callbackSchedulingAttempted = true;
        
        const leadId = callStatuses[callSid].leadInfo?.LeadId || callSid;
        try {
          const scheduleResult = await scheduleRetryCall(leadId);
          console.log(`[Webhook] Callback scheduling result for ${callSid}:`, scheduleResult);
          webhookData.callbackScheduled = scheduleResult.success;
          webhookData.callbackDetails = scheduleResult;
        } catch (error) {
          console.error(`[Webhook] Error scheduling callback for ${callSid}:`, error);
          webhookData.callbackScheduled = false;
          webhookData.callbackError = error.message;
        }
      }
      
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

  // Helper function to check transfer after intent detection
  async function checkTransferAfterIntent(callSid) {
    try {
      await checkAndTransfer(callSid);
    } catch (error) {
      console.error(`Error in transfer after intent detection: ${error}`);
    }
  }

  // Route to handle conference status callbacks
  fastify.post("/conference-status", async (request, reply) => {
    const params = request.body;
    const conferenceSid = params.ConferenceSid;
    const conferenceStatus = params.StatusCallbackEvent;
    const callSid = params.CallSid;
    
    console.log(`[Conference ${conferenceSid}] Status update: ${conferenceStatus} for call ${callSid}`);
    
    // Find which call this is (lead or sales) by checking all active calls
    let leadCallSid = null;
    let salesCallSid = null;
    
    Object.keys(callStatuses).forEach(sid => {
      if (callStatuses[sid].conference?.room === params.FriendlyName) {
        if (sid === callSid) {
          // This is the lead call
          leadCallSid = sid;
          if (conferenceStatus === 'participant-join') {
            callStatuses[sid].conference.leadJoined = true;
            console.log(`[Conference] Lead ${sid} joined the conference`);
          } else if (conferenceStatus === 'participant-leave') {
            callStatuses[sid].conference.leadJoined = false;
            console.log(`[Conference] Lead ${sid} left the conference`);
          }
        } else if (callStatuses[sid].salesCallSid === callSid) {
          // This is the sales call
          salesCallSid = sid;
          if (conferenceStatus === 'participant-join') {
            callStatuses[sid].conference.salesJoined = true;
            console.log(`[Conference] Sales ${callStatuses[sid].salesCallSid} joined the conference`);
          } else if (conferenceStatus === 'participant-leave') {
            callStatuses[sid].conference.salesJoined = false;
            console.log(`[Conference] Sales ${callStatuses[sid].salesCallSid} left the conference`);
          }
        }
        
        // If both parties have joined, mark transfer as complete
        if (callStatuses[sid].conference.leadJoined && callStatuses[sid].conference.salesJoined) {
          console.log(`[Conference] Both parties joined the conference - transfer successful!`);
          callStatuses[sid].transferComplete = true;
          if (callStatuses[sid].salesCallSid) {
            callStatuses[callStatuses[sid].salesCallSid].transferComplete = true;
          }
        }
      }
    });
    
    // Return a 200 response to Twilio
    reply.status(200).send({ success: true });
  });
  
  // Function to check if both parties successfully connected to the conference
  async function checkConferenceConnection(leadCallSid, salesCallSid, conferenceRoom) {
    if (!callStatuses[leadCallSid] || !callStatuses[leadCallSid].conference) {
      console.log(`[Conference] No conference data found for lead ${leadCallSid}`);
      return;
    }
    
    const conferenceData = callStatuses[leadCallSid].conference;
    const transferStartTime = conferenceData.transferStartTime;
    const currentTime = Date.now();
    const transferDuration = (currentTime - transferStartTime) / 1000; // in seconds
    
    console.log(`[Conference] Checking conference connection after ${transferDuration.toFixed(1)} seconds`);
    console.log(`[Conference] Status: Lead joined: ${conferenceData.leadJoined}, Sales joined: ${conferenceData.salesJoined}`);
    
    // If both parties joined, transfer is successful
    if (conferenceData.leadJoined && conferenceData.salesJoined) {
      console.log(`[Conference] Transfer successful! Both parties connected.`);
      callStatuses[leadCallSid].transferComplete = true;
      callStatuses[salesCallSid].transferComplete = true;
      return;
    }
    
    // If transfer has been pending for over 30 seconds and both parties haven't joined,
    // consider it a failed transfer and implement fallback
    if (transferDuration > 30 && (!conferenceData.leadJoined || !conferenceData.salesJoined)) {
      console.log(`[Conference] Transfer failed! Implementing fallback. Lead joined: ${conferenceData.leadJoined}, Sales joined: ${conferenceData.salesJoined}`);
      
      try {
        // Determine which party failed to join
        if (!conferenceData.leadJoined) {
          console.log(`[Conference] Lead failed to join conference. Reconnecting with AI.`);
          
          // End the sales call with an explanation
          if (conferenceData.salesJoined) {
            await twilioClient.calls(salesCallSid).update({
              twiml: `<?xml version="1.0" encoding="UTF-8"?>
                <Response>
                  <Say>We apologize, but the customer appears to have disconnected. The AI will follow up with them later.</Say>
                  <Hangup/>
                </Response>`
            });
          }
          
          // Mark for follow-up
          callStatuses[leadCallSid].needsFollowUp = true;
          
        } else if (!conferenceData.salesJoined) {
          console.log(`[Conference] Sales team failed to join conference. Reconnecting lead with AI.`);
          
          // Reconnect the lead with the AI
          await twilioClient.calls(leadCallSid).update({
            twiml: `<?xml version="1.0" encoding="UTF-8"?>
              <Response>
                <Say>We apologize, but we're having trouble connecting you with our team. Let me help you instead.</Say>
                <Connect>
                  <Stream url="wss://${process.env.REPL_SLUG}.repl.co/elevenlabs-stream">
                    <Parameter name="callSid" value="${leadCallSid}"/>
                    <Parameter name="transferFailed" value="true"/>
                  </Stream>
                </Connect>
              </Response>`
          });
          
          // Reset the websocket connection for the lead
          setupElevenLabsWebSocket(leadCallSid, true);
        }
        
        // Mark transfer as failed
        callStatuses[leadCallSid].transferFailed = true;
        callStatuses[salesCallSid].transferFailed = true;
        
      } catch (error) {
        console.error(`[Conference] Error implementing fallback for failed transfer:`, error);
      }
    } else if (transferDuration <= 30) {
      // Check again in 10 seconds if we're still within the 30-second window
      setTimeout(() => checkConferenceConnection(leadCallSid, salesCallSid, conferenceRoom), 10000);
    }
  }
}
