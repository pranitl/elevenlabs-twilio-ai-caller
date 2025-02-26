# ElevenLabs-Twilio AI Caller

This project integrates Twilio's telephony capabilities with ElevenLabs' conversational AI to create an automated phone calling system. It supports both outbound and inbound calls with features like custom prompts, lead management, and sales team handoff.

## Features
- **Outbound Calls**: Initiate AI-powered calls with customizable prompts
- **Inbound Call Handling**: Forward incoming calls to sales team
- **Authentication**: Secure ElevenLabs API integration
- **Custom Prompts**: Support for dynamic conversation prompts via make.com
- **Lead Management**: Handle lead data and context
- **Sales Team Handoff**: Seamless transfer from AI to human agents
- **WebSocket Support**: Real-time audio streaming

## Prerequisites
- Node.js (v20 or higher)
- Twilio account with a phone number
- ElevenLabs account with API access
- Replit account (optional, for deployment)
- Make.com account (for automation)

## Setup Instructions

1. **Clone the Repository**
```bash
git clone <repository-url>
cd elevenlabs-twilio-ai-caller
```

2. **Install Dependencies**
```bash
npm install
```

3. **Configure Environment Variables**
Create a `.env` file in the root directory with the following:
```
ELEVENLABS_API_KEY=your_elevenlabs_api_key
ELEVENLABS_AGENT_ID=your_elevenlabs_agent_id
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=+1xxxxxxxxxx
SALES_TEAM_PHONE_NUMBER=+1xxxxxxxxxx
PORT=8000
```

4. **Prepare Audio Files**
- Place `handoff.mp3` in the root directory for call transfers

5. **Run the Application**
```bash
npm start
```

## Environment Variables
| Variable | Description | Required |
|----------|-------------|----------|
| ELEVENLABS_API_KEY | ElevenLabs API key | Yes |
| ELEVENLABS_AGENT_ID | ElevenLabs Agent ID | Yes |
| TWILIO_ACCOUNT_SID | Twilio Account SID | Yes |
| TWILIO_AUTH_TOKEN | Twilio Auth Token | Yes |
| TWILIO_PHONE_NUMBER | Twilio source phone number | Yes |
| SALES_TEAM_PHONE_NUMBER | Sales team destination number | Yes |
| PORT | Server port (default: 8000) | No |

## Usage

### Making an Outbound Call
Send a POST request to `/outbound-call-to-sales`:
```bash
curl -X POST https://your-domain.com/outbound-call-to-sales \
-H "Content-Type: application/json" \
-d '{
  "number": "+14088210387",
  "prompt": "You are Heather from First Light Home Care...",
  "leadinfo": {
    "LeadName": "John Doe",
    "CareReason": "needs help due to macular degeneration",
    "CareNeededFor": "Dorothy"
  }
}'
```

### Using with Make.com
To automate outbound calls using Make.com, follow these steps:

1. **Set Up a Mailhook**
   - Create a Mailhook in Make.com to receive email notifications containing lead information.

2. **OpenAI Transform Text to Structured Data**
   - Use an OpenAI module to parse the email text into structured data.
   - Configure the OpenAI module with the following data definitions:
     - `number`: Phone number of the point of contact (E.164 format, e.g., "+12073223372")
     - `LeadName`: Point of Contact name (text)
     - `CareReason`: Concise summary of why care is needed (text, e.g., "Needs help due to macular degeneration and is a fall risk.")
     - `CareNeededFor`: Name of the person needing care and relation (if provided, text, e.g., "Dorothy")
   - Use the gpt-4o-mini (system) model with this prompt:
     ```
     I am providing you an email about the lead information I just obtained. You need to parse the text and provide it for a sales agent to call the lead so keep that audience in mind.
     ```

3. **HTTP Make a Request Module**
   - Configure an HTTP module to send a POST request to `https://elevenlabs-twilio-ai-caller-spicywalnut.replit.app/outbound-call-to-sales`
   - Use this JSON request body:
   ```json
   {
     "prompt": "You are Heather, a friendly and warm care coordinator for First Light Home Care, a home healthcare company. You’re calling to follow up on care service inquiries with a calm and reassuring voice, using natural pauses to make the conversation feel more human-like. Your main goals are: 1. Verify the details submitted in the care request from the Point of Contact below for the 'Care Needed For'. 2. Show empathy for the care situation. 3. Confirm interest in receiving care services for the 'Care Needed For'. 4. Set expectations for next steps, which are to discuss with a care specialist. Use casual, friendly language, avoiding jargon and technical terms, to make the lead feel comfortable and understood. Listen carefully and address concerns with empathy, focusing on building rapport. If asked about pricing, explain that a care specialist will discuss detailed pricing options soon. If the person is not interested, thank them for their time and end the call politely. Here is some of the key information:",
     "number": "{{3.number}}",
     "leadinfo": {
       "LeadName": "{{3.LeadName}}",
       "CareReason": "{{3.CareReason}}",
       "CareNeededFor": "{{3.CareNeededFor}}"
     }
   }
   ```
   - The dynamic variables (`{{3.number}}`, `{{3.LeadName}}`, `{{3.CareReason}}`, `{{3.CareNeededFor}}`) pull data from the OpenAI module's output.

### Configuring ElevenLabs Conversational AI
To set up and obtain the necessary configurations for ElevenLabs Conversational AI:

1. **Create an ElevenLabs Account**
   - Sign up at [ElevenLabs.io](https://elevenlabs.io) if you don’t already have an account.

2. **Obtain API Key**
   - Log in to your ElevenLabs dashboard.
   - Navigate to the "API" or "Profile" section.
   - Generate an API key. This is your `ELEVENLABS_API_KEY`. Keep it secure and do not share it publicly.

3. **Create and Configure an Agent**
   - Go to the "Conversational AI" section in the ElevenLabs dashboard.
   - Create a new agent for your use case (e.g., a care coordinator like Heather).
   - Configure the agent with:
     - **Voice**: Select a voice that matches your desired tone (e.g., friendly and warm).
     - **Prompt**: Define the initial prompt for the agent, such as:
       ```
       You are Heather, a friendly and warm care coordinator for First Light Home Care, a home healthcare company. You’re calling to follow up on care service inquiries with a calm and reassuring voice, using natural pauses to make the conversation feel more human-like. Your main goals are: 1. Verify the details submitted in the care request from the Point of Contact below for the 'Care Needed For'. 2. Show empathy for the care situation. 3. Confirm interest in receiving care services for the 'Care Needed For'. 4. Set expectations for next steps, which are to discuss with a care specialist. Use casual, friendly language, avoiding jargon and technical terms, to make the lead feel comfortable and understood. Listen carefully and address concerns with empathy, focusing on building rapport. If asked about pricing, explain that a care specialist will discuss detailed pricing options soon. If the person is not interested, thank them for their time and end the call politely.
       ```
     - **First Message**: Set an initial greeting, e.g., "Hi, is this [LeadName]? This is Heather from First Light Home Care. I understand you're looking for care for [CareNeededFor]. Is that correct?"
   - Save the agent to generate an `ELEVENLABS_AGENT_ID`. This ID is used to identify your agent in API requests.

4. **Test the Agent**
   - Use the ElevenLabs API playground or make test API calls to ensure the agent responds as expected.
   - Refer to the ElevenLabs documentation for detailed API endpoints and parameters: [ElevenLabs API Docs](https://elevenlabs.io/docs).

### Inbound Calls
Configure your Twilio number to handle incoming calls using a webhook:
- In the Twilio Console, set the voice webhook URL to `https://elevenlabs-twilio-ai-caller-spicywalnut.replit.app/incoming-call`
- This will forward incoming calls to the specified `SALES_TEAM_PHONE_NUMBER` as configured in your environment variables.

## Project Structure
```
/elevenlabs-twilio-ai-caller
├── forTheLegends/outbound/
│   ├── outbound-authenticated.js    # Authenticated calls
│   ├── outbound-custom-make.js     # Custom prompts from make.com
│   ├── outbound-normal.js          # Basic unauthenticated calls
│   └── outbound.custom-prompt.js   # Flexible prompt handling
├── inbound-calls.js                # Inbound call routing
├── outbound-calls.js               # Main outbound call logic
├── index.js                        # Server entry point
├── handoff.mp3                     # Audio for call transfers
├── makePayload.txt                 # Sample make.com payload
├── package.json                    # Dependencies
├── .replit                         # Replit configuration
└── replit.nix                      # Nix environment config
```

## Troubleshooting
- **Call fails to initiate**: Check Twilio credentials and phone numbers
- **No audio**: Verify ElevenLabs API key and agent ID
- **WebSocket errors**: Ensure server is accessible and port is open
- **Logs**: Check server logs for detailed error messages

## Contributing
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request
