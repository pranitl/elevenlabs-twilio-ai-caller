<think>This request has multiple parts:
1. Create sample payloads for each of the 3 webhooks
2. Create LLM prompts for processing each webhook payload
3. Suggest how to use LLMs to transform the data for Google Sheets insertion
4. Recommend how to handle transcripts in the Google Sheet
5. Show how to structure JSON outputs from the LLM for data transformation

I need to create realistic sample payloads that align with the fields discovered earlier and show how they differ between the three webhook types (main, callback, voicemail).</think># Complete Webhook-to-Google Sheets Implementation with LLM Integration

## Sample Webhook Payloads

Let's start with realistic sample payloads for each webhook type, then build the LLM prompts and data integration strategy.

### 1. Main Webhook (Standard Call) - Sample Payload

```json
{
  "call_sid": "CA8971d5f689c345cda83458f174c472b9",
  "conversation_id": "conv_a45b789cd012ef",
  "is_voicemail": false,
  "sales_team_unavailable": false,
  "lead_info": {
    "LeadId": "LD78392",
    "LeadName": "Sarah Johnson",
    "LeadPhone": "+14155559876",
    "LeadEmail": "sarah.j@example.com",
    "LeadSource": "website_inquiry",
    "AssignedAgent": "Michael Roberts"
  },
  "timestamp": "2023-07-25T14:32:10.456Z",
  "source_module": "outbound-webhook",
  "call_metadata": {
    "transferInitiated": false,
    "transferComplete": false,
    "callbackScheduled": false,
    "answeredBy": "human"
  },
  "transcript": {
    "conversation_id": "conv_a45b789cd012ef",
    "transcripts": [
      { "speaker": "ai", "text": "Hello, this is Alex from ForTheLegends Health Services. Am I speaking with Sarah Johnson?" },
      { "speaker": "lead", "text": "Yes, this is Sarah." },
      { "speaker": "ai", "text": "Great to connect with you, Sarah. I'm calling regarding the home health care services you inquired about on our website. Is now a good time to discuss how we might be able to help you or your loved one?" },
      { "speaker": "lead", "text": "Actually, I was just looking for pricing information. How much do your services cost?" },
      { "speaker": "ai", "text": "I understand you're interested in pricing. Our services typically range from $25 to $40 per hour depending on the level of care needed. We offer customized care plans based on individual needs. May I ask who you're looking into care services for?" },
      { "speaker": "lead", "text": "It's for my mother. She's 78 and needs some help around the house, maybe a few hours a day." },
      { "speaker": "ai", "text": "Thank you for sharing that. For basic assistance like help around the house for a few hours daily, we would typically be in the $25-30 range. Would you like to schedule a free assessment where we can provide a more detailed quote based on your mother's specific needs?" },
      { "speaker": "lead", "text": "That sounds good, but I need to discuss it with my brother first before scheduling anything." },
      { "speaker": "ai", "text": "I completely understand, family decisions are important. Would you like me to email you some information that you can share with your brother?" },
      { "speaker": "lead", "text": "Yes, that would be helpful. Thank you." }
    ]
  },
  "summary": {
    "conversation_id": "conv_a45b789cd012ef",
    "summary": "Sarah Johnson inquired about home health care services for her 78-year-old mother who needs assistance around the house for a few hours daily. I provided her with a price range of $25-30 per hour for basic assistance. Sarah wants to discuss with her brother before scheduling an assessment. I offered to send information via email which she accepted.",
    "success_criteria": {
      "positive_intent": true,
      "information_provided": true,
      "next_steps_established": true
    },
    "data_collection": {
      "care_recipient": "mother",
      "care_recipient_age": 78,
      "care_needs": "help around the house",
      "care_duration": "few hours daily",
      "decision_maker": ["Sarah Johnson", "brother"]
    }
  },
  "intentData": {
    "primaryIntent": {
      "name": "service_interest",
      "confidence": 0.87
    },
    "detectedIntents": ["service_interest", "price_inquiry"],
    "intentLog": [
      {
        "intent": "price_inquiry",
        "confidence": 0.75,
        "timestamp": "2023-07-25T14:32:45.123Z"
      },
      {
        "intent": "service_interest",
        "confidence": 0.87,
        "timestamp": "2023-07-25T14:33:15.456Z"
      }
    ],
    "firstDetectionTime": "2023-07-25T14:32:45.123Z",
    "lastUpdateTime": "2023-07-25T14:33:15.456Z"
  },
  "interruptionData": {
    "interruptionCount": 0,
    "rescheduleCount": 0,
    "rescheduleDetected": false,
    "preferredCallbackTime": null,
    "interruptionLog": []
  },
  "qualityMetrics": {
    "callDurationMs": 165000,
    "silenceRunCount": 1,
    "totalSilenceDurationMs": 3500,
    "lowAudioRunCount": 0,
    "qualityIssuesDetected": false,
    "qualityLog": [
      {
        "type": "silence_started",
        "timestamp": "2023-07-25T14:33:20.123Z"
      },
      {
        "type": "silence_ended",
        "timestamp": "2023-07-25T14:33:23.623Z",
        "durationMs": 3500
      }
    ]
  }
}
```

### 2. Callback Webhook (Scheduled Callback) - Sample Payload

```json
{
  "call_sid": "CA9082e6d789f456eda94569f285583a0",
  "conversation_id": "conv_b56c890de123fg",
  "is_voicemail": false,
  "sales_team_unavailable": false,
  "lead_info": {
    "LeadId": "LD45678",
    "LeadName": "Robert Chen",
    "LeadPhone": "+16175551234",
    "LeadEmail": "robert.c@example.com",
    "LeadSource": "referral",
    "AssignedAgent": "Jennifer Wilson"
  },
  "timestamp": "2023-07-25T16:45:23.789Z",
  "source_module": "outbound-webhook",
  "call_metadata": {
    "transferInitiated": false,
    "transferComplete": false,
    "callbackScheduled": true,
    "answeredBy": "human"
  },
  "transcript": {
    "conversation_id": "conv_b56c890de123fg",
    "transcripts": [
      { "speaker": "ai", "text": "Hello, this is Taylor from ForTheLegends Health Services. Am I speaking with Robert Chen?" },
      { "speaker": "lead", "text": "Yes, this is Robert." },
      { "speaker": "ai", "text": "Great to connect with you, Robert. I'm calling because you were referred to our home health care services. Is now a good time to chat about how we might be able to help you?" },
      { "speaker": "lead", "text": "Actually, I'm in the middle of something. Can you call me back tomorrow afternoon?" },
      { "speaker": "ai", "text": "Absolutely, I'd be happy to call you back tomorrow afternoon. What time would work best for you?" },
      { "speaker": "lead", "text": "Around 3 PM would be good." },
      { "speaker": "ai", "text": "Perfect, I'll schedule a callback for tomorrow at 3 PM. Is there anything specific about our services you'd like me to be prepared to discuss when I call back?" },
      { "speaker": "lead", "text": "Yes, I'm looking into care options for my father who recently had a stroke." },
      { "speaker": "ai", "text": "I'm sorry to hear about your father, and I appreciate you sharing that information. I'll make a note to discuss our post-stroke care services when I call back tomorrow at 3 PM. Thank you for your time today, Robert, and I look forward to our conversation tomorrow." },
      { "speaker": "lead", "text": "Thank you, talk to you then." }
    ]
  },
  "summary": {
    "conversation_id": "conv_b56c890de123fg",
    "summary": "Robert Chen was unable to talk as he was in the middle of something. He requested a callback tomorrow at 3 PM. He mentioned he is looking for care options for his father who recently had a stroke. I scheduled the callback and confirmed I would discuss post-stroke care services during our next call.",
    "success_criteria": {
      "positive_intent": true,
      "callback_scheduled": true,
      "callback_time_confirmed": true
    },
    "data_collection": {
      "care_recipient": "father",
      "care_needs": "post-stroke care",
      "callback_date": "2023-07-26",
      "callback_time": "15:00",
      "decision_maker": ["Robert Chen"]
    }
  },
  "callbackPreferences": {
    "scheduled": true,
    "date": "2023-07-26",
    "time": "15:00",
    "timezone": "America/New_York",
    "notes": "Discuss post-stroke care services for father"
  },
  "intentData": {
    "primaryIntent": {
      "name": "schedule_callback",
      "confidence": 0.92
    },
    "detectedIntents": ["cant_talk_now", "schedule_callback", "service_interest"],
    "intentLog": [
      {
        "intent": "cant_talk_now",
        "confidence": 0.85,
        "timestamp": "2023-07-25T16:45:55.123Z"
      },
      {
        "intent": "schedule_callback",
        "confidence": 0.92,
        "timestamp": "2023-07-25T16:46:15.456Z"
      },
      {
        "intent": "service_interest",
        "confidence": 0.75,
        "timestamp": "2023-07-25T16:47:05.789Z"
      }
    ],
    "firstDetectionTime": "2023-07-25T16:45:55.123Z",
    "lastUpdateTime": "2023-07-25T16:47:05.789Z"
  },
  "interruptionData": {
    "interruptionCount": 1,
    "rescheduleCount": 1,
    "rescheduleDetected": true,
    "preferredCallbackTime": {
      "type": "specific_time",
      "value": "15:00",
      "date": "2023-07-26"
    },
    "interruptionLog": [
      {
        "type": "interruption",
        "timestamp": "2023-07-25T16:45:50.123Z",
        "transcript": "Actually, I'm in the middle of something."
      },
      {
        "type": "reschedule_request",
        "timestamp": "2023-07-25T16:46:00.456Z",
        "transcript": "Can you call me back tomorrow afternoon?"
      }
    ]
  },
  "qualityMetrics": {
    "callDurationMs": 98000,
    "silenceRunCount": 0,
    "totalSilenceDurationMs": 0,
    "lowAudioRunCount": 0,
    "qualityIssuesDetected": false,
    "qualityLog": []
  }
}
```

### 3. Voicemail Webhook (Call to Voicemail) - Sample Payload

```json
{
  "call_sid": "CA7063c5e890d567fed05670g396694b1",
  "conversation_id": "conv_c67d901ef234gh",
  "is_voicemail": true,
  "sales_team_unavailable": false,
  "lead_info": {
    "LeadId": "LD12345",
    "LeadName": "Maria Garcia",
    "LeadPhone": "+19495558765",
    "LeadEmail": "maria.g@example.com",
    "LeadSource": "partner_referral",
    "AssignedAgent": "David Thompson"
  },
  "timestamp": "2023-07-25T11:20:45.123Z",
  "source_module": "outbound-webhook",
  "call_metadata": {
    "transferInitiated": false,
    "transferComplete": false,
    "callbackScheduled": false,
    "answeredBy": "machine_end_beep"
  },
  "transcript": {
    "conversation_id": "conv_c67d901ef234gh",
    "transcripts": [
      { "speaker": "ai", "text": "Hello, this is Jordan from ForTheLegends Health Services calling for Maria Garcia. We're reaching out because you were referred to us for home health care services. I understand I've reached your voicemail. I'd like to connect with you to discuss how our services might help you or your loved one. Please call us back at (800) 555-1234, or I'll try reaching you again tomorrow. Thank you and have a great day." }
    ]
  },
  "summary": {
    "conversation_id": "conv_c67d901ef234gh",
    "summary": "Call went to Maria Garcia's voicemail. I left a message identifying myself from ForTheLegends Health Services, explained that she was referred for home health care services, provided our callback number (800) 555-1234, and mentioned I would try calling again tomorrow.",
    "success_criteria": {
      "voicemail_detected": true,
      "message_left": true,
      "callback_number_provided": true
    }
  },
  "intentData": null,
  "interruptionData": null,
  "qualityMetrics": {
    "callDurationMs": 32000,
    "silenceRunCount": 0,
    "totalSilenceDurationMs": 0,
    "lowAudioRunCount": 0,
    "qualityIssuesDetected": false,
    "qualityLog": []
  },
  "retryInfo": {
    "retryCount": 0,
    "retryNeeded": true,
    "retryReason": "voicemail",
    "nextRetryTime": "2023-07-26T11:20:45.123Z",
    "retryHistory": []
  }
}
```

## LLM Prompts for Each Webhook Type

Now, let's create specific prompts to process each webhook payload type effectively through an LLM.

### 1. Main Webhook (Standard Call) Prompt

```
You are an AI business analyst for a healthcare services company. Analyze this standard call webhook data and extract key business intelligence:

[Webhook Data]
{{insert full webhook JSON}}

Generate a comprehensive business report with the following sections:

1. EXECUTIVE SUMMARY
Provide a 2-3 sentence business summary of the call outcome.

2. LEAD ANALYSIS
Assess the lead's interest level, specific needs, and position in the sales funnel.

3. ACTION ITEMS
List specific follow-up actions needed (if any), who should perform them, and by when.

4. CONVERSATION INSIGHTS
Identify key moments from the conversation, including questions asked, objections raised, and positive signals.

5. TECHNICAL ASSESSMENT
Note any technical issues that may have affected call quality.

6. DATA EXTRACTION
Extract these specific data points in the following JSON format:
{
  "lead_id": "",
  "lead_name": "",
  "call_outcome": "", // Use one of: "qualified_lead", "needs_followup", "not_interested", "information_provided"
  "interest_level": "", // Use one of: "high", "medium", "low", "none"
  "care_recipient": "", // Who needs care (e.g., "self", "mother", "father", "spouse")
  "care_recipient_age": "", // Age if mentioned
  "care_needs": [], // List of specific care needs mentioned
  "key_questions": [], // Important questions the lead asked
  "objections": [], // Any objections or concerns raised
  "follow_up_needed": true/false,
  "follow_up_type": "", // Use one of: "none", "email_info", "call_back", "assessment", "transfer_to_sales"
  "follow_up_date": "", // ISO date format if specified
  "priority": "" // Use one of: "urgent", "high", "medium", "low"
}

Provide your response in the exact format requested above.
```

### 2. Callback Webhook Prompt

```
You are an AI business analyst for a healthcare services company. Analyze this callback webhook data and create a callback preparation report:

[Webhook Data]
{{insert full webhook JSON}}

Generate a comprehensive business report with the following sections:

1. CALLBACK OVERVIEW
Provide a summary of why a callback was scheduled and what the lead expects.

2. PREPARATION CHECKLIST
List specific information and resources the agent should have ready for the callback.

3. CONTEXT PRESERVATION
Summarize what was already discussed and what needs to be continued in the next call.

4. LEAD INTEREST ASSESSMENT
Evaluate the lead's interest level and specific needs based on available information.

5. SCHEDULING DETAILS
Confirm all callback logistics (time, date, preferred number, etc.).

6. DATA EXTRACTION
Extract these specific data points in the following JSON format:
{
  "lead_id": "",
  "lead_name": "",
  "callback_date": "", // ISO date format
  "callback_time": "", // In 24-hour format
  "callback_timezone": "",
  "care_recipient": "", // Who needs care (if known)
  "care_needs": [], // Specific care needs mentioned
  "reason_for_callback": "", // Why a callback was scheduled
  "pre_callback_preparation": [], // What the agent should prepare
  "conversation_stage": "", // Use one of: "initial_inquiry", "gathering_information", "discussing_options", "decision_stage"
  "agent_assignment": "", // Who should make the callback
  "priority": "", // Use one of: "urgent", "high", "medium", "low"
  "expected_outcome": "" // What should be accomplished in the callback
}

Provide your response in the exact format requested above.
```

### 3. Voicemail Webhook Prompt

```
You are an AI business analyst for a healthcare services company. Analyze this voicemail webhook data and create a follow-up strategy:

[Webhook Data]
{{insert full webhook JSON}}

Generate a comprehensive business report with the following sections:

1. VOICEMAIL ASSESSMENT
Summarize what message was left and what the next steps should be.

2. FOLLOW-UP STRATEGY
Recommend the best approach for the next contact attempt (time, method, message).

3. LEAD INFORMATION ANALYSIS
Analyze available lead information and suggest how to enhance the next contact attempt.

4. RETRY PLANNING
Evaluate how many attempts have been made and recommend the optimal next attempt timing.

5. MESSAGING RECOMMENDATIONS
Suggest specific talking points or message content for the next contact attempt.

6. DATA EXTRACTION
Extract these specific data points in the following JSON format:
{
  "lead_id": "",
  "lead_name": "",
  "voicemail_left": true/false,
  "message_included_callback_number": true/false,
  "retry_count": 0, // Current number of attempts
  "next_attempt_date": "", // ISO date format
  "next_attempt_time": "", // Suggested time in 24-hour format
  "suggested_approach": "", // Use one of: "call_again", "email_follow_up", "text_message", "different_agent", "transfer_to_inside_sales"
  "message_effectiveness": "", // Use one of: "effective", "standard", "needs_improvement"
  "lead_source": "",
  "assigned_agent": "",
  "priority": "" // Use one of: "urgent", "high", "medium", "low"
}

Provide your response in the exact format requested above.
```

## Google Sheets Data Insertion Strategy

Now that we have our payloads and LLM prompts, let's define the strategy for inserting this data into Google Sheets.

### 1. Main Sheet Fields with Data Mappings

For the Call Log sheet, here's how to map the data from both webhook payloads and LLM outputs:

| Column Name | Data Source | Mapping Expression |
|-------------|-------------|-------------------|
| Call ID | Webhook | `webhookData.call_sid` |
| Conversation ID | Webhook | `webhookData.conversation_id` |
| Call Date & Time | Webhook | `formatDate(webhookData.timestamp, "MM/DD/YYYY HH:mm:ss")` |
| Webhook Type | Determined | `IF(webhookData.call_metadata.callbackScheduled, "callback", IF(webhookData.is_voicemail, "voicemail", "main"))` |
| Lead ID | Webhook | `webhookData.lead_info.LeadId` |
| Lead Name | Webhook | `webhookData.lead_info.LeadName` |
| Lead Email | Webhook | `webhookData.lead_info.LeadEmail` |
| Lead Phone | Webhook | `webhookData.lead_info.LeadPhone` |
| Call Outcome | LLM | `llmOutput.data_extraction.call_outcome` or `"voicemail"` for voicemail calls |
| Is Voicemail | Webhook | `webhookData.is_voicemail` |
| Transfer Status | Webhook | `webhookData.call_metadata.transferComplete` |
| Callback Scheduled | Webhook | `webhookData.call_metadata.callbackScheduled` |
| Callback Date | LLM/Webhook | `IF(webhookData.callbackPreferences, webhookData.callbackPreferences.date, llmOutput.data_extraction.follow_up_date)` |
| Callback Time | LLM/Webhook | `IF(webhookData.callbackPreferences, webhookData.callbackPreferences.time, llmOutput.data_extraction.follow_up_time)` |
| Answered By | Webhook | `webhookData.call_metadata.answeredBy` |
| Primary Intent | Webhook | `IF(webhookData.intentData, webhookData.intentData.primaryIntent.name, "")` |
| Intent Confidence | Webhook | `IF(webhookData.intentData, webhookData.intentData.primaryIntent.confidence, "")` |
| Secondary Intents | Webhook | `IF(webhookData.intentData, JOIN(webhookData.intentData.detectedIntents, ", "), "")` |
| Interest Level | LLM | `llmOutput.data_extraction.interest_level` |
| Call Duration (sec) | Webhook | `ROUND(webhookData.qualityMetrics.callDurationMs/1000, 0)` |
| Silence Count | Webhook | `webhookData.qualityMetrics.silenceRunCount` |
| Interruption Count | Webhook | `IF(webhookData.interruptionData, webhookData.interruptionData.interruptionCount, 0)` |
| Quality Issues | Webhook | `webhookData.qualityMetrics.qualityIssuesDetected` |
| Executive Summary | LLM | `llmOutput.EXECUTIVE_SUMMARY` or equivalent section |
| Care Recipient | LLM | `llmOutput.data_extraction.care_recipient` |
| Care Needs | LLM | `JOIN(llmOutput.data_extraction.care_needs, ", ")` |
| Follow-up Required | LLM | `llmOutput.data_extraction.follow_up_needed` |
| Follow-up Type | LLM | `llmOutput.data_extraction.follow_up_type` |
| Priority | LLM | `llmOutput.data_extraction.priority` |
| Retry Count | Webhook | `IF(webhookData.retryInfo, webhookData.retryInfo.retryCount, 0)` |
| Next Retry Date | Webhook | `IF(webhookData.retryInfo, webhookData.retryInfo.nextRetryTime, "")` |
| Full Transcript | Webhook | `JOIN(ARRAYFORMULA(webhookData.transcript.transcripts[*].speaker & ": " & webhookData.transcript.transcripts[*].text), "\n")` |
| Action Items | LLM | `llmOutput.ACTION_ITEMS` |

### 2. Managing Transcript Data

For transcripts, you have a few options:

1. **Inline in Google Sheets** (for shorter transcripts):
   ```javascript
   // Format the transcript data for readability
   const formattedTranscript = webhookData.transcript.transcripts.map(entry => 
     `${entry.speaker}: ${entry.text}`
   ).join("\n");
   ```

2. **Google Drive Document** (for longer transcripts):
   ```javascript
   // Create a Google Doc with the transcript and store the link
   const formattedTranscript = webhookData.transcript.transcripts.map(entry => 
     `${entry.speaker}: ${entry.text}`
   ).join("\n\n");
   
   const doc = DriveApp.createFile(`Transcript_${webhookData.call_sid}`, formattedTranscript);
   const transcriptLink = doc.getUrl();
   ```

3. **Linked Sheet** (for structured access):
   ```javascript
   // Create a separate sheet for transcripts with timestamps
   // Add a link in the main Call Log to this transcript sheet
   ```

### 3. Make.com Implementation with LLM

Here's the flow to implement in Make.com:

1. **Webhook Trigger**: Receives data from any of the 3 webhooks

2. **Webhook Type Detection**:
   ```javascript
   // Determine webhook type
   const webhookType = webhookData.call_metadata.callbackScheduled 
     ? "callback" 
     : (webhookData.is_voicemail ? "voicemail" : "main");
   ```

3. **LLM Prompt Selection**:
   ```javascript
   // Select the appropriate prompt based on webhook type
   let prompt;
   switch(webhookType) {
     case "callback":
       prompt = callbackPrompt.replace("{{insert full webhook JSON}}", JSON.stringify(webhookData, null, 2));
       break;
     case "voicemail":
       prompt = voicemailPrompt.replace("{{insert full webhook JSON}}", JSON.stringify(webhookData, null, 2));
       break;
     default:
       prompt = mainPrompt.replace("{{insert full webhook JSON}}", JSON.stringify(webhookData, null, 2));
   }
   ```

4. **OpenAI API Call**:
   ```javascript
   // Send to OpenAI
   const response = await fetch("https://api.openai.com/v1/chat/completions", {
     method: "POST",
     headers: {
       "Content-Type": "application/json",
       "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
     },
     body: JSON.stringify({
       model: "gpt-4-turbo",
       messages: [
         {
           role: "system",
           content: "You are a business analyst processing healthcare call data."
         },
         {
           role: "user",
           content: prompt
         }
       ],
       temperature: 0.3,
       max_tokens: 1500
     })
   });
   
   const llmOutput = await response.json();
   const llmContent = llmOutput.choices[0].message.content;
   ```

5. **Parse LLM Response**:
   ```javascript
   // Extract JSON data and text sections
   const jsonMatch = llmContent.match(/\{[\s\S]*\}/);
   const jsonData = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
   
   // Extract text sections
   const sections = {};
   const sectionMatches = llmContent.matchAll(/(\d\. [A-Z\s]+)\n([\s\S]*?)(?=\d\. [A-Z\s]+|\{|$)/g);
   for (const match of sectionMatches) {
     const sectionName = match[1].replace(/\d\. /, "").trim();
     sections[sectionName] = match[2].trim();
   }
   ```

6. **Prepare Google Sheets Data**:
   ```javascript
   // Combine webhook data and LLM output
   const sheetRow = {
     "Call ID": webhookData.call_sid,
     "Conversation ID": webhookData.conversation_id,
     // Add all other mappings from the table above
   };
   ```

7. **Insert to Google Sheets**:
   ```javascript
   // Add row to Google Sheets
   await googleSheets.addRow("Call Log", sheetRow);
   
   // If follow-up needed, add to Action Items sheet
   if (jsonData.follow_up_needed) {
     await googleSheets.addRow("Action Items", {
       "Action ID": `ACT-${Date.now()}`,
       "Call ID": webhookData.call_sid,
       "Lead Name": webhookData.lead_info.LeadName,
       "Action Description": sections["ACTION ITEMS"],
       "Due Date": jsonData.follow_up_date || new Date(Date.now() + 86400000).toISOString().split('T')[0],
       "Priority": jsonData.priority || "medium",
       "Status": "pending",
       "Assigned To": webhookData.lead_info.AssignedAgent || "Unassigned"
     });
   }
   
   // If quality issues detected, add to Technical Issues sheet
   if (webhookData.qualityMetrics.qualityIssuesDetected) {
     await googleSheets.addRow("Technical Issues", {
       "Issue ID": `ISS-${Date.now()}`,
       "Call ID": webhookData.call_sid,
       "Issue Type": getIssueType(webhookData.qualityMetrics),
       "Severity": getSeverity(webhookData.qualityMetrics),
       "Description": sections["TECHNICAL ASSESSMENT"] || "Quality issues detected",
       "Timestamp": webhookData.timestamp,
       "Resolution Status": "open"
     });
   }
   ```

8. **Store Transcript**:
   ```javascript
   // Format transcript
   const formattedTranscript = webhookData.transcript.transcripts.map(entry => 
     `${entry.speaker}: ${entry.text}`
   ).join("\n\n");
   
   // Add to Transcripts sheet or create Google Doc
   if (formattedTranscript.length < 5000) {
     // For shorter transcripts, store directly in sheet
     await googleSheets.addRow("Transcripts", {
       "Call ID": webhookData.call_sid,
       "Lead Name": webhookData.lead_info.LeadName,
       "Date": new Date(webhookData.timestamp).toISOString().split('T')[0],
       "Full Transcript": formattedTranscript
     });
   } else {
     // For longer transcripts, create a Google Doc and store the link
     const docTitle = `Transcript - ${webhookData.lead_info.LeadName} - ${new Date(webhookData.timestamp).toISOString().split('T')[0]}`;
     const doc = DriveApp.createFile(docTitle, formattedTranscript);
     const transcriptLink = doc.getUrl();
     
     // Update the Call Log with the transcript link
     await googleSheets.updateRow("Call Log", {
       callId: webhookData.call_sid,
       transcriptLink: transcriptLink
     });
   }
   ```

This implementation provides a comprehensive solution that:

1. Processes different webhook types appropriately
2. Uses LLMs for intelligent data extraction and analysis
3. Structures data properly for Google Sheets insertion
4. Handles transcripts appropriately based on length
5. Creates action items and technical issue tracking automatically
6. Preserves all valuable business intelligence from the calls

By letting the LLM do the heavy lifting of analysis while maintaining structured outputs through the JSON format requirement, you get the best of both worlds: intelligent, flexible analysis with consistent, structured data for your business operations.
